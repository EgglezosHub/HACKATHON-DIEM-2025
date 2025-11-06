# backend/app/config.py

from pydantic_settings import BaseSettings
from typing import List, Tuple


class Settings(BaseSettings):
    # -------------------------------------------------------
    # DATABASE
    # -------------------------------------------------------
    DATABASE_URL: str = "sqlite:///./app.db"
    # SQLite for hackathon simplicity.

    # -------------------------------------------------------
    # PLATFORM / MARKET CONFIG
    # -------------------------------------------------------
    PLATFORM_FEE_RATE: float = 0.02  # 2% fee kept by the platform

    # -------------------------------------------------------
    # SIMULATION (NO AUTO-OFFERS)
    # -------------------------------------------------------
    SIMULATION_ENABLED: bool = False

    SIMULATION_INTERVAL_SECONDS: int = 10
    # How often to generate meter samples (if enabled).

    # -------------------------------------------------------
    # PROVIDERS (ΔΕΗ, ΗΡΩΝ, etc.)
    # -------------------------------------------------------
    # We'll seed these as special "provider" users in the DB.
    # The price the provider charges is dynamic = base * multiplier(time-slot)
    PROVIDER_NAMES: List[str] = ["DEI", "HERON"]

    # Base price in EUR per kWh (we’ll refine after research).
    # This is the "wholesale-like" base that the daily program will multiply.
    PROVIDER_BASE_PRICE_EUR_PER_KWH: float = 0.22

    # Daily price program (multipliers by time-of-day).
    # Each tuple: (start_hour_in_24h, end_hour_in_24h, multiplier)
    # Example: 00:00–06:00 = 0.9x, 06:00–17:00 = 1.0x, 17:00–22:00 = 1.2x, 22:00–24:00 = 1.0x
    # NOTE: Rare “surge hour” up to 1.35x will be injected once per day by a scheduler.
    PROVIDER_PRICE_SCHEDULE: List[Tuple[int, int, float]] = [
        (0, 6, 0.90),
        (6, 17, 1.00),
        (17, 22, 1.20),
        (22, 24, 1.00),
    ]

    # Enable a daily “surge” window (one hour) with a higher multiplier, randomly placed.
    PROVIDER_SURGE_ENABLED: bool = True
    PROVIDER_SURGE_MULTIPLIER: float = 1.35
    # Hours where surge is allowed to appear (inclusive range in [0..23]).
    PROVIDER_SURGE_ALLOWED_HOURS: Tuple[int, int] = (17, 21)  # early evening typical peak

    # If True, provider “offers” are virtual/dynamic (computed on the fly)
    # rather than persisted rows. Simpler and more robust for MVP.
    PROVIDER_VIRTUAL_PRICING: bool = True

    # -------------------------------------------------------
    # CHAIN INTEGRATION (OPTIONAL, LATER)
    # -------------------------------------------------------
    REQUIRE_TX_HASH_ON_ACCEPT: bool = False
    # Later, when MetaMask is wired, flip to True.

    class Config:
        env_file = ".env"


settings = Settings()
