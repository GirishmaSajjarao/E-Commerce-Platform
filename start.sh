#!/usr/bin/env bash
cd "$(dirname "$0")"; . .venv/bin/activate; echo "Starting on http://127.0.0.1:8000"; python run_app.py
