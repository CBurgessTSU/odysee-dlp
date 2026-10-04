import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from urllib.parse import urlparse

from flask import Flask, Response, jsonify, render_template, request, send_file
from yt_dlp import YoutubeDL

app = Flask(__name__)

DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", os.path.join(tempfile.gettempdir(), "odysee-dlp"))
APP_PASSWORD = os.environ.get("APP_PASSWORD")  # optional: enables HTTP basic auth
FILE_TTL = int(os.environ.get("FILE_TTL_SECONDS", "3600"))

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
jobs = {}
jobs_lock = threading.Lock()


@app.before_request
def check_auth():
    if not APP_PASSWORD:
        return None
    auth = request.authorization
    if auth and auth.password == APP_PASSWORD:
        return None
    return Response("Login required", 401, {"WWW-Authenticate": 'Basic realm="odysee-dlp"'})


def valid_url(url):
    try:
        p = urlparse(url)
    except ValueError:
        return False
    return p.scheme in ("http", "https") and bool(p.hostname)


def run_job(job_id, url, fmt):
    job = jobs[job_id]
    out_dir = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(out_dir, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                job["progress"] = round(d["downloaded_bytes"] / total * 100, 1)
        elif d["status"] == "finished":
            job["progress"] = 100
            job["status"] = "processing"

    opts = {
        "outtmpl": os.path.join(out_dir, "%(title).150B [%(id)s].%(ext)s"),
        "progress_hooks": [hook],
        "noplaylist": True,
        "quiet": True,
        "restrictfilenames": False,
    }
    if fmt == "mp3":
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}
        ]
    else:
        opts["format"] = "bestvideo+bestaudio/best"
        opts["merge_output_format"] = "mp4"

    try:
        with YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            job["title"] = info.get("title", "video")
        files = os.listdir(out_dir)
        if not files:
            raise RuntimeError("No file was produced")
        job["file"] = os.path.join(out_dir, files[0])
        job["status"] = "done"
    except Exception as e:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = re.sub(r"\x1b\[[0-9;]*m", "", str(e))


def cleanup_loop():
    while True:
        time.sleep(600)
        cutoff = time.time() - FILE_TTL
        for name in os.listdir(DOWNLOAD_DIR):
            path = os.path.join(DOWNLOAD_DIR, name)
            try:
                if os.path.getmtime(path) < cutoff:
                    shutil.rmtree(path, ignore_errors=True)
                    with jobs_lock:
                        jobs.pop(name, None)
            except OSError:
                pass


threading.Thread(target=cleanup_loop, daemon=True).start()


@app.get("/")
def index():
    return render_template("index.html")


@app.post("/api/download")
def start_download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    fmt = data.get("format", "mp4")
    if fmt not in ("mp4", "mp3"):
        return jsonify(error="Invalid format"), 400
    if not valid_url(url):
        return jsonify(error="Please enter a valid http(s) URL"), 400
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {"status": "downloading", "progress": 0}
    threading.Thread(target=run_job, args=(job_id, url, fmt), daemon=True).start()
    return jsonify(id=job_id)


@app.get("/api/status/<job_id>")
def status(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify(error="Unknown job"), 404
    return jsonify({k: v for k, v in job.items() if k != "file"})


@app.get("/api/file/<job_id>")
def get_file(job_id):
    job = jobs.get(job_id)
    if not job or job.get("status") != "done":
        return jsonify(error="File not ready"), 404
    return send_file(job["file"], as_attachment=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
