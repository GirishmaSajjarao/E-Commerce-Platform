from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Order, Product, User
from app.schemas import LoginIn
from app.security import create_token, current_user, verify_password

router = APIRouter()


def user_out(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "customer_id": u.customer_id}


def order_out(o: Order) -> dict:
    return {"id": o.id, "customer_id": o.customer_id, "product_id": o.product_id, "product_name": o.product.name,
            "quantity": o.quantity, "status": o.status, "delivery_date": o.delivery_date.isoformat() if o.delivery_date else None,
            "payment_status": o.payment_status, "return_status": o.return_status, "carrier": o.carrier, "tracking_number": o.tracking_number}


def product_out(p: Product) -> dict:
    return {"id": p.id, "name": p.name, "category": p.category, "description": p.description, "price": p.price,
            "stock": p.stock, "in_stock": p.stock > 0}


@router.post("/auth/login", tags=["Authentication"])
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password.")
    return {"access_token": create_token(user), "token_type": "bearer", "user": user_out(user)}


@router.get("/auth/me", tags=["Authentication"])
def me(user: User = Depends(current_user)):
    return user_out(user)


@router.get("/products", tags=["Products"])
def products(category: str | None = None, _: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Product)
    if category:
        q = q.filter(Product.category == category)
    return [product_out(p) for p in q.order_by(Product.id)]


@router.get("/products/{product_id}", tags=["Products"])
def product(product_id: str, _: User = Depends(current_user), db: Session = Depends(get_db)):
    p = db.get(Product, product_id.upper())
    if not p:
        raise HTTPException(404, f"Product {product_id} not found.")
    return product_out(p)


@router.get("/orders", tags=["Orders"])
def orders(user: User = Depends(current_user), db: Session = Depends(get_db)):
    q = db.query(Order)
    if user.role != "admin":
        q = q.filter(Order.customer_id == user.customer_id)
    return [order_out(o) for o in q.order_by(Order.id)]


@router.get("/orders/{order_id}", tags=["Orders"])
def order(order_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    o = db.get(Order, order_id.upper())
    if not o:
        raise HTTPException(404, f"Order {order_id} not found.")
    if user.role != "admin" and o.customer_id != user.customer_id:
        raise HTTPException(403, "You are not allowed to view this order.")
    return order_out(o)
