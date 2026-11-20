from playwright.sync_api import expect
from automation.pages.base_page import BasePage


class ChatbotPage(BasePage):
    path = "/chatbot.html"

    def wait_ready(self):
        expect(self.page.locator("#chat-input")).to_be_visible(timeout=self.TIMEOUT)
        return self

    def send(self, text: str):
        before = self.page.locator(".msg.assistant").count()
        self.page.fill("#chat-input", text)
        self.page.click("#send-btn")
        expect(self.page.locator(".msg.assistant")).to_have_count(before + 1, timeout=self.TIMEOUT)
        expect(self.page.locator(".msg.assistant").last).not_to_have_text("…", timeout=self.TIMEOUT)
        return self

    def last_reply(self) -> str:
        return self.page.locator(".msg.assistant").last.inner_text()

    def message_count(self) -> int:
        return self.page.locator(".msg").count()

    def new_conversation(self):
        self.page.click("#new-conv")
        expect(self.page.locator(".msg")).to_have_count(0, timeout=self.TIMEOUT)
        return self

    def conversations(self):
        return self.page.locator("#conv-list button")
