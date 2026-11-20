#!/usr/bin/env bash
# One-time setup for Mac/Linux:  bash setup.sh
set -e
cd "$(dirname "$0")"
PY=$(command -v python3.12 || command -v python3.11 || command -v python3.13 || true)
[ -z "$PY" ] && { echo "[ERROR] Install Python 3.12 first (python.org or your package manager)."; exit 1; }
echo "Using $PY"; rm -rf .venv; "$PY" -m venv .venv; . .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install deepeval==4.3.2
pip install --no-deps ragas==0.4.3
pip install -r requirements-eval.txt
python -m playwright install chromium
[ -f .env ] || cp .env.example .env
echo; echo "Setup finished. NEXT: edit .env (paste your NEW key), then: source .venv/bin/activate && python check_setup.py && bash start.sh"
