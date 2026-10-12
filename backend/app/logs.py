"""Console logging for the uvicorn terminal: one line per request in/out, plus import steps in between.

    10:42:03.120 INFO  [req_3f2a91] → POST /api/imports/JOB-0005/confirm
    10:42:03.140 INFO  [req_3f2a91]   confirm  1/8 job JOB-0005 loaded: status=validated, file=prices.csv
    ...
    10:42:04.010 INFO  [req_3f2a91] ← 200 POST /api/imports/JOB-0005/confirm (890 ms)
"""

import contextvars
import logging
import sys
import time
from contextlib import contextmanager

request_id: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get()
        return True


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter("%(asctime)s.%(msecs)03d %(levelname)-5s [%(request_id)s] %(message)s",
                                           datefmt="%H:%M:%S"))
    handler.addFilter(_RequestIdFilter())
    log = logging.getLogger("flownetic")
    log.handlers[:] = [handler]
    log.setLevel(logging.INFO)
    log.propagate = False


log = logging.getLogger("flownetic")


@contextmanager
def step(action: str, n: int, total: int, message: str):
    """Logs `message`, runs the block, then logs how long it took. Yields a dict for a result text."""
    log.info("  %-8s %d/%d %s …", action, n, total, message)
    started = time.perf_counter()
    result: dict = {}
    yield result
    ms = (time.perf_counter() - started) * 1000
    log.info("  %-8s %d/%d done in %.0f ms%s", action, n, total, ms, f" → {result['out']}" if result.get("out") else "")


def info(action: str, message: str, *args) -> None:
    log.info("  %-8s " + message, action, *args)
