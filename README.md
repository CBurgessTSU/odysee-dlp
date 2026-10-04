# odysee-dlp

Tiny web app: paste an Odysee URL, get an MP4 (or MP3). Built with Flask, yt-dlp and ffmpeg.

## Run locally
Requires Python 3.10+ and ffmpeg on PATH.

```bash
pip install -r requirements.txt
python app.py   # http://localhost:8080
```

Or with Docker:

```bash
docker build -t odysee-dlp . && docker run -p 8080:8080 odysee-dlp
```

## Deploy on Render
Create a Web Service from this repo (it uses the Dockerfile / `render.yaml`).

| Env var | Purpose |
|---|---|
| `APP_PASSWORD` | Optional. If set, the site requires HTTP basic auth (any username, this password). Recommended for public deploys. |
| `FILE_TTL_SECONDS` | Delete finished files after this long (default 3600). |

Any URL yt-dlp supports works; Odysee is the primary target. Keep yt-dlp current (`pip install -U yt-dlp`, or rebuild the image) if downloads break.

Only download content you have the right to.
