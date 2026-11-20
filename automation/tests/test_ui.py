"""End-to-end browser tests (Page Object Model). Console errors are asserted per test."""
import re
import pytest
from playwright.sync_api import expect
from automation.pages.login_page import LoginPage
from automation.pages.dashboard_page import DashboardPage
from automation.pages.chatbot_page import ChatbotPage
from automation.pages.evaluation_page import EvaluationPage, SecurityPage
from automation.pages.report_page import ReportPage


def no_console_errors(page):
    assert page.console_errors == [], f"Browser console errors: {page.console_errors}"


def test_01_login_success_admin(page, base_url):
    LoginPage(page, base_url).open().login("admin@qa.local", "Admin@123")
    expect(page).to_have_url(re.compile(r"/dashboard\.html$"))
    expect(page.locator("#page-title")).to_have_text("Dashboard")
    no_console_errors(page)


def test_02_invalid_login_shows_error_and_stays(page, base_url):
    lp = LoginPage(page, base_url).open().login("admin@qa.local", "wrong-password")
    assert "Invalid email or password" in lp.error_text()
    expect(page).to_have_url(re.compile(r"/index\.html$"))
    assert page.evaluate("localStorage.getItem('token')") is None


def test_03_unauthenticated_access_redirects_to_login(page, base_url):
    page.goto(base_url + "/dashboard.html")
    expect(page).to_have_url(re.compile(r"/index\.html$"))


def test_04_dashboard_loads_with_kpis_and_charts(admin_page, base_url):
    d = DashboardPage(admin_page, base_url).open().wait_loaded()
    titles = " ".join(d.kpi_titles())
    for k in ("total test cases", "passed tests", "failed tests", "llm evaluation score", "hallucinations detected", "api success rate", "avg api latency"):
        assert k in titles, f"missing KPI: {k}"
    expect(admin_page.locator("canvas")).to_have_count(3, timeout=10_000)
    expect(admin_page.locator("[data-testid=mock-banner]")).to_be_visible()
    no_console_errors(admin_page)


def test_05_dashboard_filter_applies(admin_page, base_url):
    d = DashboardPage(admin_page, base_url).open().wait_loaded()
    d.apply_filter("unit")
    d.wait_loaded()
    no_console_errors(admin_page)


def test_06_chatbot_answers_from_order_data(admin_page, base_url):
    c = ChatbotPage(admin_page, base_url).open().wait_ready()
    c.send("What is the status of ORD-1002?")
    reply = c.last_reply()
    assert "Shipped" in reply and "MOCK" in reply
    no_console_errors(admin_page)


def test_07_multiple_messages_in_one_conversation(admin_page, base_url):
    c = ChatbotPage(admin_page, base_url).open().wait_ready().new_conversation()
    for q in ("Is the Smart Fitness Watch in stock?", "How long do refunds take?", "Track order ORD-1002"):
        c.send(q)
    assert c.message_count() == 6
    assert "BD778812" in c.last_reply()


def test_08_conversation_history_survives_reload(admin_page, base_url):
    c = ChatbotPage(admin_page, base_url).open().wait_ready().new_conversation()
    c.send("Which payment methods do you accept?")
    admin_page.reload()
    c.wait_ready()
    expect(admin_page.locator(".msg")).to_have_count(2, timeout=10_000)
    assert c.conversations().count() >= 1
    assert "UPI" in c.last_reply()


def test_09_customer_sees_only_chatbot_navigation(customer_page, base_url):
    c = ChatbotPage(customer_page, base_url).open().wait_ready()
    assert c.nav_items() == ["Support Chatbot"]
    c.send("What is the status of ORD-1004?")                 # belongs to another customer
    assert "Office Chair" not in c.last_reply()


def test_10_evaluation_run_is_skipped_not_faked_in_mock_mode(admin_page, base_url):
    ev = EvaluationPage(admin_page, base_url).open()
    ev.run("deepeval")
    assert "real LLM" in ev.error_banner_text()
    ev.wait_for_run_row("deepeval", "skipped")
    expect(admin_page.locator("#results")).to_contain_text("No results yet")


def test_11_security_results_displayed(admin_page, base_url):
    s = SecurityPage(admin_page, base_url).open().run()
    assert s.wait_for_results(20) >= 20
    expect(admin_page.locator("#sum .kpi").first).to_be_visible()
    expect(admin_page.locator("#tbl .b-mock").first).to_be_visible()      # mock results are labelled


def test_12_report_generation(admin_page, base_url):
    r = ReportPage(admin_page, base_url).open()
    assert "Report created" in r.generate("html")
    expect(admin_page.locator("#tbl td.mono").first).to_contain_text("quality_report_")
    assert any(n.endswith(".html") for n in r.report_names())


def test_13_backend_error_is_shown_readably(admin_page, base_url):
    c = ChatbotPage(admin_page, base_url).open().wait_ready().new_conversation()
    admin_page.route("**/api/conversations/*/messages", lambda route: route.fulfill(
        status=502, content_type="application/json", body='{"detail":{"code":"invalid_key","message":"Gemini rejected the API key (403)."}}')
        if route.request.method == "POST" else route.continue_())
    admin_page.fill("#chat-input", "hello")
    admin_page.click("#send-btn")
    assert "Gemini rejected the API key" in c.error_banner_text()
    expect(admin_page.locator("#send-btn")).to_be_enabled()
