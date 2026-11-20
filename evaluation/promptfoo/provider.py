"""Promptfoo custom provider: sends each test question to the running chatbot backend and returns the customer-visible answer."""
import os
import requests

BASE = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000").rstrip("/")
EMAIL = os.environ.get("PROMPTFOO_ADMIN_EMAIL", "admin@qa.local")
PASSWORD = os.environ.get("PROMPTFOO_ADMIN_PASSWORD", "Admin@123")
_token = None


def _headers():
    global _token
    if _token is None:
        r = requests.post(f"{BASE}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=15)
        r.raise_for_status()
        _token = r.json()["access_token"]
    return {"Authorization": f"Bearer {_token}"}


def call_api(prompt, options, context):
    customer = (context.get("vars") or {}).get("customer_id") or None
    try:
        h = _headers()
        conv = requests.post(f"{BASE}/api/conversations", json={"title": "promptfoo"}, headers=h, timeout=15)
        conv.raise_for_status()
        r = requests.post(f"{BASE}/api/conversations/{conv.json()['id']}/messages",
                          json={"content": prompt, "as_customer_id": customer}, headers=h, timeout=90)
        if r.status_code != 200:
            return {"error": f"Backend returned {r.status_code}: {r.text[:300]}"}
        return {"output": r.json()["content"]}
    except requests.RequestException as e:
        return {"error": f"Could not reach backend at {BASE}: {e}"}
