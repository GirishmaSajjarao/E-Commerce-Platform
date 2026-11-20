import pytest

CASES = [("Is the Smart Fitness Watch in stock?", "out of stock"), ("How much are the Wireless Noise-Cancelling Headphones?", "$129.99"),
         ("Track order ORD-1002", "BD778812"), ("Where is my order ORD-1003?", "Processing"), ("How long do refunds take?", "5-7 business days"),
         ("Which payment methods do you accept?", "UPI")]


def ask(client, h, text, cid=None):
    cid = cid or client.post("/api/conversations", json={}, headers=h).json()["id"]
    r = client.post(f"/api/conversations/{cid}/messages", json={"content": text}, headers=h); assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("question,expected", CASES)
def test_grounded_answers(client, alice, question, expected):
    assert expected in ask(client, alice, question)["content"]


def test_unknown_information_is_stated_clearly(client, alice):
    assert "don't have that information" in ask(client, alice, "What is the weather in Paris?")["content"]


def test_unknown_order_not_invented(client, alice):
    assert "No order with ID ORD-9999" in ask(client, alice, "Status of ORD-9999?")["content"]


def test_retrieved_context_is_exposed_for_evaluation(client, alice):
    ctx = ask(client, alice, "Is the Smart Fitness Watch in stock?")["retrieved_context"]; assert ctx and ctx[0]["type"] == "product"


def test_multiple_conversations_are_independent(client, alice):
    a = client.post("/api/conversations", json={}, headers=alice).json()["id"]; b = client.post("/api/conversations", json={}, headers=alice).json()["id"]
    ask(client, alice, "Track order ORD-1002", a); ask(client, alice, "hello", b)
    assert len(client.get(f"/api/conversations/{a}/messages", headers=alice).json()) == 2
    assert len(client.get(f"/api/conversations/{b}/messages", headers=alice).json()) == 2
