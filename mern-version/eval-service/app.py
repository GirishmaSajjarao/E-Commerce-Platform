"""Local HTTP evaluation worker. The storefront API owns persistence."""
import hmac
import json
import os
from concurrent.futures import ThreadPoolExecutor
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import HTTPCookieProcessor, Request, build_opener

from metrics import build_scorer


def load_environment():
    path = Path(__file__).with_name(".env")
    if path.exists():
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.partition("=")
            if separator and not key.lstrip().startswith("#"):
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_environment()
API = os.getenv("API_URL", "http://127.0.0.1:5000").rstrip("/")
TOKEN = os.getenv("EVAL_SERVICE_TOKEN", "")
POOL = ThreadPoolExecutor(max_workers=1)


def post(opener, route, data, evaluator=False):
    headers = {"Content-Type": "application/json"}
    if evaluator:
        headers["X-Eval-Token"] = TOKEN
    request = Request(API + route, data=json.dumps(data).encode(), headers=headers)
    with opener.open(request, timeout=65) as response:
        return json.loads(response.read()) if response.status != 204 else None


def evaluate(job):
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    report = {"runId": job["runId"], "framework": job["framework"], "status": "completed", "rows": []}
    key = os.getenv("GEMINI_API_KEY", "")
    if job["mock"] or os.getenv("MOCK_MODE", "true").lower() == "true":
        report.update(status="skipped", error="Mock mode is enabled. No LLM scores were generated.")
    elif not key:
        report.update(status="failed", error="Set GEMINI_API_KEY in eval-service/.env.")
    else:
        try:
            score = build_scorer(job["framework"], key, os.getenv("GEMINI_MODEL", "gemini-3.5-flash"), job["settings"])
            post(opener, "/api/auth/login", {
                "email": os.getenv("ADMIN_EMAIL", "admin@qa.local"),
                "password": os.getenv("ADMIN_PASSWORD") or "Admin@123",
            })
            errors = 0
            for scenario in job["scenarios"]:
                try:
                    metadata = {"title": "Evaluation verification"}
                    if scenario.get("customer_id"):
                        metadata["customerId"] = scenario["customer_id"]
                    conversation = post(opener, "/api/chat/conversations", metadata)
                    answer = post(opener, f"/api/chat/conversations/{conversation['id']}/messages", {"content": scenario["question"]})
                    if answer.get("isMock"):
                        report.update(status="skipped", error="The chatbot returned a mock answer.", rows=[])
                        break
                    report["rows"].append({"key": scenario["key"], "metrics": score(scenario, answer)})
                except Exception as error:
                    errors += 1
                    text = str(error).lower()
                    status = getattr(error, "code", None)
                    if status in (401, 403, 429) or any(value in text for value in ("quota", "api key", "resource_exhausted", "rate limit", "429")):
                        report.update(status="failed", error="Stopped early. Check the Gemini key, account permissions, and quota.")
                        break
            if errors and report["status"] == "completed":
                report.update(status="completed_with_errors", error=f"{errors} scenario(s) could not be scored.")
        except Exception as error:
            report.update(status="failed", error=f"Evaluator setup failed ({type(error).__name__}). Check dependencies, credentials, and the chatbot API.")
    try:
        post(opener, "/api/qa/eval-results", report, evaluator=True)
        print(f"{job['framework']} {report['status']} ({len(report['rows'])} scenario results)", flush=True)
    except Exception as error:
        print(f"Could not upload evaluation results ({type(error).__name__}).", flush=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, content):
        data = json.dumps(content).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"status": "ok"})
        else:
            self.reply(404, {"error": "Endpoint not found."})

    def do_POST(self):
        if self.path != "/evaluate":
            self.reply(404, {"error": "Endpoint not found."})
            return
        if not TOKEN or not hmac.compare_digest(self.headers.get("X-Eval-Token", ""), TOKEN):
            self.reply(403, {"error": "Invalid evaluation token."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 512_000:
                raise ValueError
            job = json.loads(self.rfile.read(length))
            if job["framework"] not in ("deepeval", "ragas") or not isinstance(job["scenarios"], list):
                raise ValueError
            if not isinstance(job["runId"], str) or not isinstance(job["mock"], bool) or not isinstance(job["settings"], dict):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            self.reply(400, {"error": "Invalid evaluation request."})
            return
        POOL.submit(evaluate, job)
        self.reply(202, {"status": "queued"})


if __name__ == "__main__":
    port = int(os.getenv("EVAL_PORT", "5050"))
    print(f"Evaluation service listening on 127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
