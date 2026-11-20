from datetime import date, datetime
from typing import Any, Optional
from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base, utcnow


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    name: Mapped[str] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(20), default="customer")        # admin | customer
    customer_id: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)  # private data, never given to the LLM


class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(60))
    description: Mapped[str] = mapped_column(Text)
    price: Mapped[float] = mapped_column(Float)
    stock: Mapped[int] = mapped_column(Integer, default=0)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[str] = mapped_column(String(20), primary_key=True)
    customer_id: Mapped[str] = mapped_column(ForeignKey("users.customer_id"), index=True)
    product_id: Mapped[str] = mapped_column(ForeignKey("products.id"))
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(30))
    delivery_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    payment_status: Mapped[str] = mapped_column(String(30))
    return_status: Mapped[str] = mapped_column(String(30), default="None")
    carrier: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    tracking_number: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    product: Mapped[Product] = relationship()


class Faq(Base):
    __tablename__ = "faqs"
    id: Mapped[str] = mapped_column(String(30), primary_key=True)
    topic: Mapped[str] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text)


class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(120), default="New conversation")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan",
                                                     order_by="Message.id")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(10))                 # user | assistant
    content: Mapped[str] = mapped_column(Text)                    # what the customer sees (after PII guard)
    raw_content: Mapped[Optional[str]] = mapped_column(Text, nullable=True)   # raw model output
    retrieved_context: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    guard_redacted: Mapped[bool] = mapped_column(Boolean, default=False)
    latency_ms: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class TestCase(Base):
    """Evaluation scenarios and security cases (the 'evaluation datasets')."""
    __tablename__ = "test_cases"
    __test__ = False
    __table_args__ = (UniqueConstraint("suite", "key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    suite: Mapped[str] = mapped_column(String(20), index=True)    # evaluation | security
    key: Mapped[str] = mapped_column(String(40))
    category: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200))
    payload: Mapped[Any] = mapped_column(JSON)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class TestRun(Base):
    """One execution of a suite (deepeval, ragas, promptfoo, security, pytest)."""
    __tablename__ = "test_runs"
    __test__ = False
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), index=True)
    params: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")   # queued running completed completed_with_errors failed skipped
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    total: Mapped[int] = mapped_column(Integer, default=0)
    passed: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[int] = mapped_column(Integer, default=0)
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class EvalResult(Base):
    """One metric result for one scenario. DeepEval, Ragas and Promptfoo rows are separated by `framework`."""
    __tablename__ = "eval_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("test_runs.id"), index=True)
    framework: Mapped[str] = mapped_column(String(20), index=True)
    scenario_key: Mapped[str] = mapped_column(String(60))
    metric: Mapped[str] = mapped_column(String(120))
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    threshold: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    question: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    expected_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retrieved_context: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    actual_output: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class SecurityResult(Base):
    __tablename__ = "security_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("test_runs.id"), index=True)
    case_key: Mapped[str] = mapped_column(String(40))
    category: Mapped[str] = mapped_column(String(40))
    prompt: Mapped[str] = mapped_column(Text)
    response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    findings: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ExecutionRecord(Base):
    """One software test (pytest) result: unit, integration, api, functional, regression, llm_eval, security, ui."""
    __tablename__ = "execution_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("test_runs.id"), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(20), index=True)
    name: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(10), index=True)     # passed failed skipped error
    duration_ms: Mapped[float] = mapped_column(Float, default=0)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    details: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ApiCall(Base):
    """Every HTTP call made by the API test suite (used for latency metrics)."""
    __tablename__ = "api_calls"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[Optional[int]] = mapped_column(ForeignKey("test_runs.id"), nullable=True, index=True)
    test_name: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(200))
    status_code: Mapped[int] = mapped_column(Integer)
    latency_ms: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))
