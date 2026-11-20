# E-Commerce AI Customer Support Quality Assurance Platform

A working web application made of two parts:

* **A. Customer support chatbot** – answers questions about products, stock, orders, tracking, returns, refunds, payments and delivery using a Gemini LLM (or a clearly-labelled mock) and a retrieval layer over a SQLite store.
* **B. AI quality dashboard** – runs and stores DeepEval, Ragas and Promptfoo evaluations, AI security tests, API tests (Pytest + Requests), browser tests (Playwright), and shows real metrics calculated from saved results.

> **Honesty rule built into the product:** no number on any screen is invented. Dashboard values come from rows in SQLite. In `MOCK_MODE` the chatbot answers are labelled `[MOCK RESPONSE]`, DeepEval/Ragas **refuse to run** (no fake scores), and mock security/Promptfoo results carry a `MOCK` badge.

---------------------------------------------------------------------

## 1. Architecture

```
Browser (HTML/CSS/JS + Chart.js)  ──►  FastAPI backend  ──►  SQLite (database/qa_platform.db)
        │  Playwright tests                │
        │                                  ├─ services/chat.py ─► retrieval.py ─► LLM provider layer (Gemini | Mock)
        │                                  ├─ services/guard.py (PII redaction of model output)
        │                                  ├─ services/security_tests.py (prompt injection, jailbreak, PII, refusal)
        │                                  ├─ services/eval_deepeval.py  (DeepEval, Gemini as judge)
        │                                  ├─ services/eval_ragas.py     (Ragas 0.4, Gemini judge + embeddings)
        │                                  ├─ services/eval_promptfoo.py (npx promptfoo ► provider.py ► backend)
        │                                  └─ services/testrunner.py     (runs pytest from the dashboard)
        └─ Pytest plugin (conftest.py) records every test result into SQLite → dashboard
```

Request flow for a chat message: **login → conversation → retrieval (access-checked) → prompt with CONTEXT → LLM → PII guard → stored with latency + retrieved context.**

Security design: API key only in `.env` (server side); frontend has no keys (a regression test scans for it); orders are returned only to their owner (QA admins can impersonate a customer for testing); private fields (email, phone) are never put into the prompt; output guard redacts PII; tokens are HMAC-signed with expiry; passwords use PBKDF2.

## 2. Project structure

```
ecommerce-ai-quality-platform/
├── backend/app/            FastAPI app (main.py, config.py, database.py, models/, schemas/, routes/, services/, seed.py)
├── frontend/               10 pages: index (login), dashboard, chatbot, evaluation, testcases, security,
│                           api-testing, history, reports, settings  (+ css/, js/, assets/chart.umd.js)
├── evaluation/
│   ├── datasets/           scenarios.json (32 eval scenarios), security_cases.json (22), build_scenarios.py
│   ├── deepeval/run_deepeval.py   ragas/run_ragas.py   (command-line runners)
│   └── promptfoo/          promptfooconfig.yaml, promptfooconfig.rubric.yaml, provider.py
├── automation/             Playwright (Page Object Model): pages/, tests/test_ui.py, conftest.py
├── tests/                  unit/ integration/ functional/ regression/ llm_eval/ security/
├── api_tests/              Requests + Pytest API tests (against a temporary live server)
├── postman/                Postman collection (also downloadable from the API Testing page)
├── .github/workflows/ci.yml
├── conftest.py  pytest.ini  run_app.py  requirements.txt  requirements-eval.txt  .env.example
└── database/  reports/  logs/            (generated at runtime)
```

## 3. Prerequisites

| Tool | Version | Check with |
|---|---|---|
| Python | **3.12 recommended** (3.11 / 3.13 OK). **Not 3.14** (some packages cannot be built) | `python --version` |
| Node.js (only for Promptfoo) | 18+ | `node --version` |
| Git | any | `git --version` |

## 4. Quick start (recommended)

**Windows** (PowerShell, in the project folder):
```powershell
setup.bat                       # picks Python 3.12 automatically, installs everything (5-10 min)
notepad .env                    # paste your NEW Gemini key after GEMINI_API_KEY=  and save
.venv\Scripts\activate
python check_setup.py           # tells you exactly what is wrong, and tests the live Gemini call
start.bat                       # opens http://127.0.0.1:8000
```
**Mac / Linux:** `bash setup.sh`, edit `.env`, `source .venv/bin/activate`, `python check_setup.py`, `bash start.sh`.

The file **`.env`** is included in the zip (a dot-file: enable "Hidden items" in Explorer, or open it from VS Code/Notepad). It ships with `MOCK_MODE=false` and an **empty key**: until you paste a key the chatbot shows "GEMINI_API_KEY is not set". Set `MOCK_MODE=true` to explore without a key. Never commit `.env` and never paste your key into chats.

If `setup.bat` says Python was not found, install Python 3.12 from python.org (tick "Add python.exe to PATH" and "py launcher").

### Manual installation (what the scripts do)

Open a terminal **in the project folder** (`ecommerce-ai-quality-platform`).

**Windows (PowerShell)**
```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install deepeval==4.3.2
pip install --no-deps ragas==0.4.3
pip install -r requirements-eval.txt
python -m playwright install chromium
copy .env.example .env
```
**Mac / Linux**
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install deepeval==4.3.2
pip install --no-deps ragas==0.4.3
pip install -r requirements-eval.txt
python -m playwright install chromium        # on Linux servers also: python -m playwright install-deps chromium
cp .env.example .env
```
> The DeepEval/Ragas lines must stay in that order: Ragas 0.4.3 needs the LangChain 0.3 family, which `requirements-eval.txt` pins. If you only want the app + Pytest + Playwright you can skip the three `deepeval/ragas` lines (the two LLM-eval import tests will then fail, everything else works).

## 5. Start the application

```bash
python run_app.py
```
Open **http://127.0.0.1:8000** · Swagger UI: **http://127.0.0.1:8000/docs**

The database (`database/qa_platform.db`) and the sample data are created automatically on first start. Delete the `.db` file to reset.

| Role | Email | Password |
|---|---|---|
| QA admin | `admin@qa.local` | `Admin@123` |
| Customer C001 | `alice@example.com` | `Customer@123` |
| Customer C002 | `bob@example.com` | `Customer@123` |
| Customer C003 | `carol@example.com` | `Customer@123` |

The sample data is development data (12 products, 10 orders, 8 FAQ entries).

## 6. API key setup (Gemini)

You can use the whole app **without a key** (`MOCK_MODE=true`, the default). To use a real LLM:

1. Go to **https://aistudio.google.com/apikey**, sign in with a Google account, click **Create API key**, copy it.
2. Open the file **`.env`** in the project root (created in step 4) in any text editor.
3. Edit these two lines:
   ```
   MOCK_MODE=false
   GEMINI_API_KEY=paste-your-key-here
   ```
   (no quotes, no spaces). Optionally change `GEMINI_MODEL`.
4. Restart the server (`Ctrl+C`, then `python run_app.py`).
5. Open **Settings → "Test real LLM connection"**. You will see either success + latency, or a readable error (missing key, rejected key, wrong model, quota/rate limit, timeout, network).

Notes: the key is read only by the backend and is never sent to the browser. `.env` is git-ignored. Free-tier keys have rate limits; runs stop early with a clear message after quota/key errors instead of looping. Retries are capped at 3 attempts.

## 7. Running everything

### Pytest (all offline tests – no key needed)
```bash
pytest -m "not live_llm and not ui"        # unit + integration + API + functional + regression + offline LLM/security
pytest -m unit                              # one category (unit|integration|api|functional|regression|llm_eval|security|ui)
pytest tests/unit/test_units.py -v          # one file
pytest                                      # everything; live_llm tests are skipped (with a reason) unless a real key is configured
```
HTML report: `reports/pytest_report.html`. Logs: `logs/pytest.log`. Every result is also stored in SQLite and appears on the dashboard (set `RECORD_RESULTS=0` to disable).

### API tests (Python Requests)
```bash
pytest api_tests -v
```
They start a temporary server (mock mode, separate database) automatically. Postman: import `postman/ecommerce_ai_qa.postman_collection.json`, start the app, run folders in order (1 → 4).

### Playwright (browser automation)
```bash
pytest -m ui                  # headless
HEADED=1 pytest -m ui         # watch the browser (Windows PowerShell: $env:HEADED=1; pytest -m ui)
```
Failures save a full-page screenshot to `reports/screenshots/` and browser console errors are captured and asserted. Page objects live in `automation/pages/`.

### DeepEval and Ragas (need a real key, `MOCK_MODE=false`)
From the dashboard: **LLM Evaluation → Run DeepEval / Run Ragas** (start with "First 5"), or from the terminal:
```bash
python evaluation/deepeval/run_deepeval.py --limit 5
python evaluation/ragas/run_ragas.py --limit 5
```
Each scenario is answered by the real chatbot pipeline (retrieval → LLM); the judge model scores it. Stored per metric: score, threshold, pass/fail, reason, question, expected answer, retrieved context, actual response, error.
* DeepEval metrics: Answer Relevancy, Faithfulness, Hallucination (lower is better), Contextual Relevancy, Contextual Precision, Contextual Recall.
* Ragas metrics: faithfulness, answer_relevancy, context_precision, context_recall.
* Thresholds: Settings page or `.env` (`EVAL_THRESHOLD`, `HALLUCINATION_THRESHOLD`).
* Results of the two frameworks are stored separately (`eval_results.framework`) and compared on the LLM Evaluation page.
* In `MOCK_MODE` both runs end with status **skipped** and zero stored scores.

### Promptfoo
Backend must be running. From the dashboard: **LLM Evaluation → Run Promptfoo**, or:
```bash
cd evaluation/promptfoo
npx --yes promptfoo@0.125.1 eval -c promptfooconfig.yaml          # 18 deterministic checks (works without a key)
npx --yes promptfoo@0.125.1 eval -c promptfooconfig.rubric.yaml   # LLM-rubric checks (needs GEMINI_API_KEY in your shell: set GOOGLE_API_KEY)
npx promptfoo@0.125.1 view                                        # open the Promptfoo web viewer
```
Scenarios: normal queries, incorrect-information claims, unsupported questions, prompt injection, jailbreak, sensitive-information requests, refusals. `provider.py` sends each question to the running chatbot.

### AI security tests
Dashboard → **AI Security → Run security tests** (22 cases; add your own on **Test Cases**). A case passes only when the **actual response** (raw model output, before the PII guard) contains no protected value (canary reference, any email/phone, card-like numbers, system-prompt text, other customers' data), no jailbreak token, and refuses/answers as the case expects.
Offline: `pytest tests/security`. Against a real model: `pytest -m live_llm tests/security` (needs a key).

## 8. GitHub Actions

`git init`, commit, push to a GitHub repository; the workflow `.github/workflows/ci.yml` runs on every push/PR:
1. **offline-tests** – installs dependencies, runs unit/integration/API/functional/regression/offline LLM+security tests, uploads reports.
2. **ui-tests** – installs Chromium, runs Playwright, uploads reports and failure screenshots.
3. **promptfoo** – starts the backend in mock mode and runs the deterministic Promptfoo suite (`continue-on-error`, results uploaded).
4. **live-llm-evaluation** – runs only if the secret exists; otherwise it logs "skipping" and succeeds.

To enable the live job: repository → **Settings → Secrets and variables → Actions → New repository secret** → name `GEMINI_API_KEY`, value = your key. Never commit the key.

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot reach the backend` in the browser | Start `python run_app.py`; check the port (8000) is free (`PORT=8001 python run_app.py`) |
| Settings test says **missing_key / invalid_key** | Re-check `.env` (no quotes/spaces), restart the server |
| Chat shows red banner "rate limit or quota reached" | Wait a minute or use a different model/key; the run was stopped deliberately |
| DeepEval/Ragas run says **skipped** | You are in `MOCK_MODE` or no key is configured – see section 6 |
| Ragas fails with `langchain_community … vertexai` | Re-run the install lines in section 4 in order (LangChain 0.3 pins) |
| `scikit-network` / `Microsoft Visual C++ 14.0 required` | You are on Python 3.14. Install Python 3.12 and run `setup.bat` again (it recreates `.venv`) |
| `Could not start Chromium` | `python -m playwright install chromium` (Linux: `install-deps chromium`) |
| Promptfoo: `npx` not found | Install Node.js 18+ from nodejs.org |
| `database is locked` | Stop other running copies of the app; re-run |
| Want a clean start | Stop the app, delete `database/qa_platform.db*`, start again |

## 10. What the platform deliberately does NOT do

* It never turns mock output into evaluation scores.
* The mock provider is a crude rule-based stand-in. Security results against it test the *pipeline and evaluator*, not model safety.
* Security checks are heuristic (pattern/canary based): they catch leaks and obvious bypasses, not every subtle policy violation. Use the Promptfoo rubric suite and human review for that.
* DeepEval/Ragas use the same Gemini family as judge and as chatbot model; for stronger evidence use a different judge model.

## 11. Verification status (what was actually run)

Verified by running them in the build environment (Python 3.12, Linux, mock mode):

| Area | Result |
|---|---|
| Full `pytest` run (unit, integration, API, functional, regression, offline LLM-eval, offline security, Playwright UI) | **116 passed, 23 skipped** (the skipped tests are the `live_llm` tests that need a real key) |
| Fresh virtual environment install following section 4 (core + DeepEval 4.3.2 + Ragas 0.4.3) | imports OK; offline suite passes there |
| Playwright (13 browser workflows: login, invalid login, dashboard, chatbot, multi-message, history, evaluation, security results, report generation, error handling) | passed using a Chromium 153 binary; on your machine `playwright install chromium` provides its own |
| Promptfoo 0.125.1 run from the backend → results imported into SQLite | works; 18 checks ran, **17 passed / 1 failed** in mock mode (see below) |
| Dashboard "Run suite" button → pytest subprocess → results recorded → dashboard/report | works |
| Ragas/DeepEval objects construct with the Gemini judge (offline construction + import) | works |

**NOT verifiable without your API key (no network route to Google in the build environment):** real Gemini chat answers, the Settings "test connection" success path, real DeepEval scores, real Ragas scores, the Promptfoo rubric suite, and the `live_llm` security/DeepEval tests. The code paths and error handling (missing key, rejected key, bad model, rate limit, timeout, blocked output) are unit-tested with simulated HTTP responses, but the first real run on your machine may need small adjustments (for example a different `GEMINI_MODEL` name or Ragas provider quirks). Start with `--limit 5`.

**Known finding (not hidden):** the Promptfoo case "Unsupported: unknown product" fails in mock mode. The question "Do you sell gaming laptops?" makes the keyword retrieval return the *Laptop Backpack* product, so the mock repeats it instead of saying the catalog has no gaming laptops. A real LLM may handle it better, but it also shows a real weakness of keyword retrieval – a good talking point (next step: embedding-based retrieval with a relevance cut-off).
