from playwright.sync_api import expect
from automation.pages.base_page import BasePage


class DashboardPage(BasePage):
    path = "/dashboard.html"

    def wait_loaded(self):
        expect(self.page.locator("[data-testid^=kpi-]").first).to_be_visible(timeout=self.TIMEOUT)
        return self

    def kpi_titles(self) -> list[str]:
        return [t.lower() for t in self.page.locator("[data-testid^=kpi-] h3").all_inner_texts()]

    def kpi_value(self, testid: str) -> str:
        return self.page.locator(f"[data-testid={testid}] .v").inner_text()

    def chart_count(self) -> int:
        return self.page.locator("canvas").count()

    def apply_filter(self, category: str):
        self.page.select_option("#f-cat", category)
        self.page.click("#apply")
