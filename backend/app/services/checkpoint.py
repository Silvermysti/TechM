"""Durable LangGraph checkpointer factory.

Paused (human-in-the-loop) graph runs must survive a server restart and be visible
across worker processes, so we persist checkpoints instead of using InMemorySaver:

  * sqlite DATABASE_URL -> SqliteSaver on a sidecar file (CHECKPOINT_DB_PATH), kept
    separate from the ORM database so seed's drop_all never wipes live threads.
  * postgres            -> PostgresSaver in the same database (own tables).
"""

from __future__ import annotations

from functools import lru_cache

from app.config import get_settings


@lru_cache
def get_checkpointer():
    settings = get_settings()
    url = settings.database_url

    if url.startswith("sqlite"):
        import sqlite3

        from langgraph.checkpoint.sqlite import SqliteSaver

        conn = sqlite3.connect(settings.checkpoint_db_path, check_same_thread=False)
        # WAL lets the API read checkpoints while a run writes; busy_timeout avoids
        # spurious "database is locked" under concurrent requests.
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=5000")
        saver = SqliteSaver(conn)
        saver.setup()
        return saver

    from psycopg import Connection
    from psycopg.rows import dict_row

    from langgraph.checkpoint.postgres import PostgresSaver

    pg_url = url.replace("postgresql+psycopg://", "postgresql://")
    conn = Connection.connect(pg_url, autocommit=True, row_factory=dict_row)
    saver = PostgresSaver(conn)
    saver.setup()
    return saver
