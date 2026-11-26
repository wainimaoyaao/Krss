import { describe, expect, it } from "vitest";
import {
  normalizeEntryMediaType,
  resolveEntryMedia,
} from "@/lib/entry-media";

describe("normalizeEntryMediaType", () => {
  it("小写化并剥掉参数", () => {
    expect(normalizeEntryMediaType(" Audio/MPEG; charset=utf-8 ")).toBe(
      "audio/mpeg",
    );
    expect(normalizeEntryMediaType("video/MP4;codecs=avc1")).toBe("video/mp4");
  });

  it("空值返回 null", () => {
    expect(normalizeEntryMediaType(undefined)).toBeNull();
    expect(normalizeEntryMediaType("")).toBeNull();
    expect(normalizeEntryMediaType("   ")).toBeNull();
    expect(normalizeEntryMediaType("; charset=utf-8")).toBeNull();
  });
});

describe("resolveEntryMedia", () => {
  it("audio/* 解析成音频源", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "https://cdn.example.com/ep.mp3",
        mediaType: "audio/mpeg",
      }),
    ).toEqual({
      url: "https://cdn.example.com/ep.mp3",
      kind: "audio",
      mimeType: "audio/mpeg",
    });
  });

  it("video/* 解析成视频源", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "https://cdn.example.com/clip.mp4",
        mediaType: "video/mp4",
      }),
    ).toEqual({
      url: "https://cdn.example.com/clip.mp4",
      kind: "video",
      mimeType: "video/mp4",
    });
  });

  it("没有 mediaType 时按扩展名兜底（忽略 query/hash）", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "https://cdn.example.com/EP.MP3?token=1#t=30",
      })?.kind,
    ).toBe("audio");
    expect(
      resolveEntryMedia({ mediaUrl: "https://cdn.example.com/clip.WEBM#t=1" })
        ?.kind,
    ).toBe("video");
  });

  it("声明了非音视频类型就不播，不按扩展名猜", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "https://cdn.example.com/ep.mp3",
        mediaType: "application/octet-stream",
      }),
    ).toBeNull();
    expect(
      resolveEntryMedia({
        mediaUrl: "https://cdn.example.com/clip.mp4",
        mediaType: "application/pdf",
      }),
    ).toBeNull();
  });

  it("没有 mediaUrl 时不渲染", () => {
    expect(resolveEntryMedia({ mediaType: "audio/mpeg" })).toBeNull();
    expect(resolveEntryMedia({ mediaUrl: "   " })).toBeNull();
  });

  it("拒绝非 http(s)、data: 与带凭据的地址", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "javascript:alert(1)",
        mediaType: "audio/mpeg",
      }),
    ).toBeNull();
    expect(
      resolveEntryMedia({
        mediaUrl: "ftp://example.com/ep.mp3",
        mediaType: "audio/mpeg",
      }),
    ).toBeNull();
    expect(
      resolveEntryMedia({
        mediaUrl: "data:audio/mpeg;base64,AAAA",
        mediaType: "audio/mpeg",
      }),
    ).toBeNull();
    expect(
      resolveEntryMedia({
        mediaUrl: "https://user@example.com/ep.mp3",
        mediaType: "audio/mpeg",
      }),
    ).toBeNull();
  });

  it("协议相对地址补成 https", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "//cdn.example.com/ep.mp3",
        mediaType: "audio/mpeg",
      })?.url,
    ).toBe("https://cdn.example.com/ep.mp3");
  });

  it("相对附件地址按条目原文解析", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "episode.mp3",
        mediaType: "audio/mpeg",
        url: "https://example.com/posts/42",
      })?.url,
    ).toBe("https://example.com/posts/episode.mp3");
  });

  it("相对地址没有基准 URL 时返回 null", () => {
    expect(
      resolveEntryMedia({
        mediaUrl: "episode.mp3",
        mediaType: "audio/mpeg",
      }),
    ).toBeNull();
  });

  it("没有 mediaType 且扩展名认不出来时返回 null", () => {
    expect(
      resolveEntryMedia({ mediaUrl: "https://example.com/download?id=42" }),
    ).toBeNull();
  });
});
