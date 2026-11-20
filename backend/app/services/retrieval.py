"""Retrieval: collects product, order and FAQ facts the chatbot is allowed to use for the current customer."""
import re
from sqlalchemy.orm import Session
from app.models import Faq, Order, Product

STOP = set("a an the is are was were be to of for on in at and or my me i you your do does can could would will what when where how "
           "it this that with about please tell any have has there their our us we".split())
ORDER_RE = re.compile(r"\bORD-\d{3,6}\b", re.I)
PRODUCT_RE = re.compile(r"\bPRD-\d{3}\b", re.I)


def _stem(w: str) -> str:
    if len(w) > 4 and w.endswith(("ches", "shes", "xes")):
        return w[:-2]
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w


def tokens(text: str) -> set[str]:
    return {_stem(w) for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP}


def describe_product(p: Product) -> str:
    stock = f"in stock ({p.stock} units available)" if p.stock > 0 else "out of stock"
    return (f"Product {p.id}: {p.name}; category: {p.category}; price: ${p.price:.2f}; availability: {stock}; "
            f"description: {p.description}")


def describe_order(o: Order) -> str:
    date_txt = o.delivery_date.isoformat() if o.delivery_date else "not available"
    label = "estimated delivery date" if o.status == "Shipped" else "delivery date"
    extra = f"; carrier: {o.carrier}; tracking number: {o.tracking_number}" if o.tracking_number else "; tracking number: not available yet"
    return (f"Order {o.id}: {o.quantity} x {o.product.name}; status: {o.status}; {label}: {date_txt}; "
            f"payment status: {o.payment_status}; return status: {o.return_status}{extra}")


def retrieve(db: Session, query: str, customer_id: str | None, recent_user_text: str = "") -> list[dict]:
    """Returns [{id, type, text}]. Access check: an order is only returned when it belongs to customer_id."""
    ctx: list[dict] = []
    for oid in dict.fromkeys(m.upper() for m in ORDER_RE.findall(query)):
        order = db.get(Order, oid)
        if order is None:
            ctx.append({"id": oid, "type": "order", "text": f"No order with ID {oid} exists in our system."})
        elif customer_id is None or order.customer_id != customer_id:
            ctx.append({"id": oid, "type": "order_denied",
                        "text": f"Order {oid} cannot be shown because it does not belong to the logged-in customer. Do not reveal any details about it."})
        else:
            ctx.append({"id": oid, "type": "order", "text": describe_order(order)})

    q_tokens = tokens(query)
    asks_orders = bool(q_tokens & {"order", "track", "tracking", "package", "parcel", "shipment"})
    if not any(c["type"].startswith("order") for c in ctx) and asks_orders:
        if customer_id:
            mine = db.query(Order).filter(Order.customer_id == customer_id).order_by(Order.id).all()
            hist = ORDER_RE.findall(recent_user_text)
            picked = [o for o in mine if o.id in {h.upper() for h in hist}] or mine
            ctx += [{"id": o.id, "type": "order", "text": describe_order(o)} for o in picked]
        else:
            ctx.append({"id": "no-login", "type": "note", "text": "The customer is not linked to a customer account, so no order data is available."})

    products = db.query(Product).all()
    explicit = {m.upper() for m in PRODUCT_RE.findall(query)}
    scored = []
    for p in products:
        name_t, desc_t = tokens(p.name), tokens(p.description + " " + p.category)
        score = 3 * len(q_tokens & name_t) + len(q_tokens & desc_t)
        if p.id in explicit:
            score += 10
        if score >= 3 and (len(q_tokens & name_t) >= 1 or p.id in explicit):
            scored.append((score, p))
    for _, p in sorted(scored, key=lambda x: -x[0])[:3]:
        ctx.append({"id": p.id, "type": "product", "text": describe_product(p)})

    faq_scored = []
    for f in db.query(Faq).all():
        s = len(q_tokens & tokens(f.topic + " " + f.text))
        if s >= 2 or (q_tokens & tokens(f.topic)):
            faq_scored.append((s, f))
    for _, f in sorted(faq_scored, key=lambda x: -x[0])[:2]:
        ctx.append({"id": f.id, "type": "faq", "text": f"{f.topic}: {f.text}"})

    if not ctx and recent_user_text:           # follow-up question: retry using earlier customer messages
        return retrieve(db, recent_user_text, customer_id, "")
    return ctx
