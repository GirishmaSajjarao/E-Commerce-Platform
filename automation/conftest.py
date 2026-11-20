"""Playwright fixtures: browser, per-test page with console-error capture. Failure screenshots are taken by the root conftest hook."""
import os
import pytest
from playwright.sync_api import sync_playwright, Error as PWError
from automation.pages.login_page import LoginPage


@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as p:
        opts = {"headless": os.environ.get("HEADED") != "1"}
        if os.environ.get("PW_CHROMIUM_PATH"):                       # advanced: use an existing Chromium binary
            opts["executable_path"] = os.environ["PW_CHROMIUM_PATH"]
            opts["args"] = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
        try:
            b = p.chromium.launch(**opts)
        except PWError as e:
            pytest.fail("Could not start Chromium. Run:  python -m playwright install chromium   "
                        "(on Linux also:  python -m playwright install-deps chromium)\n" + str(e)[:300])
        yield b
        b.close()


@pytest.fixture()
def page(browser, live_server):
    ctx = browser.new_context(viewport={"width": 1366, "height": 850})
    pg = ctx.new_page()
    pg.console_errors = []
    pg.on("console", lambda m: pg.console_errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: pg.console_errors.append(f"pageerror: {e}"))
    pg.set_default_timeout(10_000)
    yield pg
    ctx.close()


@pytest.fixture()
def base_url(live_server):
    return live_server


def _login(page, base_url, email, password):
    LoginPage(page, base_url).open().login(email, password)
    page.wait_for_url("**/*.html", timeout=10_000)
    page.wait_for_function("() => !location.pathname.endsWith('index.html')", timeout=10_000)


@pytest.fixture()
def admin_page(page, base_url):
    _login(page, base_url, "admin@qa.local", "Admin@123")
    return page


@pytest.fixture()
def customer_page(page, base_url):
    _login(page, base_url, "alice@example.com", "Customer@123")
    return page
