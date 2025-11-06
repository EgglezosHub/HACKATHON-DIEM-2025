# backend/app/db.py
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.config import settings


class Base(DeclarativeBase):
    """SQLAlchemy declarative base for all ORM models."""
    pass


# SQLite engine (hackathon-friendly: zero setup, single file)
# check_same_thread=False lets SQLAlchemy share the connection across threads
# (needed because FastAPI + background threads may touch the DB).
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {},
    future=True,
)

# Session factory: no autocommit, no autoflush (explicit, predictable behavior)
SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,  # objects stay usable after commit (handy for APIs)
    future=True,
)


def get_db():
    """
    FastAPI dependency that yields a fresh SQLAlchemy Session per request.

    Usage in routes:
        from fastapi import Depends
        from sqlalchemy.orm import Session
        from app.db import get_db

        @app.get("/offers")
        def list_offers(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
