"""Manual check: python test_person_pipeline.py <video> [work_dir]"""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

import person_pipeline


def main() -> None:
    source = Path(sys.argv[1])
    work = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(tempfile.mkdtemp(prefix="person-test-"))
    work.mkdir(parents=True, exist_ok=True)
    started = time.time()
    result, outputs = person_pipeline.run_replacement_intake(source, work, {"max_seconds": 60}, progress=lambda text: print("  ..", text))
    print(f"elapsed {time.time() - started:.1f}s, outputs {len(outputs)}, work {work}")
    print(f"shots {len(result['shots'])}, persons {sum(len(shot['persons']) for shot in result['shots'])}")
    for identity in result["identities"]:
        print(json.dumps(identity, ensure_ascii=False))
    for shot in result["shots"][:6]:
        print(shot["index"], shot["start"], shot["end"], [(person["identity"], person["score"], person.get("similarity"), person["review"]) for person in shot["persons"]])


if __name__ == "__main__":
    main()
