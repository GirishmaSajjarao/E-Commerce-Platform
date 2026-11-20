"""Sample e-commerce data (development only) and dataset seeding."""
import json
from datetime import date
from sqlalchemy.orm import Session
from app.config import ROOT
from app.models import Faq, Order, Product, TestCase, User
from app.security import hash_password

ADMIN = dict(email="admin@qa.local", password="Admin@123", name="QA Admin")
CUSTOMER_PASSWORD = "Customer@123"
CUSTOMERS = [
    ("C001", "alice@example.com", "Alice Johnson", "+1-555-0101"),
    ("C002", "bob@example.com", "Bob Smith", "+1-555-0102"),
    ("C003", "carol@example.com", "Carol Lee", "+1-555-0103"),
]
PRODUCTS = [
    ("PRD-101", "Wireless Noise-Cancelling Headphones", "Electronics", "Over-ear Bluetooth headphones with active noise cancellation and 30-hour battery life.", 129.99, 42),
    ("PRD-102", "Smart Fitness Watch", "Electronics", "Water-resistant fitness watch with heart-rate monitor, GPS and 7-day battery.", 89.50, 0),
    ("PRD-103", "Stainless Steel Water Bottle 1L", "Home & Kitchen", "Double-wall insulated 1 litre bottle that keeps drinks cold for 24 hours.", 24.99, 150),
    ("PRD-104", "Ergonomic Office Chair", "Furniture", "Adjustable lumbar support, breathable mesh back and 4D armrests.", 249.00, 8),
    ("PRD-105", "Trail Pro Running Shoes", "Footwear", "Lightweight trail running shoes with high-grip outsole.", 79.95, 35),
    ("PRD-106", "Bluetooth Portable Speaker", "Electronics", "Waterproof portable speaker with 12-hour playtime.", 49.99, 0),
    ("PRD-107", "Cotton Bath Towel Set", "Home & Kitchen", "Set of 4 soft 100% cotton bath towels.", 34.00, 60),
    ("PRD-108", "Laptop Backpack 25L", "Accessories", "Water-resistant 25 litre backpack with padded laptop sleeve up to 15.6 inches.", 44.90, 23),
    ("PRD-109", "Mechanical Keyboard", "Electronics", "Hot-swappable mechanical keyboard with tactile switches and RGB backlight.", 99.00, 15),
    ("PRD-110", "Premium Yoga Mat", "Sports", "6mm non-slip eco-friendly yoga mat.", 29.99, 80),
    ("PRD-111", "Air Fryer 5L", "Home & Kitchen", "5 litre digital air fryer with 8 cooking presets.", 119.00, 3),
    ("PRD-112", "USB-C Fast Charger 65W", "Electronics", "Compact 65W GaN charger with two USB-C ports.", 39.99, 120),
]
# id, customer, product, qty, status, delivery_date, payment, return, carrier, tracking
ORDERS = [
    ("ORD-1001", "C001", "PRD-101", 1, "Delivered", date(2026, 10, 20), "Paid", "None", "BlueDart", "BD770001"),
    ("ORD-1002", "C001", "PRD-103", 2, "Shipped", date(2026, 11, 7), "Paid", "None", "BlueDart", "BD778812"),
    ("ORD-1003", "C001", "PRD-109", 1, "Processing", None, "Pending", "None", None, None),
    ("ORD-1004", "C002", "PRD-104", 1, "Delivered", date(2026, 10, 12), "Paid", "Requested", "Delhivery", "DL553100"),
    ("ORD-1005", "C002", "PRD-105", 1, "Shipped", date(2026, 11, 6), "Paid", "None", "Delhivery", "DL553901"),
    ("ORD-1006", "C002", "PRD-112", 3, "Cancelled", None, "Refunded", "None", None, None),
    ("ORD-1007", "C003", "PRD-111", 1, "Processing", None, "Failed", "None", None, None),
    ("ORD-1008", "C003", "PRD-107", 1, "Delivered", date(2026, 10, 28), "Paid", "Approved", "Ecom Express", "EE210045"),
    ("ORD-1009", "C003", "PRD-108", 1, "Delivered", date(2026, 10, 5), "Paid", "Rejected", "Ecom Express", "EE209977"),
    ("ORD-1010", "C001", "PRD-110", 1, "Delivered", date(2026, 9, 30), "Refunded", "Refunded", "BlueDart", "BD761234"),
]
FAQS = [
    ("faq-returns", "Returns", "Returns are accepted within 30 days of delivery for unused items in their original packaging. Start a return from the Orders page."),
    ("faq-refunds", "Refunds", "Refunds go to the original payment method within 5-7 business days after the returned item passes inspection."),
    ("faq-payment", "Payment", "We accept credit cards, debit cards, UPI, net banking and wallets. If a payment fails and money was debited, it is automatically reversed within 3-5 business days."),
    ("faq-delivery", "Delivery", "Standard delivery takes 3-5 business days and express delivery takes 1-2 business days. Shipping is free for orders above $50."),
    ("faq-tracking", "Tracking", "A carrier name and tracking number are added to an order once it has shipped. Orders that are still processing have no tracking number yet."),
    ("faq-cancel", "Cancellation", "Orders can be cancelled any time before they are shipped. Shipped orders must be returned after delivery."),
    ("faq-support", "Support hours", "Customer support is available Monday to Saturday, 9 AM to 6 PM. This chatbot cannot place calls or send emails."),
    ("faq-privacy", "Privacy", "We never share customer personal data, and the chatbot can only show orders that belong to the logged-in customer."),
]


def seed_db(db: Session) -> None:
    if db.query(User).count() == 0:
        db.add(User(email=ADMIN["email"], password_hash=hash_password(ADMIN["password"]), name=ADMIN["name"], role="admin"))
        for cid, email, name, phone in CUSTOMERS:
            db.add(User(email=email, password_hash=hash_password(CUSTOMER_PASSWORD), name=name, role="customer",
                        customer_id=cid, phone=phone))
        db.flush()
    if db.query(Product).count() == 0:
        db.add_all([Product(id=p[0], name=p[1], category=p[2], description=p[3], price=p[4], stock=p[5]) for p in PRODUCTS])
        db.flush()
    if db.query(Order).count() == 0:
        db.add_all([Order(id=o[0], customer_id=o[1], product_id=o[2], quantity=o[3], status=o[4], delivery_date=o[5],
                          payment_status=o[6], return_status=o[7], carrier=o[8], tracking_number=o[9]) for o in ORDERS])
    if db.query(Faq).count() == 0:
        db.add_all([Faq(id=f[0], topic=f[1], text=f[2]) for f in FAQS])
    db.commit()
    seed_test_cases(db)


def seed_test_cases(db: Session) -> None:
    """Load dataset JSON files into the test_cases table (only keys that do not exist yet)."""
    for suite, filename in (("evaluation", "scenarios.json"), ("security", "security_cases.json")):
        path = ROOT / "evaluation" / "datasets" / filename
        if not path.exists():
            continue
        existing = {k for (k,) in db.query(TestCase.key).filter(TestCase.suite == suite)}
        for item in json.loads(path.read_text(encoding="utf-8")):
            if item["key"] in existing:
                continue
            db.add(TestCase(suite=suite, key=item["key"], category=item["category"], name=item["name"], payload=item))
    db.commit()
