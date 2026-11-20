"""Central configuration. Values come from environment variables or the .env file in the project root."""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    mock_mode: bool = True                      # True = no real LLM calls, responses are clearly labelled MOCK
    llm_provider: str = "gemini"                # provider registry key (see services/llm.py)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    database_url: str = f"sqlite:///{(ROOT / 'database' / 'qa_platform.db').as_posix()}"
    secret_key: str = "change-this-secret-in-your-env-file"
    token_ttl_minutes: int = 480
    eval_threshold: float = 0.7                 # default pass threshold for "higher is better" metrics
    hallucination_threshold: float = 0.5        # hallucination score must be <= this
    llm_timeout_seconds: int = 60
    reports_dir: str = str(ROOT / "reports")


settings = Settings()
