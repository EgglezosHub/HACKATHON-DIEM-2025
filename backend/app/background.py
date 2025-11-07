# backend/app/background.py
from __future__ import annotations

import random
import threading
import time
from typing import Optional

from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import User, UserRole
from app import services


def _backfill_last_12h(db: Session, step_minutes: int = 10) -> None:
    """
    Create synthetic meter samples for the last 12 hours for each non-provider user.
    This runs once on startup so the dashboard has immediate 12h history.
    """
    now = int(time.time())
    start = now - 12 * 3600
    step = step_minutes * 60

    users = (
        db.query(User)
        .filter(User.role != UserRole.provider.value)
        .order_by(User.id.asc())
        .all()
    )

    for u in users:
        ts = start
        while ts <= now:
            # calm, plausible demo ranges
            prod = max(0.0, random.uniform(0.0, 3.0))
            cons = max(0.0, random.uniform(0.6, 2.6))
            services.record_meter_sample(
                db=db,
                user_id=u.id,
                prod_kwh=round(prod, 3),
                cons_kwh=round(cons, 3),
                ts=ts,
            )
            ts += step


class MeterSimulator(threading.Thread):
    """
    Background simulator that ONLY writes meter samples for non-provider users.
    - NO auto-offers, per mentor requirement.
    - Safe for hackathon demos; keeps the UI "alive" with changing numbers.
    """

    def __init__(self, interval_seconds: int = 10):
        super().__init__(daemon=True)
        self.interval = max(1, int(interval_seconds))
        self._stop = threading.Event()

    def stop(self) -> None:
        self._stop.set()

    def run(self) -> None:
        while not self._stop.is_set():
            try:
                self.tick()
            except Exception as e:
                # Keep thread alive even if one tick fails
                print(f"[MeterSimulator] Tick error: {e}")
            # Sleep AFTER tick so the first tick happens immediately on startup
            self._stop.wait(self.interval)

    def tick(self) -> None:
        """
        One iteration:
          - Fetch all non-provider users
          - Generate plausible production/consumption
          - Insert a MeterSample row
        """
        now = int(time.time())
        db: Session = SessionLocal()
        try:
            users = (
                db.query(User)
                .filter(User.role != UserRole.provider.value)
                .order_by(User.id.asc())
                .all()
            )

            for u in users:
                # Very simple random model (good enough for demos)
                # You can adjust ranges if you want calmer charts.
                production_kwh = max(0.0, random.uniform(0.0, 4.0))     # e.g., solar output
                consumption_kwh = max(0.0, random.uniform(0.5, 3.5))    # e.g., household usage

                services.record_meter_sample(
                    db=db,
                    user_id=u.id,
                    prod_kwh=round(production_kwh, 3),
                    cons_kwh=round(consumption_kwh, 3),
                    ts=now,
                )

        finally:
            db.close()


# Singleton handle
_SIMULATOR: Optional[MeterSimulator] = None


def start_simulator() -> None:
    """
    Start the background simulator if SIMULATION_ENABLED is True.
    Safe to call multiple times; only starts once.
    """
    global _SIMULATOR
    if not settings.SIMULATION_ENABLED:
        print("[MeterSimulator] Not started (SIMULATION_ENABLED=False).")
        return
        
    db = SessionLocal()
    try:
        _backfill_last_12h(db, step_minutes=10)  # ~73 points per user
    finally:
        db.close()


        
    if _SIMULATOR is None:
        _SIMULATOR = MeterSimulator(interval_seconds=settings.SIMULATION_INTERVAL_SECONDS)
        _SIMULATOR.start()
        print(f"[MeterSimulator] Started with interval={settings.SIMULATION_INTERVAL_SECONDS}s.")


def stop_simulator() -> None:
    """
    Stop the simulator if it’s running.
    """
    global _SIMULATOR
    if _SIMULATOR is not None:
        _SIMULATOR.stop()
        _SIMULATOR = None
        print("[MeterSimulator] Stopped.")
