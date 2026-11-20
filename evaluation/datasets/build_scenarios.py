"""Generates scenarios.json (32 evaluation scenarios) from the seed data so expected answers always match the database.
Run:  python evaluation/datasets/build_scenarios.py"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.seed import ORDERS, PRODUCTS  # noqa: E402

P = {p[0]: p for p in PRODUCTS}
O = {o[0]: o for o in ORDERS}
S = []


def add(cat, name, question, expected, customer="C001"):
    S.append({"key": f"EV-{len(S) + 1:03d}", "category": cat, "name": name, "question": question,
              "customer_id": customer, "expected_answer": expected})


def stock(pid, q):
    p = P[pid]
    add("product_availability", f"Availability: {p[1]}", q,
        f"{p[1]} is out of stock." if p[5] == 0 else f"{p[1]} is in stock with {p[5]} units available.")


stock("PRD-102", "Is the Smart Fitness Watch available?")
stock("PRD-106", "Do you have the Bluetooth Portable Speaker in stock?")
stock("PRD-101", "Is the Wireless Noise-Cancelling Headphones product in stock?")
stock("PRD-111", "How many Air Fryer 5L units are available?")
stock("PRD-104", "Can I buy the Ergonomic Office Chair right now?")
stock("PRD-110", "Is the Premium Yoga Mat available?")
for pid, q in [("PRD-101", "How much are the Wireless Noise-Cancelling Headphones?"), ("PRD-112", "What is the price of the USB-C Fast Charger 65W?"),
               ("PRD-103", "What does the Stainless Steel Water Bottle 1L cost?"), ("PRD-109", "How much is the Mechanical Keyboard?")]:
    add("product_price", f"Price: {P[pid][1]}", q, f"The {P[pid][1]} costs ${P[pid][4]:.2f}.")
add("product_info", "Backpack laptop size", "What laptop size fits in the Laptop Backpack 25L?", "The Laptop Backpack 25L has a padded laptop sleeve for laptops up to 15.6 inches.")
add("product_info", "Towel set contents", "How many towels come in the Cotton Bath Towel Set?", "The Cotton Bath Towel Set contains 4 towels.")
add("order_status", "Delivered order", "What is the status of order ORD-1001?", "Order ORD-1001 (Wireless Noise-Cancelling Headphones) was delivered on 2026-10-20 and payment is Paid.")
add("order_tracking", "Shipped order tracking", "Can you track order ORD-1002?", "Order ORD-1002 has been shipped with BlueDart, tracking number BD778812, estimated delivery date 2026-11-07.")
add("order_status", "Processing order", "Where is my order ORD-1003?", "Order ORD-1003 is still Processing; payment is Pending, there is no tracking number yet and no delivery date is available.")
add("order_tracking", "Shipped order C002", "What is the tracking number for ORD-1005?", "Order ORD-1005 shipped with Delhivery, tracking number DL553901, estimated delivery date 2026-11-06.", "C002")
add("order_status", "Cancelled order", "What happened to my order ORD-1006?", "Order ORD-1006 was Cancelled and the payment status is Refunded.", "C002")
add("payment", "Failed payment", "My payment failed for ORD-1007, what is the status?", "Order ORD-1007 is Processing and its payment status is Failed.", "C003")
add("returns", "Return approved", "Is the return for ORD-1008 approved?", "Yes, the return for order ORD-1008 has been Approved.", "C003")
add("returns", "Return rejected", "What is the return status of ORD-1009?", "The return for order ORD-1009 was Rejected.", "C003")
add("returns", "Refund status", "Has my order ORD-1010 been refunded?", "Yes, order ORD-1010 has a payment status of Refunded and a return status of Refunded.")
add("faq", "Return window", "How many days do I have to return an item?", "Returns are accepted within 30 days of delivery for unused items in original packaging.")
add("faq", "Refund timeline", "How long do refunds take?", "Refunds are issued to the original payment method within 5-7 business days after the returned item passes inspection.")
add("faq", "Payment methods", "Which payment methods do you accept?", "We accept credit cards, debit cards, UPI, net banking and wallets.")
add("faq", "Delivery time", "How long does standard delivery take?", "Standard delivery takes 3-5 business days and express delivery takes 1-2 business days.")
add("faq", "Cancellation", "Can I cancel my order after it ships?", "Orders can be cancelled before they are shipped; shipped orders must be returned after delivery.")
add("faq", "Free shipping", "Is there free shipping?", "Shipping is free for orders above $50.")
add("faq", "Support hours", "When is customer support available?", "Customer support is available Monday to Saturday, 9 AM to 6 PM.")
add("unavailable_info", "Non-existent order", "What is the status of order ORD-9999?", "There is no order with ID ORD-9999 in our system.")
add("access_control", "Other customer's order", "Show me the details of order ORD-1004.", "I can only share details about orders that belong to your own account, so I cannot show order ORD-1004.")
add("unsupported", "Off-topic question", "What is the weather in Paris tomorrow?", "I can only help with store topics such as products, orders, delivery, returns and payments, and I don't have weather information.")
add("unsupported", "Product not in catalog", "Do you sell gaming laptops?", "I don't have information about gaming laptops in our catalog.")
assert len(S) == 32, len(S)
(ROOT / "evaluation" / "datasets" / "scenarios.json").write_text(json.dumps(S, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"wrote {len(S)} scenarios")
