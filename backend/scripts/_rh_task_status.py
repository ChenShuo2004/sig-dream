"""Print RunningHub task status fields only. No keys, no result URLs."""

import json

from app.core.database import SessionLocal
from app.api.routes.canvas_api import _runninghub_api_key, _runninghub_json

TASK_ID = "2112768974663147521"


def summarize(value, depth=0):
    if depth > 4:
        return type(value).__name__
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if any(token in lowered for token in ("url", "key", "token", "secret", "authorization")):
                out[key] = "<redacted>"
                continue
            if key in {"results", "data"} and isinstance(item, list):
                out[key] = f"list:{len(item)}"
                continue
            out[key] = summarize(item, depth + 1)
        return out
    if isinstance(value, list):
        return f"list:{len(value)}"
    if isinstance(value, str) and len(value) > 180:
        return value[:180]
    return value


def main():
    db = SessionLocal()
    try:
        key = _runninghub_api_key(db)
        body = json.dumps({"taskId": TASK_ID}).encode("utf-8")
        payload = _runninghub_json("POST", "/openapi/v2/query", key, body, {"Content-Type": "application/json"}, timeout=60)
        print(json.dumps(summarize(payload), ensure_ascii=False, indent=2))
    finally:
        db.close()


if __name__ == "__main__":
    main()
