# backend/app/schemas.py
from __future__ import annotations

from typing import Literal, Optional, List
from pydantic import BaseModel, Field


# ---------------------------
# Users
# ---------------------------
class UserCreate(BaseModel):
    email: str = ""
    wallet: str = ""
    role: Literal["provider", "producer", "consumer", "both"] = "both"


class UserOut(BaseModel):
    id: int
    email: str
    wallet: str
    role: str
    balance_eur: float

    class Config:
        from_attributes = True


# ---------------------------
# Status / Dashboard
# ---------------------------
class StatusOut(BaseModel):
    user_id: int
    stored_surplus_kwh: float = 0.0
    balance_eur: float = 0.0


# ---------------------------
# Meter samples (optional manual ingestion for demos)
# ---------------------------
class MeterSampleIn(BaseModel):
    user_id: int
    production_kwh: float = Field(ge=0)
    consumption_kwh: float = Field(ge=0)
    ts: int = Field(description="Unix seconds")


# ---------------------------
# Household Offers (DB-backed, user-initiated only)
# ---------------------------
class OfferCreate(BaseModel):
    seller_id: int
    kwh: float = Field(gt=0, description="Total kWh being offered")
    price_eur_per_kwh: float = Field(gt=0, description="EUR per kWh")


class OfferOut(BaseModel):
    id: int
    seller_id: int
    kwh_total: float
    kwh_remaining: float
    price_eur_per_kwh: float
    status: Literal["active", "closed", "cancelled"]
    created_ts: int

    class Config:
        from_attributes = True


# ---------------------------
# Provider “virtual” offers (computed on the fly)
# ---------------------------
class ProviderOfferOut(BaseModel):
    """
    Not stored in DB as an Offer row. This is a dynamic market item for providers
    based on time-of-day pricing program. We expose it alongside household offers.
    """
    kind: Literal["provider"] = "provider"
    # virtual_id gives the frontend a unique key for UI lists, e.g., "provider-DEI"
    virtual_id: str
    provider_name: str
    current_multiplier: float
    price_eur_per_kwh: float


# ---------------------------
# Unified Marketplace item (so frontend can render a single list)
# ---------------------------
class MarketItemOut(BaseModel):
    """
    A discriminated union: either a provider item OR a user offer.
    'kind' tells the frontend how to render and which action to call.
    """
    kind: Literal["provider", "household"]
    # When kind == "household", offer fields are populated. When "provider", provider fields are set.

    # Provider fields (virtual)
    virtual_id: Optional[str] = None
    provider_name: Optional[str] = None
    current_multiplier: Optional[float] = None

    # Household offer fields (DB)
    offer_id: Optional[int] = None
    seller_id: Optional[int] = None
    kwh_remaining: Optional[float] = None

    # Common display field
    price_eur_per_kwh: float


# ---------------------------
# Accepting an offer / Purchasing
# ---------------------------
class AcceptIn(BaseModel):
    buyer_id: int
    offer_id: int
    kwh: float = Field(gt=0)
    # Optional now; later can be required via config.REQUIRE_TX_HASH_ON_ACCEPT
    tx_hash: Optional[str] = None


class TradeOut(BaseModel):
    id: int
    offer_id: int
    buyer_id: int
    kwh: float
    total_eur: float
    ts: int
    tx_hash: Optional[str] = None

    class Config:
        from_attributes = True


# ---------------------------
# Chain confirmations (optional, later)
# ---------------------------
class ChainOfferConfirmIn(BaseModel):
    offer_id: int
    tx_hash: str


class ChainTradeConfirmIn(BaseModel):
    trade_id: int
    tx_hash: str


# ---------------------------
# Generic status / health
# ---------------------------
class HealthOut(BaseModel):
    ok: bool
    ts: int

