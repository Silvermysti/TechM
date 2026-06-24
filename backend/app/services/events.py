"""SSE event bus — thread-safe publish from sync graph runner, async consume in routes.

Events are buffered per ticket so a client that connects *after* the run completes
still replays the full trace (important when the graph finishes before the browser
tab opens). Two caps keep memory bounded over a long-running server:
  * MAX_HISTORY  — events kept per ticket.
  * MAX_TICKETS  — how many tickets' histories we retain at once; once exceeded we
    drop the oldest *finished* ticket (one with no live subscriber).
"""

from __future__ import annotations

import asyncio
import logging
from collections import OrderedDict, defaultdict

logger = logging.getLogger(__name__)

MAX_HISTORY = 100
MAX_TICKETS = 500

_loop: asyncio.AbstractEventLoop | None = None
_subs: dict[str, list[asyncio.Queue]] = defaultdict(list)
# Ordered by first-seen so we can evict the oldest ticket when over capacity.
_history: "OrderedDict[str, list[dict]]" = OrderedDict()


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def _evict_if_needed() -> None:
    """Keep at most MAX_TICKETS histories. Never drop a ticket that still has a live
    subscriber (its stream would lose replayed context mid-flight)."""
    while len(_history) > MAX_TICKETS:
        for tid in _history:  # oldest first
            if not _subs.get(tid):
                del _history[tid]
                break
        else:
            break  # every retained ticket has an active subscriber — stop evicting


def publish(ticket_id: str, event_type: str, data: dict | None = None) -> None:
    """Emit an event. Safe to call from a sync background thread."""
    event = {"type": event_type, **(data or {})}
    hist = _history.get(ticket_id)
    if hist is None:
        hist = []
        _history[ticket_id] = hist
        _evict_if_needed()
    _history.move_to_end(ticket_id)  # mark as most-recently active
    hist.append(event)
    if len(hist) > MAX_HISTORY:
        del hist[:-MAX_HISTORY]

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
