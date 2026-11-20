"""Diagnoses your setup and tests the live Gemini connection.   Run:  python check_setup.py"""
import importlib, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))
ok_all = True


def line(ok, msg, fix=""):
    global ok_all
    ok_all &= bool(ok)
    print(("  [ OK ] " if ok else "  [FAIL] ") + msg + (f"\n         -> {fix}" if (fix and not ok) else ""))


print("\n1. Python")
v = sys.version_info
line((3, 11) <= v[:2] <= (3, 13), f"Python {v.major}.{v.minor}.{v.micro}",
     "Use Python 3.12 (3.14 is NOT supported: some packages cannot be built). Install from python.org, then run setup.bat again.")

print("\n2. Packages")
for mod, pkg in [("fastapi", "requirements.txt"), ("uvicorn", "requirements.txt"), ("sqlalchemy", "requirements.txt"), ("pydantic_settings", "requirements.txt"),
                 ("pytest", "requirements.txt"), ("playwright", "requirements.txt"), ("deepeval", "deepeval step"), ("ragas", "ragas step"),
                 ("google.genai", "requirements-eval.txt")]:
    try:
        importlib.import_module(mod); line(True, mod)
    except Exception as e:                                           # noqa: BLE001
        line(False, f"{mod}: {type(e).__name__}: {str(e)[:80]}", f"re-run setup.bat ({pkg})")

print("\n3. Settings (.env)")
line((ROOT / ".env").exists(), ".env file exists", "copy .env.example .env   (or re-run setup.bat)")
from app.config import settings  # noqa: E402
line(not settings.mock_mode, f"MOCK_MODE={settings.mock_mode}", "set MOCK_MODE=false in .env to use the real LLM (mock mode is fine for a first look)")
has_key = bool(settings.gemini_api_key)
line(has_key, "GEMINI_API_KEY is set" + (f" (length {len(settings.gemini_api_key)})" if has_key else ""), "paste your key after GEMINI_API_KEY= in .env")
if settings.secret_key == "change-this-secret-in-your-env-file":
    print("  [WARN] SECRET_KEY is still the default (fine on your own laptop; change it before sharing/deploying)\n"
          '         -> python -c "import secrets; print(secrets.token_urlsafe(48))"')
else:
    line(True, "SECRET_KEY changed from the default")

print("\n4. Live Gemini connection")
if not has_key:
    print("  [SKIP] no key configured")
else:
    from app.services.llm import GeminiProvider
    r = GeminiProvider().test_connection()
    line(r["ok"], ("Gemini answered in %s ms" % r.get("latency_ms")) if r["ok"] else f"Gemini call failed: {r.get('message')}",
         "Key rejected -> create a new key; 404 -> check GEMINI_MODEL; 429 -> wait/quota; network -> check internet/proxy.")

print("\nRESULT:", "everything looks good - start the app with start.bat (or python run_app.py)" if ok_all else "fix the [FAIL] lines above, then run this check again")
sys.exit(0 if ok_all else 1)
