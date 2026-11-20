"""Chat pipeline: retrieve -> prompt -> LLM -> PII guard. Used by the API, security tests and evaluations."""
import time, uuid, logging
from dataclasses import dataclass, field
from sqlalchemy.orm import Session
from app.models import Conversation, Message, User
from app.services.guard import redact_pii
from app.services.llm import SYSTEM_PROMPT, LLMError, get_provider
from app.services.retrieval import retrieve

log = logging.getLogger(__name__)
MAX_LEN = 2000


@dataclass
class Answer:
    text: str
    raw: str
    context: list[dict]
    latency_ms: float
    is_mock: bool
    redacted: bool = False
    context_texts: list[str] = field(default_factory=list)


def build_prompt(context: list[dict], text: str) -> str:
    ctx = "\n".join(f"- {c['text']}" for c in context) or "(no relevant information found)"
    return f"CONTEXT (from store systems):\n{ctx}\n\nCUSTOMER MESSAGE:\n<<<\n{text}\n>>>"


def answer_question(db: Session, text: str, customer_id: str | None, history: list[dict] | None = None) -> Answer:
    """Raises LLMError on provider failure."""
    history = history or []
    recent_users = " ".join(h["content"] for h in history if h["role"] == "user")[-400:]
    context = retrieve(db, text, customer_id, recent_users)
    provider = get_provider()
    t0 = time.perf_counter()
    raw = provider.generate(SYSTEM_PROMPT, history[-10:], build_prompt(context, text))
    latency = (time.perf_counter() - t0) * 1000
    safe, redacted = redact_pii(raw)
    return Answer(text=safe, raw=raw, context=context, latency_ms=round(latency, 1), is_mock=provider.is_mock,
                  redacted=redacted, context_texts=[c["text"] for c in context])


def validate_text(text: str) -> str:
    text = (text or "").strip()
    if not text:
        raise ValueError("Message cannot be empty.")
    if len(text) > MAX_LEN:
        raise ValueError(f"Message is too long (max {MAX_LEN} characters).")
    return text


def create_conversation(db: Session, user: User, title: str = "New conversation") -> Conversation:
    conv = Conversation(id=str(uuid.uuid4()), user_id=user.id, title=title[:120])
    db.add(conv)
    db.commit()
    return conv


def send_message(db: Session, conv: Conversation, user: User, text: str, as_customer_id: str | None = None) -> Message:
    text = validate_text(text)
    effective = user.customer_id
    if as_customer_id and user.role == "admin":        # QA admins may impersonate a customer for testing
        effective = as_customer_id
    history = [{"role": m.role, "content": m.raw_content or m.content} for m in conv.messages]
    user_msg = Message(conversation_id=conv.id, role="user", content=text)
    db.add(user_msg)
    if conv.title == "New conversation":
        conv.title = text[:60]
    db.commit()                                         # user message is preserved even if the LLM call fails
    ans = answer_question(db, text, effective, history)
    msg = Message(conversation_id=conv.id, role="assistant", content=ans.text, raw_content=ans.raw,
                  retrieved_context=ans.context, is_mock=ans.is_mock, guard_redacted=ans.redacted, latency_ms=ans.latency_ms)
    db.add(msg)
    db.commit()
    return msg
