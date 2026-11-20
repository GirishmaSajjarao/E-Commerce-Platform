from playwright.sync_api import expect
from automation.pages.base_page import BasePage


class LoginPage(BasePage):
    path = "/index.html"

    def login(self, email: str, password: str):
        self.page.fill("#email", email)
        self.page.fill("#password", password)
        self.page.click("#login-btn")
        return self

    def error_text(self) -> str:
        err = self.page.locator("[data-testid=login-error]")
        expect(err).to_be_visible(timeout=self.TIMEOUT)
        return err.inner_text()
