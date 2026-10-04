export interface VideoInfo {
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
  fileSize: number;
  heights: number[];
}

export type AudioFormat = "mp3" | "m4a" | "opus" | "wav";
export type AudioBitrate = "128k" | "192k" | "320k";
export type Format = "mp4" | AudioFormat;

export interface DownloadOptions {
  format: Format;
  height: number | null;
  audioBitrate: AudioBitrate;
}

export interface JobStatus {
  status: "queued" | "downloading" | "processing" | "done" | "error";
  progress: number;
  title?: string;
  fileSize?: number;
  fileName?: string;
  error?: string;
}

export function isAudioFormat(format: string): format is AudioFormat {
  return ["mp3", "m4a", "opus", "wav"].includes(format);
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data as T;
}

export const fetchInfo = (url: string) => post<VideoInfo>("api/info", { url });

export const startDownload = (url: string, o: DownloadOptions) =>
  post<{ id: string }>("api/download", {
    url,
    format: o.format,
    height: o.height,
    audio_bitrate: o.audioBitrate,
  });

export async function fetchStatus(id: string): Promise<JobStatus> {
  const r = await fetch(`api/status/${id}`);
  if (!r.ok) throw new Error("Download expired. Please start it again.");
  return r.json();
}

export const fileUrl = (id: string) => `api/file/${id}`;

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${parseFloat((bytes / Math.pow(1024, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDuration(seconds: number): string {
  if (!seconds) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
