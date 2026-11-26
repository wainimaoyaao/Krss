/**
 * RSS 附件（enclosure）的解析与校验。
 *
 * 后端契约只有两个可选字段：`mediaUrl`（附件地址）与 `mediaType`（MIME）。
 * 这里把「能不能在这个播放器里放」的判断集中到一处，组件只负责渲染：
 * - 地址必须是 http/https，且不带 userinfo（与后端 proxy 的 parseMediaURL 同口径）；
 * - 有 mediaType 时只认 `audio/*` / `video/*`，声明成别的类型就不播（比如 application/pdf）；
 * - 没有 mediaType 时按扩展名兜底，认不出来就当没有附件。
 *
 * 注意：文件大小上限在代理层（64MB），这里不做 HEAD 请求——附件地址很多不支持 HEAD，
 * 失败时由播放器的错误兜底提示 + 新窗口打开。
 */
import { toAbsoluteUrl } from "@/lib/image-proxy";
import { isSafeUrl } from "@/lib/url";

export type EntryMediaKind = "audio" | "video";

export interface EntryMediaSource {
  /** 已解析成绝对地址、且通过协议/凭据校验的 URL */
  url: string;
  kind: EntryMediaKind;
  /** 归一化后的 MIME（小写、去掉 `;charset=...`）；没有声明时为 null */
  mimeType: string | null;
}

export interface EntryMediaFields {
  mediaUrl?: string;
  mediaType?: string;
  /** 条目原文地址，用于解析相对附件地址 */
  url?: string;
}

const AUDIO_EXTENSION = /\.(?:mp3|m4a|m4b|aac|ogg|oga|opus|wav|flac|weba)(?:$|[?#])/i;
const VIDEO_EXTENSION = /\.(?:mp4|m4v|mov|webm|ogv|mkv)(?:$|[?#])/i;

/**
 * MIME 归一化：` Audio/MPEG; charset=utf-8 ` → `audio/mpeg`。
 * 空值 / 只有参数时返回 null。
 */
export function normalizeEntryMediaType(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const mime = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return mime || null;
}

function inferKindFromUrl(url: string): EntryMediaKind | null {
  if (AUDIO_EXTENSION.test(url)) return "audio";
  if (VIDEO_EXTENSION.test(url)) return "video";
  return null;
}

function hasCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return Boolean(parsed.username || parsed.password);
  } catch {
    return true;
  }
}

/**
 * 把条目的 `mediaUrl` / `mediaType` 解析成可播放的媒体源。
 * 没有附件、地址不安全、类型不是音视频时一律返回 null（组件据此整体不渲染）。
 */
export function resolveEntryMedia(
  entry: EntryMediaFields | null | undefined,
): EntryMediaSource | null {
  const rawUrl = entry?.mediaUrl?.trim();
  if (!rawUrl) return null;

  const absoluteUrl = toAbsoluteUrl(rawUrl, entry?.url);
  if (!absoluteUrl || !isSafeUrl(absoluteUrl) || hasCredentials(absoluteUrl)) {
    return null;
  }

  const mimeType = normalizeEntryMediaType(entry?.mediaType);
  let kind: EntryMediaKind | null;

  if (mimeType) {
    // 明确声明了类型就只信声明：application/octet-stream 不猜、不播。
    if (mimeType.startsWith("audio/")) {
      kind = "audio";
    } else if (mimeType.startsWith("video/")) {
      kind = "video";
    } else {
      return null;
    }
  } else {
    kind = inferKindFromUrl(absoluteUrl);
  }

  if (!kind) return null;

  return { url: absoluteUrl, kind, mimeType };
}
