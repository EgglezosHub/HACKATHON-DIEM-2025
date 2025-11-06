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
