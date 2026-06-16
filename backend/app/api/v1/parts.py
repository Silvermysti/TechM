"""Parts inventory read endpoints (dealer portal)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import Principal, require_manager
from app.db.session import get_db
from app.models import PartInventory

router = APIRouter(prefix="/api/v1", tags=["parts"])


class PartOut(BaseModel):
    id: str
    part_name: str
    sku: str
    component: str
    stock_qty: int
    eta_days: int
    unit_price: float
    supplier: str

    model_config = ConfigDict(from_attributes=True)


@router.get("/parts", response_model=list[PartOut])
def list_parts(
    db: Session = Depends(get_db),
    _: Principal = Depends(require_manager),
) -> list[PartInventory]:
    return list(db.scalars(select(PartInventory).order_by(PartInventory.component)).all())
