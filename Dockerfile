FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ .
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY --from=web /web/dist web/dist
ENV PORT=8080
# Single worker: job state is in-memory. Threads handle concurrency.
CMD gunicorn -w 1 --threads 16 --timeout 0 -b 0.0.0.0:${PORT} app:app
