"""Local check for studio_media.run_replication_intake (needs ffmpeg on PATH)."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import studio_media  # noqa: E402


def main() -> None:
    work = Path(tempfile.mkdtemp(prefix="intake-test-"))
    source = work / "in.mp4"
    subprocess.run(
        [
            studio_media.FFMPEG_BIN, "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "color=red:s=640x360:d=2",
            "-f", "lavfi", "-i", "color=blue:s=640x360:d=2",
            "-f", "lavfi", "-i", "testsrc=s=640x360:d=2",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
            "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
            "-map", "[v]", "-map", "3:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-shortest", str(source),
        ],
        check=True,
    )
    result, outputs = studio_media.run_replication_intake(source, work, {"max_seconds": 5})
    print(json.dumps(result, ensure_ascii=False, indent=1))
    print([name for name, _, _ in outputs])
    assert result["truncated"] is True
    assert len(result["shots"]) == 3, result["shots"]
    assert all(path.exists() for _, path, _ in outputs)


if __name__ == "__main__":
    main()
