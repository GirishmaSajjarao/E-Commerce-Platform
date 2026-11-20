from typing import Literal, Optional
from pydantic import BaseModel, EmailStr, Field


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    as_customer_id: Optional[str] = Field(default=None, max_length=20)


class ConversationIn(BaseModel):
    title: str = Field(default="New conversation", max_length=120)


class EvalRunIn(BaseModel):
    framework: Literal["deepeval", "ragas", "promptfoo"]
    limit: Optional[int] = Field(default=None, ge=1, le=200)
    promptfoo_suite: Literal["deterministic", "rubric"] = "deterministic"


class SecurityRunIn(BaseModel):
    case_keys: Optional[list[str]] = None


class TestExecuteIn(BaseModel):
    suite: Literal["unit", "integration", "api", "functional", "regression", "llm_eval", "security", "ui", "offline", "all"]


class TestCaseIn(BaseModel):
    suite: Literal["evaluation", "security"]
    key: str = Field(min_length=2, max_length=40)
    category: str = Field(min_length=2, max_length=40)
    name: str = Field(min_length=2, max_length=200)
    payload: dict


class ThresholdsIn(BaseModel):
    eval_threshold: float = Field(ge=0, le=1)
    hallucination_threshold: float = Field(ge=0, le=1)


class ReportIn(BaseModel):
    format: Literal["html", "json"] = "html"
