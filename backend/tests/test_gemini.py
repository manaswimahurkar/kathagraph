"""The Gemini client must survive a model that rejects a setting, and an overloaded model."""
import json

import pytest

from app import gemini


class FakeResponse:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, json.dumps(body)

    def json(self):
        return self._body


OK = FakeResponse(200, {"candidates": [{"content": {"parts": [{"text": '{"tag": "other", "description": "x"}'}]}}]})


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    monkeypatch.delenv("GEMINI_MODELS", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setattr(gemini.time, "sleep", lambda s: None)
    monkeypatch.setattr(gemini, "_thinking_off_supported", True)


def run(monkeypatch, respond):
    calls = []

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append((url.rsplit("/", 1)[-1].split(":")[0], "thinkingConfig" in json["generationConfig"]))
        return respond(url, json)

    monkeypatch.setattr(gemini.httpx, "post", fake_post)
    result = gemini.generate_json([{"text": "hi"}], {"type": "OBJECT"})
    return result, calls


def test_model_rejecting_thinking_setting_is_retried_without_it(monkeypatch):
    def respond(url, body):
        if "thinkingConfig" in body["generationConfig"]:
            return FakeResponse(400, {"error": {"message": "Request contains an invalid argument."}})
        return OK

    result, calls = run(monkeypatch, respond)
    assert result == {"tag": "other", "description": "x"}
    assert calls == [("gemini-flash-lite-latest", True), ("gemini-flash-lite-latest", False)]


def test_overloaded_model_falls_back_to_the_next(monkeypatch):
    def respond(url, body):
        if "gemini-flash-lite-latest" in url:
            return FakeResponse(503, {"error": {"message": "high demand"}})
        return OK

    result, calls = run(monkeypatch, respond)
    assert result["tag"] == "other"
    assert calls[-1][0] == "gemini-flash-latest"


def test_every_model_refusing_raises_a_clear_error(monkeypatch):
    with pytest.raises(gemini.GeminiError):
        run(monkeypatch, lambda url, body: FakeResponse(400, {"error": {"message": "invalid argument"}}))
