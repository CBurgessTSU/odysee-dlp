import { useState, useCallback } from "react";
import {
  Download,
  Link2,
  Film,
  Music,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  AlertCircle,
  Clock,
  HardDrive,
} from "lucide-react";
import {
  fetchInfo,
  startDownload,
  fetchStatus,
  fileUrl,
  isAudioFormat,
  formatBytes,
  formatDuration,
  type VideoInfo,
  type DownloadOptions,
  type AudioBitrate,
  type Format,
  type JobStatus,
} from "@/lib/api";

type FormatOption = Format;

interface DownloadTask {
  id: string; // server job id
  info: VideoInfo;
  options: DownloadOptions;
  progress: number;
  status: JobStatus["status"] | "error";
  error?: string;
  fileSize?: number;
  fileName?: string;
}


const FORMAT_CATEGORIES = [
  {
    label: "Video",
    icon: Film,
    formats: [
      { value: "mp4" as FormatOption, label: "MP4", desc: "Plays on iPhone" },
    ],
  },
  {
    label: "Audio Only",
    icon: Music,
    formats: [
      { value: "mp3" as FormatOption, label: "MP3", desc: "Universal audio" },
      { value: "m4a" as FormatOption, label: "M4A", desc: "AAC audio" },
      { value: "opus" as FormatOption, label: "Opus", desc: "Best compression" },
      { value: "wav" as FormatOption, label: "WAV", desc: "Lossless" },
    ],
  },
];

const AUDIO_BITRATES: { value: AudioBitrate; label: string; desc: string }[] = [
  { value: "128k", label: "128 kbps", desc: "Smallest" },
  { value: "192k", label: "192 kbps", desc: "Balanced" },
  { value: "320k", label: "320 kbps", desc: "Highest" },
];

const STANDARD_HEIGHTS = [1080, 720, 480, 360, 240];

// Source heights plus smaller phone-friendly sizes (made by converting).
function qualityChoices(source: number[]): number[] {
  const top = source.length ? Math.max(...source) : 1080;
  const set = new Set<number>([...source, ...STANDARD_HEIGHTS.filter((h) => h <= top)]);
  return [...set].sort((x, y) => y - x);
}

const STATUS_LABELS: Record<string, string> = {
  queued: "Waiting…",
  downloading: "Downloading to server…",
  processing: "Converting with FFmpeg…",
  done: "Ready",
  error: "Failed",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "text-amber-400",
  downloading: "text-blue-400",
  processing: "text-purple-400",
  done: "text-emerald-400",
  error: "text-red-400",
};

const PROGRESS_COLORS: Record<string, string> = {
  queued: "bg-amber-400",
  downloading: "bg-blue-500",
  processing: "bg-purple-400",
  done: "bg-emerald-500",
  error: "bg-red-500",
};

export default function App() {
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<FormatOption>("mp4");
  const [selectedHeight, setSelectedHeight] = useState<number | null>(null);
  const [audioBitrate, setAudioBitrate] = useState<AudioBitrate>("192k");
  const [tasks, setTasks] = useState<DownloadTask[]>([]);

  const audioOnly = isAudioFormat(selectedFormat);

  const updateTask = useCallback((id: string, updates: Partial<DownloadTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const handleResolve = useCallback(async () => {
    if (!url.trim()) return;
    setResolving(true);
    setResolveError(null);
    setInfo(null);
    try {
      const videoInfo = await fetchInfo(url.trim());
      setInfo(videoInfo);
      setSelectedHeight(480); // phone-friendly default
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to look up URL");
    } finally {
      setResolving(false);
    }
  }, [url]);

  const pollJob = useCallback(
    async (id: string) => {
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const s = await fetchStatus(id);
          updateTask(id, {
            status: s.status,
            progress: s.progress,
            error: s.error,
            fileSize: s.fileSize,
            fileName: s.fileName,
          });
          if (s.status === "done" || s.status === "error") return;
        } catch (err) {
          updateTask(id, { status: "error", error: err instanceof Error ? err.message : "Lost connection" });
          return;
        }
      }
    },
    [updateTask],
  );

  const handleDownload = useCallback(async () => {
    if (!info) return;
    const options: DownloadOptions = {
      format: selectedFormat,
      height: audioOnly ? null : selectedHeight,
      audioBitrate,
    };
    try {
      const { id } = await startDownload(url.trim(), options);
      setTasks((prev) => [{ id, info, options, progress: 0, status: "queued" }, ...prev]);
      setInfo(null);
      setUrl("");
      void pollJob(id);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Could not start download");
    }
  }, [info, url, selectedFormat, selectedHeight, audioOnly, audioBitrate, pollJob]);

  const handleRemoveTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // clipboard not available
    }
  }, []);

  return (
    <div className="min-h-[100dvh] bg-zinc-950 text-white">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-rose-600/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-emerald-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-md mx-auto px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(8rem,env(safe-area-inset-bottom))] min-h-[100dvh]">
        <header className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-rose-500 to-rose-700 shadow-lg shadow-rose-500/20 mb-3">
            <Download className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Odysee Downloader</h1>
          <p className="text-sm text-zinc-400 mt-1">Download videos & audio — Odysee and more</p>
        </header>

        <div className="space-y-3 mb-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
              <Link2 className="w-5 h-5 text-zinc-500" />
            </div>
            <input
              type="url"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleResolve()}
              placeholder="Paste video URL…"
              className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl pl-11 pr-32 py-4 text-base placeholder:text-zinc-600 focus:outline-none focus:border-rose-500/50 focus:ring-2 focus:ring-rose-500/20 transition-all"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 pr-2">
              {url && (
                <button
                  onClick={() => { setUrl(""); setInfo(null); setResolveError(null); }}
                  className="p-2.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                  aria-label="Clear"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={handlePaste}
                className="text-sm font-medium text-rose-400 hover:text-rose-300 px-2.5 py-2.5 transition-colors"
              >
                Paste
              </button>
            </div>
          </div>

          <button
            onClick={handleResolve}
            disabled={!url.trim() || resolving}
            className="w-full bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-2xl transition-all shadow-lg shadow-rose-600/20 active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {resolving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Looking up…
              </>
            ) : (
              <>
                <Download className="w-5 h-5" />
                Find Video
              </>
            )}
          </button>
        </div>

        {resolveError && (
          <div className="flex items-start gap-2.5 bg-red-950/40 border border-red-900/50 rounded-2xl p-3.5 mb-5 text-sm text-red-300">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{resolveError}</span>
          </div>
        )}

        {info && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {info.thumbnail && (
              <div className="relative aspect-video bg-zinc-800">
                <img
                  src={info.thumbnail}
                  alt={info.title}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                {info.duration > 0 && (
                  <div className="absolute bottom-2 right-2 bg-black/80 backdrop-blur px-2 py-0.5 rounded-md text-xs font-medium">
                    {formatDuration(info.duration)}
                  </div>
                )}
              </div>
            )}

            <div className="p-4 space-y-4">
              <div>
                <h3 className="font-semibold text-[15px] leading-snug line-clamp-2">{info.title}</h3>
                <p className="text-sm text-zinc-400 mt-1">{info.channel}</p>
              </div>

              {info.fileSize > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>{formatBytes(info.fileSize)}</span>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">File Type</p>
                <div className="grid grid-cols-2 gap-2">
                  {FORMAT_CATEGORIES.map((cat) =>
                    cat.formats.map((fmt) => {
                      const Icon = cat.icon;
                      const active = selectedFormat === fmt.value;
                      return (
                        <button
                          key={fmt.value}
                          onClick={() => setSelectedFormat(fmt.value)}
                          className={`flex items-center gap-2.5 px-3 py-3 min-h-[48px] rounded-xl border transition-all text-left active:scale-[0.97] ${
                            active
                              ? "bg-rose-600/15 border-rose-500/50 ring-1 ring-rose-500/20"
                              : "bg-zinc-800/50 border-zinc-800 hover:border-zinc-700"
                          }`}
                        >
                          <Icon className={`w-4 h-4 flex-shrink-0 ${active ? "text-rose-400" : "text-zinc-500"}`} />
                          <div className="min-w-0">
                            <div className={`text-sm font-semibold ${active ? "text-white" : "text-zinc-300"}`}>{fmt.label}</div>
                            <div className="text-[11px] text-zinc-500 truncate">{fmt.desc}</div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {!audioOnly && (
                <div className="animate-in fade-in duration-200">
                  <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Quality</p>
                  <div className="flex flex-wrap gap-2">
                    {qualityChoices(info.heights).map((h) => {
                      const active = selectedHeight === h;
                      return (
                        <button
                          key={h}
                          onClick={() => setSelectedHeight(h)}
                          className={`px-4 py-2.5 min-h-[44px] rounded-lg border text-sm font-medium transition-all active:scale-[0.95] ${
                            active
                              ? "bg-rose-600/15 border-rose-500/50 text-white ring-1 ring-rose-500/20"
                              : "bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                          }`}
                        >
                          {h}p
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-2">
                    Smaller sizes are converted on the server, so they take longer to start. Long videos can take a while.
                  </p>
                </div>
              )}

              {audioOnly && (
                <div className="animate-in fade-in duration-200 space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-2">Audio Quality</p>
                    <div className="flex flex-wrap gap-2">
                      {AUDIO_BITRATES.map((b) => {
                        const active = audioBitrate === b.value;
                        return (
                          <button
                            key={b.value}
                            onClick={() => setAudioBitrate(b.value)}
                            className={`px-4 py-2.5 min-h-[44px] rounded-lg border text-sm font-medium transition-all active:scale-[0.95] ${
                              active
                                ? "bg-purple-600/15 border-purple-500/50 text-white ring-1 ring-purple-500/20"
                                : "bg-zinc-800/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                            }`}
                          >
                            {b.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 bg-purple-950/30 border border-purple-900/40 rounded-xl px-3 py-2.5">
                    <Music className="w-4 h-4 text-purple-400" />
                    <p className="text-xs text-purple-300">Audio converted on the server with FFmpeg</p>
                  </div>
                </div>
              )}

              <button
                onClick={handleDownload}
                className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-semibold py-4 rounded-2xl transition-all shadow-lg shadow-emerald-600/20 active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                Start Download
              </button>
            </div>
          </div>
        )}

        {tasks.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide px-1">Downloads</h2>
            {tasks.map((task) => (
              <DownloadCard key={task.id} task={task} onRemove={() => handleRemoveTask(task.id)} />
            ))}
          </div>
        )}

        {!info && !resolving && tasks.length === 0 && !resolveError && (
          <div className="text-center pt-16 pb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-900 mb-4">
              <Download className="w-8 h-8 text-zinc-700" />
            </div>
            <p className="text-zinc-500 text-sm max-w-[240px] mx-auto">
              Paste a video link above to get started. Download as video or audio-only.
            </p>
          </div>
        )}

        <footer className="mt-12 text-center space-y-1">
          <p className="text-[11px] text-zinc-600">
            On iPhone, tap Save, then find the file in Safari&apos;s Downloads (or tap Share → Save to Files).
          </p>
        </footer>
      </div>
    </div>
  );
}

function DownloadCard({ task, onRemove }: { task: DownloadTask; onRemove: () => void }) {
  const { info, options, progress, status, error, fileSize, fileName } = task;
  const isComplete = status === "done";
  const isError = status === "error";
  const isActive = !isComplete && !isError;
  const audioOnly = isAudioFormat(options.format);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="flex gap-3 p-3">
        <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden bg-zinc-800">
          {info.thumbnail ? (
            <img
              src={info.thumbnail}
              alt={info.title}
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {audioOnly ? <Music className="w-6 h-6 text-zinc-700" /> : <Film className="w-6 h-6 text-zinc-700" />}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-sm font-medium leading-snug line-clamp-2 text-zinc-200">{info.title}</h4>
            <button
              onClick={onRemove}
              className="flex-shrink-0 p-2 -m-1 text-zinc-600 hover:text-red-400 transition-colors"
              aria-label="Remove"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-500">
            <span className="uppercase font-medium tracking-wide">{options.format}</span>
            <span className="text-zinc-700">·</span>
            <span>{audioOnly ? options.audioBitrate : options.height ? `${options.height}p` : "best"}</span>
            {info.duration > 0 && (
              <>
                <span className="text-zinc-700">·</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  {formatDuration(info.duration)}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-1.5">
            {isActive && <Loader2 className="w-3 h-3 animate-spin text-zinc-500" />}
            {isComplete && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
            {isError && <XCircle className="w-3.5 h-3.5 text-red-400" />}
            <span className={`text-xs font-medium ${STATUS_COLORS[status]}`}>
              {isError ? "Failed" : STATUS_LABELS[status]}
            </span>
            {isComplete && fileSize ? (
              <span className="text-[11px] text-zinc-600">· {formatBytes(fileSize)}</span>
            ) : null}
          </div>
        </div>
      </div>

      {isActive && (
        <div className="px-3 pb-3">
          <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className={`absolute inset-y-0 left-0 ${PROGRESS_COLORS[status]} rounded-full transition-all duration-300 ease-out`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="block mt-1.5 text-[11px] text-zinc-600">{Math.round(progress)}%</span>
        </div>
      )}

      {isComplete && fileName && (
        <div className="px-3 pb-3">
          <a
            href={fileUrl(task.id)}
            download={fileName}
            className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 active:scale-[0.98] text-white font-semibold py-4 rounded-2xl flex items-center justify-center gap-2 transition-all"
          >
            <Download className="w-5 h-5" />
            Save {audioOnly ? "audio" : "video"}
          </a>
        </div>
      )}

      {isError && (
        <div className="px-3 pb-3">
          <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2 text-xs text-red-300 break-words">
            {error || "An error occurred during download"}
          </div>
        </div>
      )}
    </div>
  );
}
