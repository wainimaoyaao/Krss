/**
 * 条目详情里的 RSS 附件播放器。
 *
 * 音频：自绘播放键 + HeroUI Slider（形态与 ArticleVideo 的控制条一致），
 * 因为播客最需要的是「一眼能播、能拖进度」，原生 `<audio controls>` 在不同
 * WebView 里长相不一，也没有和文章排版对齐的样式。
 *
 * 视频：原生 controls（附件视频不追求花哨，原生控件在移动端最稳），
 * 只负责把地址换成代理地址、补封面与错误兜底。
 *
 * 地址与鉴权：
 * - 一律经 `getProxiedImageUrl` 走现有 `/api/proxy/image/:base64` 媒体代理：
 *   后端放行 audio/* 与 video/*、透传 Range 并补 206，网页同源下 `<audio>/<video>`
 *   靠 `krss_auth` cookie 过 JWT，不需要额外加头（见 backend/internal/http/middleware.go）。
 * - App（VITE_API_URL 跨源）带不了 cookie，也加不了自定义头，所以先用
 *   `getAuthedImageUrl` 带 Bearer 取回 blob 再交给标签；代价是丢掉 Range、
 *   整段下载后才能拖。因此 App 里**先等用户点播放**再拉流，不在打开文章时偷跑 64MB。
 * - 失败（401/413/502、超过代理 64MB 上限等）统一给「新窗口打开」出口。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Slider } from "@heroui/react";
import {
  ExternalLink,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  Video,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveEntryMedia, type EntryMediaSource } from "@/lib/entry-media";
import { getProxiedImageUrl } from "@/lib/image-proxy";
import { API_BASE_URL } from "@/lib/server-url";
import { getAuthedImageUrl, useAuthedImageUrl } from "@/lib/use-authed-image";
import type { Entry } from "@/types/api";

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isPlaybackFailure(error: unknown): boolean {
  // 权限限制或播放被取消不代表附件不可用，用户仍可再次点击。
  return !(
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "AbortError")
  );
}

function useEntryMediaElement<T extends HTMLMediaElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    return () => {
      // 离开条目时停止已从 DOM 移除的媒体。
      if (element && !element.paused) element.pause();
    };
  }, []);
  return ref;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * 把附件地址换成可播放的 src，并处理 App 内的 Bearer 鉴权。
 *
 * 网页同源：`requiresAuth` 为 false，src 立即就是代理地址，标签自己发 Range 请求。
 * App：先返回 undefined，等 `start()` 后才带 token 取 blob；取不到就进 error。
 */
function useMediaStream(
  media: EntryMediaSource,
  articleUrl: string | undefined,
) {
  const proxied = useMemo(
    () => getProxiedImageUrl(media.url, articleUrl),
    [media.url, articleUrl],
  );
  const requiresAuth =
    Boolean(API_BASE_URL) && proxied.startsWith(`${API_BASE_URL}/api/`);
  const [started, setStarted] = useState(false);
  const [authSrc, setAuthSrc] = useState<string | undefined>(undefined);
  const [authStatus, setAuthStatus] = useState<LoadStatus>("idle");

  useEffect(() => {
    // 网页同源：代理地址直接交给标签，浏览器自己发 Range（cookie 鉴权），不需要 fetch。
    if (!requiresAuth || !started) return;

    let cancelled = false;
    void getAuthedImageUrl(proxied).then((resolved) => {
      if (cancelled) return;
      setAuthSrc(resolved ?? undefined);
      setAuthStatus(resolved ? "ready" : "error");
    });

    return () => {
      cancelled = true;
    };
  }, [proxied, requiresAuth, started]);

  const start = useCallback(() => {
    setStarted(true);
    setAuthStatus("loading");
  }, []);

  return {
    src: requiresAuth ? authSrc : proxied,
    status: requiresAuth ? authStatus : "ready",
    start,
  };
}

function ExternalOpenLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius)] text-muted-foreground transition-colors duration-200 hover:bg-secondary hover:text-foreground"
    >
      <ExternalLink className="size-4" />
    </a>
  );
}

function PlayerShell({
  icon,
  label,
  openLabel,
  href,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  openLabel: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-slot="entry-media-player"
      className="my-5 overflow-hidden rounded-2xl border border-border/60 bg-secondary/40"
    >
      <div className="flex items-center gap-2 px-4 py-2.5">
        <span className="text-primary" aria-hidden="true">
          {icon}
        </span>
        <span className="text-sm font-medium">{label}</span>
        <span className="ml-auto">
          <ExternalOpenLink href={href} label={openLabel} />
        </span>
      </div>
      {children}
    </section>
  );
}

function EntryAudioPlayer({
  media,
  articleUrl,
}: {
  media: EntryMediaSource;
  articleUrl?: string;
}) {
  const { t } = useTranslation();
  const audioRef = useEntryMediaElement<HTMLAudioElement>();
  const { src, status, start } = useMediaStream(media, articleUrl);

  const [paused, setPaused] = useState(true);
  const [wantPlay, setWantPlay] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [hasError, setHasError] = useState(false);

  const unavailable = hasError || status === "error";
  const loading = status === "loading";
  const updateDuration = ({ currentTarget }: React.SyntheticEvent<HTMLAudioElement>) => {
    const next = currentTarget.duration;
    setDuration(Number.isFinite(next) ? next : 0);
  };

  const play = useCallback((audio: HTMLAudioElement) => {
    void audio.play().catch((error: unknown) => {
      setPaused(true);
      if (isPlaybackFailure(error)) setHasError(true);
    });
  }, []);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || unavailable || loading) return;
    if (!paused) {
      audio.pause();
      setPaused(true);
    } else if (src) {
      // 同源直接在点击回调播放，保留浏览器的用户激活状态。
      play(audio);
    } else {
      start();
      setWantPlay(true);
    }
  }, [audioRef, loading, paused, play, src, start, unavailable]);

  // App 里先等 blob；若浏览器拦自动播放，用户可以再次点击。
  useEffect(() => {
    const audio = audioRef.current;
    if (wantPlay && src && audio) play(audio);
  }, [audioRef, play, src, wantPlay]);

  const seekTo = useCallback(
    (next: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      setPosition(next);
      try {
        audio.currentTime = next;
      } catch {
        // 元数据没到时 currentTime 可能抛：忽略，等用户再拖
      }
    },
    [audioRef],
  );

  return (
    <PlayerShell
      icon={<Headphones className="size-4" />}
      label={t("entry.media_audio_attachment")}
      openLabel={t("entry.media_open_window")}
      href={media.url}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={updateDuration}
        onDurationChange={updateDuration}
        onCanPlay={updateDuration}
        onTimeUpdate={() => {
          if (scrubbing) return;
          setPosition(audioRef.current?.currentTime ?? 0);
        }}
        onPlaying={(event) => {
          updateDuration(event);
          setPaused(false);
        }}
        onPause={() => setPaused(true)}
        onEnded={() => {
          setPaused(true);
          setWantPlay(false);
        }}
        onError={() => {
          setPaused(true);
          setHasError(true);
        }}
      />

      <div className="flex items-center gap-3 px-4 pb-3 pt-1">
        <Button
          isIconOnly
          size="sm"
          variant="primary"
          aria-label={
            paused ? t("entry.media_play_audio") : t("entry.media_pause_audio")
          }
          isDisabled={unavailable || loading}
          onPress={togglePlayback}
          data-slot="entry-media-play"
        >
          {loading ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : paused ? (
            <Play className="size-4 fill-current" aria-hidden="true" />
          ) : (
            <Pause className="size-4 fill-current" aria-hidden="true" />
          )}
        </Button>

        <div className="min-w-0 flex-1">
          <Slider
            className="w-full"
            minValue={0}
            maxValue={Math.max(duration, 1)}
            step={0.1}
            value={Math.min(position, Math.max(duration, 1))}
            isDisabled={unavailable || duration <= 0}
            onChange={(next) => {
              // 与 ArticleVideo 同口径：HeroUI 没有 onChangeStart，按下即标记 scrubbing，
              // 拖动过程中的 timeupdate 不要覆盖手指位置。
              setScrubbing(true);
              seekTo(Array.isArray(next) ? (next[0] ?? 0) : next);
            }}
            onChangeEnd={(next) => {
              setScrubbing(false);
              seekTo(Array.isArray(next) ? (next[0] ?? 0) : next);
            }}
            aria-label={t("entry.media_scrub_label")}
            data-slot="entry-media-progress"
          >
            <Slider.Track className="h-1.5 rounded-full bg-border">
              <Slider.Fill className="rounded-full bg-primary" />
              <Slider.Thumb className="size-3 rounded-full bg-primary shadow-sm after:hidden" />
            </Slider.Track>
          </Slider>
          <div className="mt-1 flex justify-between text-[11px] leading-none tabular-nums text-muted-foreground">
            <span>{formatClock(position)}</span>
            <span>{formatClock(duration)}</span>
          </div>
        </div>
      </div>

      {unavailable && (
        <p
          role="alert"
          className="px-4 pb-3 text-xs text-muted-foreground"
          data-slot="entry-media-error"
        >
          {t("entry.media_unavailable")}{" "}
          <a
            href={media.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-primary/40 underline-offset-2 hover:text-foreground"
          >
            {t("entry.media_open_window")}
          </a>
        </p>
      )}
    </PlayerShell>
  );
}

function EntryVideoPlayer({
  media,
  articleUrl,
  poster,
}: {
  media: EntryMediaSource;
  articleUrl?: string;
  poster?: string;
}) {
  const { t } = useTranslation();
  const videoRef = useEntryMediaElement<HTMLVideoElement>();
  const { src, status, start } = useMediaStream(media, articleUrl);
  const [wantPlay, setWantPlay] = useState(false);
  const [hasError, setHasError] = useState(false);

  const proxiedPoster = useMemo(
    () => (poster ? getProxiedImageUrl(poster, articleUrl) : undefined),
    [poster, articleUrl],
  );
  const authedPoster = useAuthedImageUrl(proxiedPoster);
  const unavailable = hasError || status === "error";
  const loading = status === "loading";

  const handleStart = useCallback(() => {
    if (unavailable) return;
    start();
    setWantPlay(true);
  }, [start, unavailable]);

  useEffect(() => {
    if (!wantPlay || !src) return;
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(
      () => setWantPlay(false),
      (error: unknown) => {
        setWantPlay(false);
        if (isPlaybackFailure(error)) setHasError(true);
      },
    );
  }, [src, videoRef, wantPlay]);

  return (
    <PlayerShell
      icon={<Video className="size-4" />}
      label={t("entry.media_video_attachment")}
      openLabel={t("entry.media_open_window")}
      href={media.url}
    >
      <div className="relative aspect-video w-full bg-black">
        <video
          ref={videoRef}
          src={src}
          poster={authedPoster}
          controls
          playsInline
          preload="metadata"
          className="size-full"
          onError={() => setHasError(true)}
        />

        {/* App 里 src 要等点击后才拉 blob；在此之前原生控件没法播，给一个明确的播放入口 */}
        {!src && !unavailable && (
          <Button
            isIconOnly
            variant="ghost"
            isDisabled={loading}
            onPress={handleStart}
            aria-label={t("entry.media_play_video")}
            data-slot="entry-media-play"
            className="absolute inset-0 size-full rounded-none bg-black/20 hover:bg-black/30"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
              {loading ? (
                <LoaderCircle
                  className="size-5 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Play
                  className="ml-0.5 size-5 fill-current"
                  aria-hidden="true"
                />
              )}
            </span>
          </Button>
        )}

        {unavailable && (
          <div
            role="alert"
            data-slot="entry-media-error"
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 px-6 text-center text-xs text-white/85"
          >
            <span>{t("entry.media_unavailable")}</span>
            <a
              href={media.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-white"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              {t("entry.media_open_window")}
            </a>
          </div>
        )}
      </div>
    </PlayerShell>
  );
}

/**
 * 只在条目带有效音视频附件时渲染；其余情况整体返回 null，不占正文空间。
 */
export function EntryMediaPlayer({ entry }: { entry: Entry }) {
  const media = useMemo(() => resolveEntryMedia(entry), [entry]);
  if (!media) return null;

  const playerKey = JSON.stringify([
    entry.id,
    entry.url,
    media.url,
    media.mimeType,
  ]);
  return media.kind === "audio" ? (
    <EntryAudioPlayer key={playerKey} media={media} articleUrl={entry.url} />
  ) : (
    <EntryVideoPlayer
      key={playerKey}
      media={media}
      articleUrl={entry.url}
      poster={entry.thumbnailUrl}
    />
  );
}
