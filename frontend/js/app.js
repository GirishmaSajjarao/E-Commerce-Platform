/* Shared helpers: API client, auth, layout shell. Everything the UI shows comes from backend responses. */
const NAV = [["dashboard","Dashboard","dashboard.html"],["chatbot","Support Chatbot","chatbot.html"],["evaluation","LLM Evaluation","evaluation.html"],
  ["testcases","Test Cases","testcases.html"],["security","AI Security","security.html"],["api","API Testing","api-testing.html"],
  ["history","Execution History","history.html"],["reports","Quality Reports","reports.html"],["settings","Settings","settings.html"]];
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const token = () => localStorage.getItem("token");
const me = () => JSON.parse(localStorage.getItem("user") || "null");

async function api(path, opts = {}) {
  const headers = {"Content-Type": "application/json", ...(token() ? {Authorization: "Bearer " + token()} : {})};
  let res;
  try { res = await fetch("/api" + path, {...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined}); }
  catch (e) { throw new Error("Cannot reach the backend. Is the server running? (" + e.message + ")"); }
  if (res.status === 401 && !path.startsWith("/auth/login")) { logout(); throw new Error("Session expired. Please log in again."); }
  if (res.status === 204) return null;
  let data = null; try { data = await res.json(); } catch (_) {}
  if (!res.ok) {
    const d = data && data.detail;
    const msg = typeof d === "string" ? d : d && d.message ? d.message : Array.isArray(d) ? d.map(x => x.msg).join("; ") : "Request failed (" + res.status + ")";
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}
function logout() { localStorage.removeItem("token"); localStorage.removeItem("user"); location.href = "index.html"; }
function showError(msg) { const b = $("#error-banner"); if (b) { b.textContent = msg; b.style.display = "block"; b.scrollIntoView({block:"nearest"}); } else alert(msg); }
function clearError() { const b = $("#error-banner"); if (b) b.style.display = "none"; }
const badge = s => `<span class="badge b-${esc(s)}">${esc(String(s).replace(/_/g, " "))}</span>`;
const mockTag = m => m ? `<span class="badge b-mock" title="Produced by the mock provider, not a real LLM">MOCK</span>` : "";
const when = iso => iso ? new Date(iso + "Z").toLocaleString() : "";

async function shell(active, title) {
  if (!token()) { location.href = "index.html"; return false; }
  const u = me();
  const isAdmin = u && u.role === "admin";
  const nav = NAV.filter(n => isAdmin || n[0] === "chatbot").map(n => `<a href="${n[2]}" class="${n[0] === active ? "active" : ""}" data-nav="${n[0]}">${n[1]}</a>`).join("");
  document.body.innerHTML = `<div id="app"><aside class="side"><div class="brand"><i>Q</i><div>AI Support QA<small>Quality platform</small></div></div>${nav}
    ${isAdmin ? '<a href="/docs" target="_blank">API Docs (Swagger)</a>' : ""}<div class="grow"></div>
    <div class="user">${esc(u.name)}<br>${esc(u.role)}${u.customer_id ? " · " + esc(u.customer_id) : ""}</div><a href="#" id="logout">Log out</a></aside>
    <main class="main"><div class="top"><h1 id="page-title">${esc(title)}</h1></div><div id="mock-banner"></div><div id="error-banner" class="banner err" style="display:none"></div><div id="content"></div></main></div>`;
  $("#logout").onclick = e => { e.preventDefault(); logout(); };
  fetch("/api/health").then(r => r.json()).then(h => {
    if (h.mock_mode) $("#mock-banner").innerHTML = `<div class="banner mock" data-testid="mock-banner"><b>MOCK_MODE is ON.</b> Chat answers are rule-based mock responses and LLM evaluations (DeepEval/Ragas) are disabled. See Settings to connect a real LLM.</div>`;
  }).catch(() => {});
  return true;
}
async function poll(runId, onTick, every = 2500) {
  for (let i = 0; i < 600; i++) {
    const run = await api("/runs/" + runId); onTick(run);
    if (!["queued", "running"].includes(run.status)) return run;
    await new Promise(r => setTimeout(r, every));
  }
}
async function openReport(name) {
  const res = await fetch("/api/reports/" + encodeURIComponent(name), {headers: {Authorization: "Bearer " + token()}});
  if (!res.ok) return showError("Could not open report " + name);
  window.open(URL.createObjectURL(await res.blob()), "_blank");
}
