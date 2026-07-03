"""Optional LLM-driven borrower profiling (extra feature).

In AI Borrower mode the model calls ``profile_borrowers`` **once, at reset**. A single small
LLM request rates the handful of borrower *personas* (there are only ~10 archetypes) for how
reliably each would keep paying -- returning a *reliability index* (0..1) plus a one-line
rationale per persona. Each borrower then inherits its persona's score, nudged slightly by its
own credit score. The month-by-month simulation runs entirely offline using that index, so the
AI shapes who pays without an API call on every step -- and the call cost is constant no matter
how many borrowers there are.

Design notes:
* Uses the OpenAI SDK + ``python-dotenv``, matching the course's ``.env.example``
  (``OPENAI_API_KEY``). Both packages are already in ``requirements.txt``.
* **Graceful fallback**: with no key, or on any error (network, timeout, bad JSON), borrowers
  keep ``reliability = None`` and the model falls back to the persona's built-in ``risk_mult``.
  The app never hard-fails because of the LLM.
* One request total per reset, capped and time-limited.
"""

from __future__ import annotations

import json
import os

import personas

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional
    pass

MODEL = "gpt-4o-mini"
REQUEST_TIMEOUT = 30  # seconds


def has_key() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def availability() -> dict:
    """Status object the frontend uses to describe the AI tab."""
    return {
        "available": has_key(),
        "model": MODEL,
        "message": (
            "AI reliability profiling ready."
            if has_key()
            else "AI mode unavailable - add OPENAI_API_KEY to .env to enable it."
        ),
    }


def _build_prompt() -> str:
    lines = [
        "You are a credit analyst. For each borrower persona below, judge how reliably that "
        "type of borrower keeps up monthly loan payments.",
        "Return a reliability score from 0.0 (very likely to miss and default) to 1.0 (very "
        "likely to pay every month), plus a short reason.",
        "",
        "Personas:",
    ]
    for a in personas.ARCHETYPES:
        lines.append(f'- "{a["title"]}": {a["blurb"]}')
    lines += [
        "",
        "Respond with ONLY a JSON array, one object per persona:",
        '[{"title": "<persona title>", "reliability": <0.0-1.0>, "reason": "<max 8 words>"}]',
    ]
    return "\n".join(lines)


def profile_borrowers(borrowers) -> None:
    """Rate the personas via one small LLM call, then set each borrower's ``reliability`` and
    ``ai_reason`` from its persona (nudged slightly by its own credit score).

    Mutates the borrowers in place. On any failure the borrowers are left untouched
    (``reliability = None``) so the model falls back to the persona's ``risk_mult``.
    """
    if not has_key() or not borrowers:
        return

    try:
        from openai import OpenAI

        client = OpenAI(timeout=REQUEST_TIMEOUT)
        resp = client.chat.completions.create(
            model=MODEL,
            temperature=0.7,
            messages=[
                {"role": "system", "content": "You output only valid JSON."},
                {"role": "user", "content": _build_prompt()},
            ],
        )
        rows = json.loads(_strip_code_fence(resp.choices[0].message.content.strip()))
    except Exception as exc:  # network / parse / auth -> fall back silently
        print(f"[ai_borrower] profiling failed, falling back to personas: {exc}")
        return

    # title -> (reliability, reason)
    rated: dict[str, tuple[float, str]] = {}
    for row in rows:
        try:
            title = str(row["title"])
            rel = min(max(float(row["reliability"]), 0.0), 1.0)
        except (KeyError, TypeError, ValueError):
            continue
        rated[title] = (rel, str(row.get("reason", ""))[:60])

    for b in borrowers:
        if not b.persona:
            continue
        entry = rated.get(b.persona["title"])
        if entry is None:
            continue
        rel, reason = entry
        # Small credit-score nudge (+-~0.1 across the 50-100 range) for per-borrower variety.
        nudge = (b.credit_score - 75.0) / 250.0
        b.reliability = min(max(rel + nudge, 0.0), 1.0)
        b.ai_reason = reason


def _strip_code_fence(text: str) -> str:
    """Tolerate models that wrap JSON in ```json ... ``` fences."""
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
    return text.strip()
