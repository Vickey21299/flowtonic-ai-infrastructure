"""Gemini REST client for the AI investigation. One call per investigation, structured JSON output.

Only the evidence list built in service.py is sent (fictional demo data); the API key stays on the server.
"""

import json
import time

import httpx

PROMPT_VERSION = "investigation-v2"
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class AiError(Exception):
    def __init__(self, category: str, message: str):
        super().__init__(message)
        self.category, self.message = category, message


SYSTEM = """You assist a private equity analyst investigating why a portfolio company missed its plan.

Rules you must follow:
- Use ONLY the evidence items provided. Do not invent numbers, events, customers, prices or costs.
- Never use causal language about the variance anywhere, including the executive summary: no "driven by",
  "due to", "caused by", "because of", "resulting from". Say what the data shows and what is not yet known.
- confirmed_observations: facts stated directly by the evidence. Each cites the evidence ids it relies on.
- potential_explanations: hypotheses only. Phrase them as "could contribute" and say what data is missing.
  Never state that churn, pricing, labour, supply chain or any other factor caused the variance.
  supporting_evidence_ids may only contain ids from the evidence list. Financial totals alone show the size
  of a variance, not its cause, so evidence_strength is "none" or at most "weak" unless the evidence
  directly distinguishes the explanation.
- overall_assessment.cause_determination is "undetermined" unless the evidence directly establishes a cause.
- missing_evidence lists the data needed to test the explanations (for example sales volume, pricing,
  operating expenses, customer data); "explanations" holds the ids of the explanations it would test.
- Use explanation ids "exp-1", "exp-2", ... and reference them from missing_evidence, management_questions
  and suggested_actions.
- suggested_actions are proposals for human review, not decisions.
- data_limitations states what the data cannot show.
- Plain English, concise, no markdown. 3 to 5 potential explanations."""

_S = {"type": "STRING"}
_LIST_S = {"type": "ARRAY", "items": _S}
_STRENGTH = {"type": "STRING", "enum": ["none", "weak", "moderate", "strong"]}


def _obj(props: dict) -> dict:
    return {"type": "OBJECT", "properties": props, "required": list(props)}


SCHEMA = _obj({
    "executive_summary": _S,
    "confirmed_observations": {"type": "ARRAY", "items": _obj({"statement": _S, "evidence_ids": _LIST_S})},
    "potential_explanations": {"type": "ARRAY", "items": _obj({
        "id": _S, "statement": _S, "supporting_evidence_ids": _LIST_S, "missing_evidence": _LIST_S,
        "evidence_strength": _STRENGTH})},
    "missing_evidence": {"type": "ARRAY", "items": _obj({"type": _S, "why_needed": _S, "explanations": _LIST_S})},
    "management_questions": {"type": "ARRAY", "items": _obj({"question": _S, "explanations": _LIST_S})},
    "next_steps": {"type": "ARRAY", "items": _obj({
        "step": _S, "type": {"type": "STRING", "enum": ["data_request", "analysis", "meeting"]}})},
    "suggested_actions": {"type": "ARRAY", "items": _obj({"title": _S, "rationale": _S, "explanations": _LIST_S})},
    "overall_assessment": _obj({
        "cause_determination": {"type": "STRING", "enum": ["undetermined", "partially_supported", "supported"]},
        "evidence_strength": _STRENGTH, "rationale": _S}),
    "data_limitations": _LIST_S,
})


def generate(api_key: str, model: str, timeout: float, context: dict) -> tuple[dict, dict]:
    """Returns (raw output dict, usage). Raises AiError with a category the UI shows."""
    config: dict = {"temperature": 0.2, "responseMimeType": "application/json", "responseSchema": SCHEMA,
                    "maxOutputTokens": 8192}
    if "flash" in model:
        config["thinkingConfig"] = {"thinkingBudget": 0}  # cheaper and faster; the task is structured
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM}]},
        "contents": [{"role": "user", "parts": [{"text": "Investigate this exception.\n" + json.dumps(context)}]}],
        "generationConfig": config,
    }
    started = time.perf_counter()
    try:
        res = httpx.post(URL.format(model=model), json=body, timeout=timeout,
                         headers={"x-goog-api-key": api_key})
    except httpx.TimeoutException as e:
        raise AiError("timeout", f"The AI provider did not respond within {timeout:.0f} s.") from e
    except httpx.HTTPError as e:
        raise AiError("provider_unavailable", "The AI provider could not be reached.") from e
    ms = (time.perf_counter() - started) * 1000

    if res.status_code != 200:
        try:
            detail = res.json().get("error", {}).get("message", "")
        except ValueError:
            detail = ""
        category = "rate_limited" if res.status_code == 429 else "provider_error"
        raise AiError(category, f"AI provider returned HTTP {res.status_code}. {detail}".strip()[:500])

    data = res.json()
    cand = (data.get("candidates") or [{}])[0]
    text = "".join(p.get("text", "") for p in cand.get("content", {}).get("parts", []))
    usage = data.get("usageMetadata", {})
    meta = {"ms": ms, "finish": cand.get("finishReason", "?"), "in": usage.get("promptTokenCount", 0),
            "out": usage.get("candidatesTokenCount", 0)}
    if not text:
        raise AiError("invalid_response", f"The AI provider returned no content (finish reason {meta['finish']}).")
    try:
        return json.loads(text), meta
    except json.JSONDecodeError as e:
        raise AiError("invalid_response", f"The AI response was not valid JSON (finish reason {meta['finish']}).") from e
