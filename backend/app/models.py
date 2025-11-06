# backend/app/models.py
from __future__ import annotations

from enum import Enum
from typing import Optional

from sqlalchemy import (
    String,
    Integer,
    Float,
    ForeignKey,
    CheckConstraint,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


# ---------------------------
# Enums
# ---------------------------
class UserRole(str, Enum):
    provider = "provider"   # e.g., ΔΕΗ, ΗΡΩΝ
    producer = "producer"   # household that can sell
    consumer = "consumer"   # household that can only buy
    both = "both"           # household that can both buy and sell


class OfferStatus(str, Enum):
    active = "active"
    closed = "closed"
    cancelled = "cancelled"


# ---------------------------
# ORM Models
# ---------------------------
class User(Base):
    """
    A platform user:
      - provider (ΔΕΗ/ΗΡΩΝ style)
      - producer (household selling)
      - consumer (household buying)
      - both (household buying & selling)
    For MVP/demo we maintain a simple EUR balance for trades settlement.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    wallet: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default=UserRole.both.value)

    # Demo-only “fiat” balance in EUR (so we can show settlement even if chain is audit-only)
    balance_eur: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Relationships
    meter_samples: Mapped[list["MeterSample"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    offers: Mapped[list["Offer"]] = relationship(back_populates="seller", cascade="all, delete-orphan")
    trades_bought: Mapped[list["Trade"]] = relationship(
        back_populates="buyer",
        cascade="all, delete-orphan",
        foreign_keys="Trade.buyer_id",
    )

    __table_args__ = (
        Index("ix_users_role", "role"),
        Index("ix_users_email", "email"),
        # Not enforcing email uniqueness for demo (seed may reuse ""), but you can flip this on later:
        # UniqueConstraint("email", name="uq_users_email"),
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} role={self.role} balance={self.balance_eur:.2f}>"


class MeterSample(Base):
    """
    Time-series readings per user.
    Used for computing latest surplus and for charts on the dashboard.
      - production_kwh: energy produced in the interval
      - consumption_kwh: energy consumed in the interval
      - ts: unix seconds
    """
    __tablename__ = "meter_samples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    production_kwh: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    consumption_kwh: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    ts: Mapped[int] = mapped_column(Integer, nullable=False)

    user: Mapped["User"] = relationship(back_populates="meter_samples")

    __table_args__ = (
        CheckConstraint("production_kwh >= 0.0", name="ck_ms_prod_nonneg"),
        CheckConstraint("consumption_kwh >= 0.0", name="ck_ms_cons_nonneg"),
        Index("ix_meter_samples_ts", "ts"),
    )

    def __repr__(self) -> str:
        return f"<MeterSample user={self.user_id} prod={self.production_kwh} cons={self.consumption_kwh} ts={self.ts}>"


class Offer(Base):
    """
    User-created offers (households only).
    Providers' prices are virtual/dynamic and NOT stored here.
    """
    __tablename__ = "offers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    seller_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    kwh_total: Mapped[float] = mapped_column(Float, nullable=False)
    kwh_remaining: Mapped[float] = mapped_column(Float, nullable=False)

    price_eur_per_kwh: Mapped[float] = mapped_column(Float, nullable=False)

    status: Mapped[str] = mapped_column(String(16), nullable=False, default=OfferStatus.active.value)
    created_ts: Mapped[int] = mapped_column(Integer, nullable=False)

    seller: Mapped["User"] = relationship(back_populates="offers")
    trades: Mapped[list["Trade"]] = relationship(back_populates="offer", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint("kwh_total > 0.0", name="ck_offer_kwh_total_pos"),
        CheckConstraint("kwh_remaining >= 0.0", name="ck_offer_kwh_remaining_nonneg"),
        CheckConstraint("price_eur_per_kwh > 0.0", name="ck_offer_price_pos"),
        Index("ix_offers_status_price", "status", "price_eur_per_kwh"),
        Index("ix_offers_created_ts", "created_ts"),
    )

    def __repr__(self) -> str:
        return (f"<Offer id={self.id} seller={self.seller_id} "
                f"remain={self.kwh_remaining}/{self.kwh_total} "
                f"price={self.price_eur_per_kwh} status={self.status}>")


class Trade(Base):
    """
    Immutable record of a completed purchase.
    Stores optional tx_hash for blockchain audit.
    """
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    offer_id: Mapped[int] = mapped_column(ForeignKey("offers.id", ondelete="CASCADE"), nullable=False, index=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    kwh: Mapped[float] = mapped_column(Float, nullable=False)
    total_eur: Mapped[float] = mapped_column(Float, nullable=False)

    ts: Mapped[int] = mapped_column(Integer, nullable=False)

    # Optional blockchain transaction hash (MetaMask)
    tx_hash: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, default=None)

    offer: Mapped["Offer"] = relationship(back_populates="trades")
    buyer: Mapped["User"] = relationship(back_populates="trades_bought")

    __table_args__ = (
        CheckConstraint("kwh > 0.0", name="ck_trade_kwh_pos"),
        CheckConstraint("total_eur >= 0.0", name="ck_trade_total_nonneg"),
        Index("ix_trades_ts", "ts"),
    )

    def __repr__(self) -> str:
        return f"<Trade id={self.id} offer={self.offer_id} buyer={self.buyer_id} kwh={self.kwh} total={self.total_eur}>"
