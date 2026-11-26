import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { EntryMediaPlayer } from "./EntryMediaPlayer";
import type { Entry } from "@/types/api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const baseEntry: Entry = {
  id: "entry-media",
  feedId: "feed-media",
  title: "Podcast episode",
  url: "https://example.com/posts/42",
  read: false,
  starred: false,
  muted: false,
  createdAt: "2026-11-26T00:00:00.000Z",
  updatedAt: "2026-11-26T00:00:00.000Z",
};

const playMock = vi.fn(() => Promise.resolve());
const pauseMock = vi.fn();

function decodeProxyPath(src: string): string {
  const encoded = src.split("/api/proxy/image/")[1]?.split("?")[0] ?? "";
  return Buffer.from(encoded, "base64").toString();
}

function mountAudio(mediaUrl = "https://cdn.example.com/episode.mp3") {
  const entry: Entry = {
    ...baseEntry,
    mediaUrl,
    mediaType: "audio/mpeg",
  };
  const { container } = render(<EntryMediaPlayer entry={entry} />);
  const audio = container.querySelector("audio") as HTMLAudioElement;
  Object.defineProperty(audio, "play", {
    value: playMock,
    configurable: true,
  });
  Object.defineProperty(audio, "pause", {
    value: pauseMock,
    configurable: true,
  });
  return { container, audio };
}

beforeEach(() => {
  playMock.mockClear();
  pauseMock.mockClear();
});

describe("EntryMediaPlayer · 音频附件", () => {
  it("走媒体代理渲染 <audio>，地址是 base64 编码后的原附件地址", () => {
    const { audio } = mountAudio();

    expect(screen.getByText("entry.media_audio_attachment")).toBeTruthy();
    const src = audio.getAttribute("src") ?? "";
    expect(src).toContain("/api/proxy/image/");
    expect(decodeProxyPath(src)).toBe("https://cdn.example.com/episode.mp3");
    // 播客不该在打开文章时整段下载
    expect(audio.getAttribute("preload")).toBe("metadata");
  });

  it("点击播放键调用 play()，实际播放后点击暂停调用 pause()", () => {
    const { audio } = mountAudio();

    fireEvent.click(
      screen.getByRole("button", { name: "entry.media_play_audio" }),
    );
    expect(playMock).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "entry.media_pause_audio" }),
    ).toBeNull();
    fireEvent.playing(audio);
    expect(
      screen.getByRole("button", { name: "entry.media_pause_audio" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "entry.media_pause_audio" }),
    );
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "entry.media_play_audio" }),
    ).toBeTruthy();
  });

  it("metadata 到齐后 Slider 可拖，直接 seek currentTime", () => {
    const { container, audio } = mountAudio();
    Object.defineProperty(audio, "duration", {
      value: 180,
      configurable: true,
    });
    fireEvent.loadedMetadata(audio);

    const range = container.querySelector(
      '[data-slot="entry-media-progress"] input[type="range"]',
    ) as HTMLInputElement;
    expect(range).not.toBeNull();
    expect(range.getAttribute("max")).toBe("180");

    Object.defineProperty(audio, "currentTime", {
      value: 0,
      writable: true,
      configurable: true,
    });
    fireEvent.change(range, { target: { value: "42" } });
    expect(audio.currentTime).toBe(42);
  });

  it("开始播放时补读后来才可用的时长", () => {
    const { audio } = mountAudio();
    Object.defineProperty(audio, "duration", { value: NaN, configurable: true });
    fireEvent.loadedMetadata(audio);
    Object.defineProperty(audio, "duration", { value: 12, configurable: true });
    fireEvent.playing(audio);
    expect(screen.getByText("0:12")).toBeTruthy();
  });

  it("timeupdate 推进播放头，时钟跟着走", () => {
    const { container, audio } = mountAudio();
    Object.defineProperty(audio, "duration", {
      value: 180,
      configurable: true,
    });
    fireEvent.loadedMetadata(audio);

    Object.defineProperty(audio, "currentTime", {
      value: 65,
      writable: true,
      configurable: true,
    });
    fireEvent.timeUpdate(audio);

    const range = container.querySelector(
      '[data-slot="entry-media-progress"] input[type="range"]',
    ) as HTMLInputElement;
    expect(range.getAttribute("value")).toBe("65");
    expect(screen.getByText("1:05")).toBeTruthy();
  });

  it("代理失败时给错误提示与「新窗口打开」出口，播放键禁用", () => {
    const { container, audio } = mountAudio();
    fireEvent.error(audio);

    const alert = container.querySelector('[data-slot="entry-media-error"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("entry.media_unavailable");

    const playButton = screen.getByRole("button", {
      name: "entry.media_play_audio",
    });
    expect(
      playButton.hasAttribute("disabled") ||
        playButton.getAttribute("aria-disabled") === "true",
    ).toBe(true);

    const external = within(screen.getByRole("alert")).getByRole("link", {
      name: "entry.media_open_window",
    });
    expect(external?.getAttribute("href")).toBe(
      "https://cdn.example.com/episode.mp3",
    );
    expect(external?.getAttribute("rel")).toContain("noopener");
  });

  it("播放调用被拒绝且不触发媒体 error 事件时仍显示失败状态", async () => {
    playMock.mockRejectedValueOnce(
      new DOMException("Bad media", "NotSupportedError"),
    );
    mountAudio();
    fireEvent.click(
      screen.getByRole("button", { name: "entry.media_play_audio" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "entry.media_unavailable",
    );
    expect(
      screen.queryByRole("button", { name: "entry.media_pause_audio" }),
    ).toBeNull();
  });

  it("自动播放权限拦截不显示附件错误，允许重试", async () => {
    playMock.mockRejectedValueOnce(
      new DOMException("Blocked", "NotAllowedError"),
    );
    const { audio } = mountAudio();
    const play = screen.getByRole("button", { name: "entry.media_play_audio" });
    fireEvent.click(play);
    await waitFor(() => expect(playMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(play);
    fireEvent.playing(audio);
    expect(playMock).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("button", { name: "entry.media_pause_audio" }),
    ).toBeTruthy();
  });

  it("切换到使用同一附件的另一条目时清空播放进度、时长和错误", () => {
    const entry = {
      ...baseEntry,
      mediaUrl: "https://cdn.example.com/episode.mp3",
      mediaType: "audio/mpeg",
    };
    const { container, rerender } = render(<EntryMediaPlayer entry={entry} />);
    const audio = container.querySelector("audio") as HTMLAudioElement;
    Object.defineProperty(audio, "duration", { value: 180 });
    audio.currentTime = 65;
    fireEvent.loadedMetadata(audio);
    fireEvent.timeUpdate(audio);
    fireEvent.error(audio);
    expect(screen.getByText("1:05")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(<EntryMediaPlayer entry={{ ...entry, id: "another-episode" }} />);
    expect(container.querySelector("audio")).not.toBe(audio);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("1:05")).toBeNull();
    expect(screen.getByRole("slider").hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "entry.media_play_audio" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});

describe("EntryMediaPlayer · 视频附件", () => {
  it("原生 controls + 代理地址 + 代理封面", () => {
    const entry: Entry = {
      ...baseEntry,
      mediaUrl: "https://cdn.example.com/clip.mp4",
      mediaType: "video/mp4",
      thumbnailUrl: "https://cdn.example.com/cover.jpg",
    };
    const { container } = render(<EntryMediaPlayer entry={entry} />);

    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(screen.getByText("entry.media_video_attachment")).toBeTruthy();
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(decodeProxyPath(video.getAttribute("src") ?? "")).toBe(
      "https://cdn.example.com/clip.mp4",
    );
    expect(decodeProxyPath(video.getAttribute("poster") ?? "")).toBe(
      "https://cdn.example.com/cover.jpg",
    );
  });

  it("视频加载失败时在画面上给兜底出口", () => {
    const entry: Entry = {
      ...baseEntry,
      mediaUrl: "https://cdn.example.com/clip.mp4",
      mediaType: "video/mp4",
    };
    const { container } = render(<EntryMediaPlayer entry={entry} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.error(video);

    const alert = container.querySelector('[data-slot="entry-media-error"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("entry.media_unavailable");
    expect(
      alert?.querySelector('a[href="https://cdn.example.com/clip.mp4"]'),
    ).not.toBeNull();
  });
});

describe("EntryMediaPlayer · 不渲染的情况", () => {
  it("没有附件字段时整体不渲染", () => {
    const { container } = render(<EntryMediaPlayer entry={baseEntry} />);
    expect(container.firstChild).toBeNull();
  });

  it("MIME 不是音视频时不渲染（不按扩展名硬猜）", () => {
    const entry: Entry = {
      ...baseEntry,
      mediaUrl: "https://cdn.example.com/episode.mp3",
      mediaType: "application/pdf",
    };
    const { container } = render(<EntryMediaPlayer entry={entry} />);
    expect(container.firstChild).toBeNull();
  });
});
