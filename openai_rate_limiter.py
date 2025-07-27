"""openai_rate_limiter.py
----------------------------------
Tiny async wrapper around the OpenAI Python SDK that automatically respects
organization-level rate limits (tokens-per-minute & requests-per-minute), so
you never hit a 429 again.

Usage::

    from openai_rate_limiter import RateLimiter
    import asyncio

    async def main():
        limiter = RateLimiter()  # tweak limits if your org differs
        resp = await limiter.chat_completion(
            model="o3",
            messages=[{"role": "user", "content": "Hello!"}],
            max_tokens=50,
        )
        print(resp.choices[0].message.content)

asyncio.run(main())

Principles: SRP, open for extension, < 200 lines, zero external infra.
"""
from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Deque, Dict

try:
    import tiktoken  # for token estimation
except ImportError as exc:  # pragma: no cover – optional dep
    raise ImportError(
        "tiktoken must be installed: `pip install tiktoken`"
    ) from exc

import openai

__all__ = ["RateLimiter"]

DEFAULT_TPM = 30_000  # tokens per minute (model o3 typical)
DEFAULT_RPM = 350     # requests per minute (model o3 typical)
HEADROOM = 0.9        # 10 % safety margin


class RateLimiter:  # pylint: disable=too-few-public-methods
    """Async rate-limiter for OpenAI chat completions.

    Parameters
    ----------
    api_key: str | None
        Your OpenAI key. If None we fall back to env var.
    max_tpm: int
        Tokens-per-minute hard limit from your org dashboard.
    max_rpm: int
        Requests-per-minute limit.
    headroom: float
        A fractional margin (<1) to stay below the hard limits.
    counting_model: str
        Model name used for prompt token estimation.
    """

    def __init__(
        self,
        api_key: str | None = None,
        max_tpm: int = DEFAULT_TPM,
        max_rpm: int = DEFAULT_RPM,
        headroom: float = HEADROOM,
        counting_model: str = "gpt-3.5-turbo",
    ) -> None:
        if not 0 < headroom <= 1:
            raise ValueError("headroom must be in (0, 1].")

        openai.api_key = api_key or openai.api_key
        self.max_tpm = int(max_tpm * headroom)
        self.max_rpm = int(max_rpm * headroom)

        self._timestamps: Deque[float] = deque()
        self._tokens: Deque[int] = deque()
        self._enc = tiktoken.encoding_for_model(counting_model)
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------
    async def chat_completion(self, /, **kwargs):  # type: ignore[override]
        """Proxy to `openai.ChatCompletion.acreate` while throttling."""
        async with self._lock:
            await self._wait_if_needed(kwargs)
            response = await openai.ChatCompletion.acreate(**kwargs)  # type: ignore[attr-defined]
            self._record(self._extract_total_tokens(response))
            return response

    # ------------------------------------------------------------------
    # Internal bits – nothing to see here 🐶
    # ------------------------------------------------------------------
    async def _wait_if_needed(self, kwargs: Dict) -> None:  # noqa: WPS231
        now = time.time()
        self._evict_old(now)
        est = self._estimate_tokens(kwargs)

        # throttle on RPM
        if len(self._timestamps) >= self.max_rpm:
            await self._sleep_until(now, self._timestamps[0])
            now = time.time()
            self._evict_old(now)

        # throttle on TPM
        while sum(self._tokens) + est > self.max_tpm:
            await self._sleep_until(now, self._timestamps[0])
            now = time.time()
            self._evict_old(now)

    def _estimate_tokens(self, kwargs: Dict) -> int:  # noqa: WPS111
        messages = kwargs.get("messages", [])
        prompt = sum(len(self._enc.encode(m.get("content", ""))) for m in messages)
        completion_hint = kwargs.get("max_tokens", 100)
        return prompt + completion_hint

    @staticmethod
    def _extract_total_tokens(resp: Dict) -> int:  # noqa: D401
        "Return token usage from response."
        usage = resp.get("usage", {})
        return usage.get("total_tokens", usage.get("prompt_tokens", 0) + usage.get("completion_tokens", 0))

    def _record(self, tokens: int) -> None:  # noqa: WPS110
        self._timestamps.append(time.time())
        self._tokens.append(tokens)

    def _evict_old(self, now: float) -> None:  # noqa: D401
        "Remove entries older than a minute."
        cutoff = now - 60
        while self._timestamps and self._timestamps[0] < cutoff:
            self._timestamps.popleft()
            self._tokens.popleft()

    async def _sleep_until(self, now: float, first: float) -> None:  # noqa: D401
        "Snooze just long enough for the window to slide."
        await asyncio.sleep(max(0, (first + 60) - now) + 0.05)


# ------------------------------------------------------------------
if __name__ == "__main__":
    async def _demo():  # pragma: no cover
        limiter = RateLimiter()
        resp = await limiter.chat_completion(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": "Say hi!"}],
            max_tokens=10,
        )
        print(resp.choices[0].message.content)

    asyncio.run(_demo())
