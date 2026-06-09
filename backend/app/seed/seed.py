"""Seed the database with a realistic mock fleet.

Run:  python -m app.seed.seed
Drops + recreates all tables, then inserts customers, vehicles, warranty policies,
parts inventory, and recalls. The data is shaped to drive the demo:
  * varied purchase dates so some warranties are valid and some expired
  * a Swift cohort with AC coverage (the Phase 1 warranty demo)
  * a recall on Honda City 2023 brakes with several affected VINs (Phase 2 fan-out)
  * some parts at 0 stock (forces a supply order in the parts demo)
"""

from __future__ import annotations

import random
from datetime import date, timedelta

from app.db.session import Base, SessionLocal, engine
from app.models import (
    Customer,
    PartInventory,
    Recall,
    Vehicle,
    WarrantyPolicy,
)

random.seed(42)

FIRST_NAMES = [
    "Rajesh", "Priya", "Amit", "Sneha", "Vikram", "Anjali", "Rahul", "Divya",
    "Karan", "Meera", "Arjun", "Pooja", "Sanjay", "Neha", "Rohan", "Kavya",
    "Aditya", "Isha", "Manish", "Ritu", "Suresh", "Tara", "Nikhil", "Geeta",
    "Varun", "Shreya", "Deepak", "Anita", "Gaurav", "Lata",
]
LAST_NAMES = [
    "Sharma", "Verma", "Gupta", "Singh", "Kumar", "Patel", "Reddy", "Nair",
    "Iyer", "Mehta", "Joshi", "Rao", "Desai", "Bose", "Chopra",
]

# (model, year, covered_components, warranty_months)
MODELS = [
    ("Swift VXI", 2024, ["ac", "engine", "transmission", "electrical"], 36),
    ("Honda City", 2023, ["engine", "transmission", "brakes", "electrical"], 36),
    ("Hyundai Creta", 2024, ["ac", "engine", "infotainment", "electrical"], 60),
    ("Tata Nexon", 2023, ["ac", "battery", "engine", "electrical"], 36),
]

COMPONENTS_FOR_PARTS = [
    ("AC Compressor", "ac", 2, 1),
    ("Brake Pad Set", "brakes", 0, 3),
    ("Alternator", "electrical", 4, 1),
    ("Infotainment Unit", "infotainment", 1, 5),
    ("Transmission Kit", "transmission", 0, 7),
    ("Battery Pack", "battery", 3, 2),
]


def _vin(i: int) -> str:
    # Deterministic 17-char pseudo-VIN.
    body = f"{i:06d}"
    return ("MA3" + "".join(random.choice("ABCDEFGHJKLMNPRSTUVWXYZ0123456789")
                            for _ in range(8)) + body)[:17]


def seed() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Warranty policies (one per model)
        for model, _year, comps, months in MODELS:
            db.add(WarrantyPolicy(model=model, duration_months=months,
                                  covered_components=comps))

        # Parts inventory
        for name, comp, qty, eta in COMPONENTS_FOR_PARTS:
            db.add(PartInventory(part_name=name, sku=f"SKU-{comp.upper()}-{qty}{eta}",
                                 component=comp, stock_qty=qty, eta_days=eta,
                                 supplier="OEM Parts Co."))

        # Customers + vehicles
        today = date.today()
        vin_counter = 1
        for i in range(30):
            cust = Customer(
                name=f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}",
                email=f"customer{i+1}@example.com",
                phone=f"+9198{random.randint(10000000, 99999999)}",
            )
            db.add(cust)
            db.flush()  # get cust.id

            for _ in range(random.randint(1, 2)):
                model, year, _comps, _months = random.choice(MODELS)
                # purchase 1..48 months ago -> mix of valid/expired warranties
                months_ago = random.randint(1, 48)
                purchase = today - timedelta(days=30 * months_ago)
                db.add(Vehicle(vin=_vin(vin_counter), customer_id=cust.id,
                               model=model, year=year, purchase_date=purchase))
                vin_counter += 1

        db.flush()

        # Guarantee a clean Phase 1 demo case: a Swift with a *valid* warranty,
        # purchased 3 months ago (AC failure scenario).
        demo_cust = Customer(name="Rajesh Sharma", email="rajesh.demo@example.com",
                             phone="+919812345678")
        db.add(demo_cust)
        db.flush()
        db.add(Vehicle(vin="MA3DEMO00000SWIFT", customer_id=demo_cust.id,
                       model="Swift VXI", year=2024,
                       purchase_date=today - timedelta(days=90)))

        # Guarantee a recall cohort: Honda City 2023 brakes — affected VINs.
        recall_cust = Customer(name="Recall Cohort", email="recall@example.com")
        db.add(recall_cust)
        db.flush()
        for k in range(6):
            db.add(Vehicle(vin=f"MA3CITY2023BRK{k:03d}"[:17], customer_id=recall_cust.id,
                           model="Honda City", year=2023,
                           purchase_date=today - timedelta(days=200 + k)))

        db.add(Recall(code="RC-2026-BRK01", model="Honda City", year=2023,
                      component="brakes",
                      description="Front brake caliper may seize under heavy load.",
                      status="open"))

        db.commit()

        n_cust = db.query(Customer).count()
        n_veh = db.query(Vehicle).count()
        print(f"Seeded: {n_cust} customers, {n_veh} vehicles, "
              f"{len(MODELS)} policies, {len(COMPONENTS_FOR_PARTS)} parts, 1 recall.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
