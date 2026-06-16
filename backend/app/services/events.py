"""SSE event bus — thread-safe publish from sync graph runner, async consume in routes.

Events are buffered per ticket so a client that connects *after* the run completes
still replays the full trace (important when the graph finishes before the browser
tab opens). Buffer capped at MAX_HISTORY entries per ticket.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict

logger = logging.getLogger(__name__)

MAX_HISTORY = 100

_loop: asyncio.AbstractEventLoop | None = None
_subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
_history: dict[str, list[dict]] = defaultdict(list)


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def publish(ticket_id: str, event_type: str, data: dict | None = None) -> None:
    """Emit an event. Safe to call from a sync background thread."""
    event = {"type": event_type, **(data or {})}
    _history[ticket_id].append(event)
    if len(_history[ticket_id]) > MAX_HISTORY:
        _history[ticket_id] = _history[ticket_id][-MAX_HISTORY:]

    if not _loop:
        return
    for q in list(_subs.get(ticket_id, [])):
        try:
            _loop.call_soon_threadsafe(q.put_nowait, event)
        except Exception:
            pass


async def subscribe(ticket_id: str):
    """Async generator: first replays buffered history, then streams live events."""
    history = list(_history.get(ticket_id, []))
    for event in history:
        yield event
    if history and history[-1].get("type") == "done":
        return

    q: asyncio.Queue = asyncio.Queue(maxsize=MAX_HISTORY)
    _subs[ticket_id].append(q)
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=30)
                yield event
                if event.get("type") == "done":
                    break
            except asyncio.TimeoutError:
                yield {"type": "ping"}
    finally:
        if q in _subs.get(ticket_id, []):
            _subs[ticket_id].remove(q)
