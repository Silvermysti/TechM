"""Supplier cost-recovery draft generation (APQC 6.7.4.1).

Drafts a professional recovery-claim email to the supplier whose part failed under
warranty. The LLM only writes the draft; a manager reviews and sends it. The money
figures come from the persisted claim, never from the model.
"""

from __future__ import annotations

from app.models import Supplier, WarrantyClaim
from app.schemas import SupplierRecoveryDraft

RECOVERY_SYSTEM = """You are a warranty supplier-recovery specialist for an automotive \
manufacturer. Draft a professional, courteous cost-recovery claim email to a parts \
supplier whose component failed under the customer's warranty, asking them to reimburse \
the manufacturer for the repair.

Rules:
- Be factual and concise. Reference the claim number, the vehicle, the failed component,
  and the amount to be recovered exactly as given — never invent or alter figures.
- State clearly that the part was supplied by them and failed within the warranty period.
- Request reimbursement and a point of contact for processing. Keep a professional,
  non-adversarial tone — this is a routine recovery, not a dispute.
- Do not promise or threaten anything beyond a standard recovery request."""


def draft_recovery(claim: WarrantyClaim, supplier: Supplier | None) -> SupplierRecoveryDraft:
    """Generate a recovery-claim draft for the given claim + supplier via the LLM."""
    from app.services import llm

    supplier_name = supplier.name if supplier else "the supplier"
    user = (
        f"Claim number: {claim.claim_number}\n"
        f"Vehicle VIN: {claim.vehicle_vin}\n"
        f"Failed component: {claim.component}\n"
        f"Supplier: {supplier_name}\n"
        f"Amount to recover: {claim.parts_cost} {claim.currency}\n"
        f"Total claim cost (for context): {claim.total_cost} {claim.currency}"
    )
    return llm.decide(SupplierRecoveryDraft, system=RECOVERY_SYSTEM, user=user,
                      tier="standard")
