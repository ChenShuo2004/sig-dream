from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    future=True,
    pool_pre_ping=True,
    # Studio intake downloads many files in parallel while the file-machine also polls;
    # the old 5+5 pool exhausted and returned HTTP 500 mid-import.
    pool_size=15,
    max_overflow=25,
    pool_timeout=30,
    pool_recycle=180,
    pool_use_lifo=True,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        try:
            db.rollback()
        except Exception:
            pass
        db.close()
