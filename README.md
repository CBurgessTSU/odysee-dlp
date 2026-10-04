# odysee-dlp

Mobile-first web app: paste a video link (Odysee first, other yt-dlp sites later) and save an MP4 or audio file. React + Tailwind frontend (`web/`), Flask + yt-dlp + ffmpeg backend (`app.py`). Files are downloaded and converted on the server and sent to the phone as a normal download, which is far more reliable on iPhone than in-browser conversion.

## Run locally
Requires Python 3.10+, ffmpeg, Node 20+.

```bash
cd web && npm ci && npm run build && cd ..
pip install -r requirements.txt
python app.py   # http://localhost:8080
```

Or: `docker build -t odysee-dlp . && docker run -p 8080:8080 odysee-dlp`

## Deploy on Render
New > Blueprint > pick this repo (uses `render.yaml` + `Dockerfile`).

| Env var | Purpose |
|---|---|
| `APP_PASSWORD` | Optional. Enables HTTP basic auth (any username, this password). Recommended. |
| `FILE_TTL_SECONDS` | Delete finished files after this long (default 3600). |
| `MAX_CONCURRENT_JOBS` | Simultaneous downloads (default 2). |

Keep yt-dlp current: redeploy (clear build cache) if downloads break.

Only download content you have the right to.
