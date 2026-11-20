import logging
from logging.handlers import RotatingFileHandler
from app.config import ROOT


def setup_logging() -> None:
    (ROOT / "logs").mkdir(exist_ok=True)
    root = logging.getLogger()
    if root.handlers:
        return
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh = RotatingFileHandler(ROOT / "logs" / "app.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    sh = logging.StreamHandler()
    for h in (fh, sh):
        h.setFormatter(fmt)
        root.addHandler(h)
