"""Command-line entry point (used by the GitHub Actions workflow).

Usage: python cli.py URL FORMAT HEIGHT OUT_DIR
  FORMAT: mp4 | mp3 | m4a | opus | wav     HEIGHT: 720, 480, ... or "original"
"""
import os
import re
import shutil
import sys
import threading
import time

import app


def main(url, fmt, height, out_dir):
    h = None if height in ("original", "", "0") else int(height)
    job_id = "cli"
    app.jobs[job_id] = {"status": "downloading", "progress": 0}
    job = app.jobs[job_id]
    t = threading.Thread(target=app.run_job, args=(job_id, url, fmt, h, "192"))
    t.start()
    last = -1
    while t.is_alive():
        time.sleep(15)
        if int(job["progress"]) // 5 != last:
            last = int(job["progress"]) // 5
            print(f"{job['status']}: {job['progress']}%", flush=True)
    if job["status"] != "done":
        print("ERROR:", job.get("error", "unknown error"), file=sys.stderr)
        return 1
    os.makedirs(out_dir, exist_ok=True)
    # Artifact names can't contain these characters.
    name = re.sub(r'["<>|*?\\/:\r\n]', "", job["fileName"]).strip() or f"video.{fmt}"
    shutil.copy(job["file"], os.path.join(out_dir, name))
    print(f"Done: {name} ({job['fileSize'] / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:5]))
