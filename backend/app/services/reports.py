import html, json
from datetime import datetime
from pathlib import Path
from sqlalchemy.orm import Session
from app.config import settings
from app.models import EvalResult, ExecutionRecord, SecurityResult, TestRun
from app.services import dashboard


def reports_dir() -> Path:
    p = Path(settings.reports_dir); p.mkdir(parents=True, exist_ok=True); return p


def generate(db: Session, fmt: str = "html") -> dict:
    data = dashboard.summary(db)
    fails = [{"category": r.category, "name": r.name, "error": (r.error or "")[:300]}
             for r in db.query(ExecutionRecord).filter(ExecutionRecord.status.in_(["failed", "error"])).order_by(ExecutionRecord.id.desc()).limit(25)]
    sec_fail = [{"case": r.case_key, "category": r.category, "findings": r.findings, "mock": r.is_mock}
                for r in db.query(SecurityResult).filter(SecurityResult.passed.is_(False)).order_by(SecurityResult.id.desc()).limit(25)]
    runs = [{"id": r.id, "kind": r.kind, "status": r.status, "started_at": r.started_at.isoformat(), "message": (r.message or "")[:200]}
            for r in db.query(TestRun).order_by(TestRun.id.desc()).limit(15)]
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    payload = {"generated_at": datetime.now().isoformat(timespec="seconds"), "summary": data, "software_failures": fails,
               "security_failures": sec_fail, "recent_runs": runs}
    path = reports_dir() / f"quality_report_{stamp}.{fmt}"
    if fmt == "json":
        path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    else:
        path.write_text(_html(payload), encoding="utf-8")
    return {"name": path.name, "path": str(path), "format": fmt}


def _tbl(rows, cols):
    head = "".join(f"<th>{html.escape(c)}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(str(r.get(c, '')))}</td>" for c in cols) + "</tr>" for r in rows)
    return f"<table><tr>{head}</tr>{body}</table>" if rows else "<p>None recorded.</p>"


def _html(p: dict) -> str:
    s = p["summary"]; sw, sec, ev, api = s["software_tests"], s["security"], s["llm_evaluation"], s["api"]
    fw_rows = [{"framework": k, "metric results": v["results"], "errors": v["errors"], "avg score (0-1)": v["average_score"],
                "metric pass rate %": v["metric_pass_rate"], "mock rows": v["mock_rows"]} for k, v in ev["frameworks"].items()]
    mock = "<p class='warn'>Some results were produced with MOCK responses and are not genuine LLM evaluations.</p>" if s["has_mock_data"] else ""
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Quality Report</title><style>
body{{font:14px system-ui;margin:2rem auto;max-width:960px;color:#1b2430}}h1{{margin-bottom:0}}table{{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}}
td,th{{border:1px solid #d5dbe3;padding:6px 8px;text-align:left;vertical-align:top}}th{{background:#eef2f7}}.warn{{background:#fff3cd;padding:8px;border-radius:4px}}</style></head><body>
<h1>AI Quality Report</h1><p>Generated {p['generated_at']}</p>{mock}
<h2>1. Software test pass rate (pytest / Playwright)</h2>
<p>Total {sw['total']} &middot; passed {sw['passed']} &middot; failed {sw['failed']} &middot; skipped {sw['skipped']} &middot; <b>pass rate {sw['pass_percentage']}%</b></p>
<h2>2. AI security tests</h2><p>Total {sec['total']} &middot; passed {sec['passed']} &middot; failed {sec['failed']} &middot; pass rate {sec['pass_percentage']}% &middot; mock results {sec['mock_results']}</p>
<h2>3. LLM evaluation scores (model quality, not pass rates)</h2><p>Overall genuine score: {ev['overall_score_genuine']} &middot; hallucinations detected: {ev['hallucinations_detected']} of {ev['hallucination_checks']} checks</p>{_tbl(fw_rows, ['framework','metric results','errors','avg score (0-1)','metric pass rate %','mock rows'])}
<h2>4. API</h2><p>Calls {api['calls']} &middot; avg latency {api['avg_latency_ms']} ms &middot; p95 {api['p95_latency_ms']} ms &middot; API test success rate {api['success_rate']}%</p>
<h2>Failed software tests</h2>{_tbl(p['software_failures'], ['category','name','error'])}
<h2>Failed security cases</h2>{_tbl(p['security_failures'], ['case','category','findings','mock'])}
<h2>Recent runs</h2>{_tbl(p['recent_runs'], ['id','kind','status','started_at','message'])}</body></html>"""
