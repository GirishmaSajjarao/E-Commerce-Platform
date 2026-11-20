from playwright.sync_api import expect
from automation.pages.base_page import BasePage


class EvaluationPage(BasePage):
    path = "/evaluation.html"

    def run(self, framework: str):
        self.page.click(f"[data-fw={framework}]")
        return self

    def wait_for_run_row(self, framework: str, status: str):
        row = self.page.locator("#runs tr", has_text=framework).filter(has_text=status).first
        expect(row).to_be_visible(timeout=30_000)
        return row


class SecurityPage(BasePage):
    path = "/security.html"

    def run(self):
        self.page.click("#run")
        return self

    def wait_for_results(self, minimum: int = 20):
        expect(self.page.locator("#tbl tr").nth(minimum)).to_be_visible(timeout=60_000)
        return self.page.locator("#tbl tr").count() - 1
