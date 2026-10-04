import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from urllib.parse import urlparse

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from yt_dlp import YoutubeDL as _YoutubeDL


class YoutubeDL(_YoutubeDL):
    """yt-dlp with a longer socket timeout and retries on flaky Odysee API calls."""

    def __init__(self, params=None, **kw):
        params = {"socket_timeout": 60, "retries": 10, "fragment_retries": 10,
                  "extractor_retries": 5, **(params or {})}
        super().__init__(params, **kw)

    def extract_info(self, url, *args, **kwargs):
        for attempt in range(5):
            try:
                return super().extract_info(url, *args, **kwargs)
            except Exception as e:  # noqa: BLE001
                transient = "timed out" in str(e) or "Unable to download" in str(e)
                if not transient or attempt == 4:
                    raise
                time.sleep(5 * (attempt + 1))

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "dist")
app = Flask(__name__, static_folder=None)

DOWNLOAD_DIR = os.environ.get("DOWNLOAD_DIR", os.path.join(tempfile.gettempdir(), "odysee-dlp"))
APP_PASSWORD = os.environ.get("APP_PASSWORD")  # optional: enables HTTP basic auth
FILE_TTL = int(os.environ.get("FILE_TTL_SECONDS", "3600"))
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT_JOBS", "2"))

AUDIO_FORMATS = {"mp3", "m4a", "opus", "wav"}
BITRATES = {"128k": "128", "192k": "192", "320k": "320"}

os.makedirs(DOWNLOAD_DIR, exist_ok=True)
jobs = {}
jobs_lock = threading.Lock()
slots = threading.Semaphore(MAX_CONCURRENT)
ANSI = re.compile(r"\x1b\[[0-9;]*m")


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


def clean_error(e):
    msg = ANSI.sub("", str(e))
    return re.sub(r"^ERROR:\s*", "", msg)[:500]


def video_selector(height):
    # Prefer H.264/AAC so files play natively on iPhone.
    h = f"[height<={int(height)}]" if height else ""
    return (
        f"bv*{h}[vcodec^=avc1]+ba[ext=m4a]/b{h}[ext=mp4]/"
        f"bv*{h}+ba/b{h}/b"
    )


def transcode(job, url, height, out_dir):
    """Stream the source straight into ffmpeg and scale it down (no full-size file on disk)."""
    with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True,
                    "format": video_selector(None)}) as ydl:
        d = ydl.extract_info(url, download=False)
    title = re.sub(r'[\\/:*?"<>|]', "", d.get("title") or "video")[:120].strip() or "video"
    duration = d.get("duration") or 0
    sources = d.get("requested_formats") or [d]
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:1", "-nostats"]
    for f in sources:
        hdrs = "".join(f"{k}: {v}\r\n" for k, v in (f.get("http_headers") or {}).items())
        cmd += ["-skip_loop_filter", "all", "-headers", hdrs, "-i", f["url"]]
    if len(sources) > 1:
        cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    else:
        cmd += ["-map", "0:v:0", "-map", "0:a:0?"]
    out = os.path.join(out_dir, f"{title} ({height}p).mp4")
    cmd += ["-vf", f"scale=-2:{int(height)}:flags=fast_bilinear,fps=24", "-c:v", "libx264",
            "-preset", "superfast",
            "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
            "-movflags", "+faststart", out]
    job["status"] = "processing"
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    for line in p.stdout:
        if line.startswith("out_time_us=") and duration:
            try:
                job["progress"] = round(min(int(line.split("=")[1]) / 1e6 / duration, 1) * 99, 1)
            except ValueError:
                pass
    err = p.stderr.read()
    if p.wait() != 0:
        raise RuntimeError(err.strip().splitlines()[-1] if err.strip() else "ffmpeg failed")
    return out


def run_job(job_id, url, fmt, height, bitrate):
    job = jobs[job_id]
    if fmt == "mp4" and height:
        try:
            with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True}) as ydl:
                hs = [f.get("height") or 0 for f in ydl.extract_info(url, download=False).get("formats", [])]
            job["source_height"] = max(hs, default=0) or 10**6
        except Exception:  # noqa: BLE001
            job["source_height"] = 10**6
    out_dir = os.path.join(DOWNLOAD_DIR, job_id)
    os.makedirs(out_dir, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                job["progress"] = round(min(d["downloaded_bytes"] / total, 1) * 95, 1)
        elif d["status"] == "finished":
            job["progress"] = 95
            job["status"] = "processing"

    opts = {
        "outtmpl": os.path.join(out_dir, "%(title).120B.%(ext)s"),
        "progress_hooks": [hook],
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        "no_warnings": True,
        "windowsfilenames": True,
    }
    if fmt in AUDIO_FORMATS:
        opts["format"] = "bestaudio/best"
        pp = {"key": "FFmpegExtractAudio", "preferredcodec": fmt}
        if fmt in ("mp3", "m4a", "opus"):
            pp["preferredquality"] = bitrate
        opts["postprocessors"] = [pp]
    else:
        opts["format"] = video_selector(height)
        opts["merge_output_format"] = "mp4"
        opts["postprocessor_args"] = {"merger": ["-movflags", "+faststart"]}

    try:
        with slots:
            if fmt == "mp4" and height and height < job.get("source_height", 10**6):
                transcode(job, url, height, out_dir)
            else:
                with YoutubeDL(opts) as ydl:
                    ydl.extract_info(url, download=True)
        files = [f for f in os.listdir(out_dir) if not f.endswith((".part", ".ytdl"))]
        if not files:
            raise RuntimeError("No file was produced")
        path = os.path.join(out_dir, files[0])
        job.update(file=path, fileName=files[0], fileSize=os.path.getsize(path),
                   progress=100, status="done")
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=clean_error(e))


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


@app.post("/api/info")
def info():
    url = ((request.get_json(silent=True) or {}).get("url") or "").strip()
    if not valid_url(url):
        return jsonify(error="Please enter a valid http(s) link"), 400
    try:
        with YoutubeDL({"quiet": True, "no_warnings": True, "noplaylist": True,
                        "skip_download": True}) as ydl:
            d = ydl.extract_info(url, download=False)
    except Exception as e:  # noqa: BLE001
        return jsonify(error=clean_error(e)), 422
    formats = d.get("formats") or []
    heights = sorted({f["height"] for f in formats if f.get("height") and f.get("vcodec") != "none"},
                     reverse=True)
    sizes = [f.get("filesize") or f.get("filesize_approx") or 0 for f in formats]
    return jsonify(
        title=d.get("title") or "Untitled",
        channel=d.get("uploader") or d.get("channel") or "",
        thumbnail=d.get("thumbnail") or "",
        duration=d.get("duration") or 0,
        fileSize=max(sizes, default=0),
        heights=heights,
    )


@app.post("/api/download")
def start_download():
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    fmt = data.get("format", "mp4")
    height = data.get("height")
    bitrate = BITRATES.get(data.get("audio_bitrate"), "192")
    if fmt != "mp4" and fmt not in AUDIO_FORMATS:
        return jsonify(error="Invalid format"), 400
    if not valid_url(url):
        return jsonify(error="Please enter a valid http(s) link"), 400
    if height is not None and not isinstance(height, int):
        return jsonify(error="Invalid quality"), 400
    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {"status": "downloading", "progress": 0}
    threading.Thread(target=run_job, args=(job_id, url, fmt, height, bitrate), daemon=True).start()
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
    if not job or job.get("status") != "done" or not os.path.exists(job["file"]):
        return jsonify(error="File not ready or expired"), 404
    return send_file(job["file"], as_attachment=True, download_name=job["fileName"], conditional=True)


@app.get("/healthz")
def healthz():
    return "ok"


@app.get("/", defaults={"path": ""})
@app.get("/<path:path>")
def spa(path):
    if path and os.path.isfile(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    return send_from_directory(STATIC_DIR, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
