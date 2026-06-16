"""Test configuration.

Point the whole test run at a temporary SQLite DB *before* any app module imports,
then seed the demo fleet once per session. Environment variables take precedence over
the .env file in pydantic-settings, so this overrides the dev DB cleanly.
"""

import os
import pathlib
import tempfile

_TMPDB = pathlib.Path(tempfile.gettempdir()) / "aftersales_test.db"
_TMPCKPT = pathlib.Path(tempfile.gettempdir()) / "aftersales_test_checkpoints.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TMPDB}"
os.environ["CHECKPOINT_DB_PATH"] = str(_TMPCKPT)
os.environ["LLM_PROVIDER"] = "ollama"
os.environ["JWT_SECRET"] = "test-secret-0123456789-0123456789-abcd"

import pytest


def _cleanup(path: pathlib.Path) -> None:
    for p in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
        if p.exists():
            p.unlink()


@pytest.fixture(scope="session", autouse=True)
def _seed_database():
    _cleanup(_TMPDB)
    _cleanup(_TMPCKPT)
    from app.seed.seed import seed

    seed()
    yield
    _cleanup(_TMPDB)
    _cleanup(_TMPCKPT)
