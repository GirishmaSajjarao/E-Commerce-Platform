from playwright.sync_api import Page, expect


class BasePage:
    path = "/"
    TIMEOUT = 10_000

    def __init__(self, page: Page, base_url: str):
        self.page, self.base_url = page, base_url.rstrip("/")

    def open(self):
        self.page.goto(self.base_url + self.path)
        return self

    def locator(self, sel: str):
        return self.page.locator(sel)

    def wait_visible(self, sel: str, timeout: int | None = None):
        expect(self.page.locator(sel).first).to_be_visible(timeout=timeout or self.TIMEOUT)

    def error_banner_text(self) -> str:
        banner = self.page.locator("#error-banner")
        expect(banner).to_be_visible(timeout=self.TIMEOUT)
        return banner.inner_text()

    def nav_items(self) -> list[str]:
        return [t.strip() for t in self.page.locator(".side a[data-nav]").all_inner_texts()]
