"""Test configuration.

Point the whole test run at a temporary SQLite DB *before* any app module imports,
then seed the demo fleet once per session. Environment variables take precedence over
the .env file in pydantic-settings, so this overrides the dev DB cleanly.
"""

import os
import pathlib
import tempfile

_TMPDB = pathlib.Path(tempfile.gettempdir()) / "aftersales_test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{_TMPDB}"
os.environ["LLM_PROVIDER"] = "ollama"

import pytest


@pytest.fixture(scope="session", autouse=True)
def _seed_database():
    if _TMPDB.exists():
        _TMPDB.unlink()
    from app.seed.seed import seed

    seed()
    yield
    if _TMPDB.exists():
        _TMPDB.unlink()
