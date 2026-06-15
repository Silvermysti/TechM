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
    ClaimCode,
    Customer,
    PartInventory,
    Recall,
    Supplier,
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

# Part vendors — the counterparty for warranty cost recovery.
# (code, name, is_oem, recovery_email)
SUPPLIERS = [
    ("OEM-001", "OEM Parts Co.", True, "warranty@oemparts.example"),
    ("BSH-001", "Bosch India", False, "recovery@bosch.example"),
    ("CNT-001", "Continental Auto", False, "claims@continental.example"),
    ("EXD-001", "Exide Industries", False, "warranty@exide.example"),
]

# (name, component, stock_qty, eta_days, unit_price_INR, supplier_code)
COMPONENTS_FOR_PARTS = [
    ("AC Compressor", "ac", 2, 1, 28000, "CNT-001"),
    ("Brake Pad Set", "brakes", 0, 3, 4500, "BSH-001"),
    ("Alternator", "electrical", 4, 1, 9500, "BSH-001"),
    ("Infotainment Unit", "infotainment", 1, 5, 22000, "CNT-001"),
    ("Transmission Kit", "transmission", 0, 7, 65000, "OEM-001"),
    ("Battery Pack", "battery", 3, 2, 18000, "EXD-001"),
]

# Fault / labor-operation catalog: standard repair time + rate per component.
# (code, component, description, standard_labor_hours, labor_rate_INR, coverage_category)
CLAIM_CODES = [
    ("LAB-AC-001", "ac", "AC compressor remove & replace", 2.5, 850, "comfort"),
    ("LAB-BRK-001", "brakes", "Front brake caliper & pad replace", 1.8, 850, "safety"),
    ("LAB-ENG-001", "engine", "Engine diagnostic & repair", 4.0, 950, "powertrain"),
    ("LAB-TRN-001", "transmission", "Transmission overhaul", 7.5, 950, "powertrain"),
    ("LAB-ELE-001", "electrical", "Alternator replace", 1.5, 800, "electrical"),
    ("LAB-INF-001", "infotainment", "Infotainment unit replace", 1.2, 800, "comfort"),
    ("LAB-BAT-001", "battery", "Battery pack replace", 1.0, 800, "electrical"),
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

        # Suppliers (cost-recovery counterparties)
        suppliers_by_code = {}
        supplier_names = {}
        for code, name, is_oem, email in SUPPLIERS:
            sup = Supplier(code=code, name=name, is_oem=is_oem, recovery_email=email)
            db.add(sup)
            db.flush()
            suppliers_by_code[code] = sup.id
            supplier_names[code] = name

        # Claim / labor-operation codes (standard repair times)
        for code, comp, desc, hours, rate, cat in CLAIM_CODES:
            db.add(ClaimCode(code=code, component=comp, description=desc,
                             standard_labor_hours=hours, labor_rate=rate,
                             coverage_category=cat))

        # Parts inventory (with price + supplier link)
        for name, comp, qty, eta, price, sup_code in COMPONENTS_FOR_PARTS:
            db.add(PartInventory(part_name=name, sku=f"SKU-{comp.upper()}-{qty}{eta}",
                                 component=comp, stock_qty=qty, eta_days=eta,
                                 unit_price=price,
                                 supplier=supplier_names.get(sup_code, ""),
                                 supplier_id=suppliers_by_code.get(sup_code)))

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
              f"{len(MODELS)} policies, {len(SUPPLIERS)} suppliers, "
              f"{len(CLAIM_CODES)} claim codes, {len(COMPONENTS_FOR_PARTS)} parts, "
              f"1 recall.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
