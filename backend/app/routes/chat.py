import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Conversation, User
from app.schemas import ConversationIn, MessageIn
from app.security import current_user
from app.services import chat as chat_svc
from app.services.llm import LLMError

router = APIRouter(tags=["Chatbot"])
log = logging.getLogger(__name__)


def msg_out(m) -> dict:
    return {"id": m.id, "role": m.role, "content": m.content, "is_mock": m.is_mock, "guard_redacted": m.guard_redacted,
            "latency_ms": m.latency_ms, "retrieved_context": m.retrieved_context, "created_at": m.created_at.isoformat()}


def own_conversation(db: Session, conv_id: str, user: User) -> Conversation:
    conv = db.get(Conversation, conv_id)
    if not conv or conv.user_id != user.id:
        raise HTTPException(404, "Conversation not found.")
    return conv


@router.post("/conversations", status_code=201)
def create(body: ConversationIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = chat_svc.create_conversation(db, user, body.title)
    return {"id": c.id, "title": c.title, "created_at": c.created_at.isoformat()}


@router.get("/conversations")
def list_conversations(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.query(Conversation).filter(Conversation.user_id == user.id).order_by(Conversation.created_at.desc()).all()
    return [{"id": c.id, "title": c.title, "created_at": c.created_at.isoformat(), "message_count": len(c.messages)} for c in rows]


@router.get("/conversations/{conv_id}/messages")
def messages(conv_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return [msg_out(m) for m in own_conversation(db, conv_id, user).messages]


@router.post("/conversations/{conv_id}/messages")
def send(conv_id: str, body: MessageIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    conv = own_conversation(db, conv_id, user)
    try:
        return msg_out(chat_svc.send_message(db, conv, user, body.content, body.as_customer_id))
    except ValueError as e:
        raise HTTPException(422, str(e))
    except LLMError as e:
        log.error("LLM error in chat: %s %s", e.code, e.message)
        raise HTTPException(502, {"code": e.code, "message": e.message})


@router.delete("/conversations/{conv_id}", status_code=204)
def delete(conv_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    db.delete(own_conversation(db, conv_id, user))
    db.commit()
