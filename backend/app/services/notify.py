"""Notification service.

For the demo: structured log to stdout + notifications.log in the project root.
To upgrade: replace _deliver() with smtplib / SendGrid / SNS.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

_LOG_FILE = Path(__file__).resolve().parents[4] / "notifications.log"


def send_claim_notification(
    *,
    customer_name: str,
    customer_email: str,
    claim_number: str,
    ticket_id: str,
    decision: str,
    component: str | None,
    total_cost: float,
    currency: str = "INR",
) -> None:
    """Notify the customer of their claim outcome."""
    verb = "approved" if decision == "approve" else decision + "ed"
    subject = f"Warranty claim {claim_number} — {verb}"
    body = (
        f"Dear {customer_name},\n\n"
        f"Your warranty claim {claim_number} for "
        f"{component or 'your vehicle'} has been {verb}.\n"
        + (
            f"Approved repair cost: {currency} {total_cost:,.2f}\n"
            if decision == "approve"
            else ""
        )
        + f"\nReference ID: {ticket_id}\n\n"
        "Thank you,\nTech Mahindra After-Sales"
    )
    _deliver(to=customer_email, subject=subject, body=body)


def _deliver(*, to: str, subject: str, body: str) -> None:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "to": to,
              "subject": subject, "body": body}
    logger.info("[NOTIFY] → %s | %s", to, subject)
    try:
        with _LOG_FILE.open("a") as fh:
            fh.write(json.dumps(entry) + "\n")
    except OSError:
        logger.warning("could not write notifications.log")
