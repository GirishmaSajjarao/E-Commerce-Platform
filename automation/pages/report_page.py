from playwright.sync_api import expect
from automation.pages.base_page import BasePage


class ReportPage(BasePage):
    path = "/reports.html"

    def generate(self, fmt: str = "html") -> str:
        self.page.click(f"#{fmt}")
        banner = self.page.locator(".banner.ok")
        expect(banner).to_be_visible(timeout=self.TIMEOUT)
        return banner.inner_text()

    def report_names(self) -> list[str]:
        return self.page.locator("#tbl td.mono").all_inner_texts()
