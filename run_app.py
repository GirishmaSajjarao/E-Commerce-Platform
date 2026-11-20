"""Start the app:  python run_app.py   ->  http://127.0.0.1:8000"""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
os.chdir(ROOT / "backend")
sys.path.insert(0, str(ROOT / "backend"))
import uvicorn
if __name__ == "__main__":
    uvicorn.run("app.main:app", host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), reload=False)
