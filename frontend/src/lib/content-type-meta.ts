import {
  AudioIcon,
  BellIcon,
  FileTextIcon,
  ImageIcon,
  SocialIcon,
  VideoIcon,
} from "@/components/ui/icons";
import type { ContentType } from "@/types/api";

/**
 * 内容类型 → 图标 + 文案键。
 *
 * 抽出来是因为它出现在两处：中栏的类型切换器（ContentTypeSwitcher）与
 * 订阅右键的「更改类型」（用户第十一批 11-6：右键菜单也要显示视图图标）。
 * 两处必须同一套图标，否则同一个类型在两个地方长得不一样。
 *
 * 2026-11-26：加了 video / audio 两档（视频源、播客源各归各的分类）。顺序沿用
 * 「原有的四档在前、新档追加在后」，顺序与后端 defaultAppearanceContentTypes 逐项一致 ——
 * 老库补档时也是按这个顺序补到列表末尾，设置页的行序、右键菜单的项序都由它决定。
 */
export const CONTENT_TYPE_ORDER: ContentType[] = [
  "article",
  "picture",
  "notification",
  "social",
  "video",
  "audio",
];

export const contentTypeMeta: Record<
  ContentType,
  { icon: typeof FileTextIcon; labelKey: string }
> = {
  article: { icon: FileTextIcon, labelKey: "content_type.article" },
  picture: { icon: ImageIcon, labelKey: "content_type.picture" },
  notification: { icon: BellIcon, labelKey: "content_type.notification" },
  social: { icon: SocialIcon, labelKey: "content_type.social" },
  video: { icon: VideoIcon, labelKey: "content_type.video" },
  audio: { icon: AudioIcon, labelKey: "content_type.audio" },
};

const CONTENT_TYPE_SET: ReadonlySet<string> = new Set(CONTENT_TYPE_ORDER);

/**
 * 宽入参的收窄：地址栏 `?type=`、设置里存下来的数组、后端返回的类型字符串
 * 都可能带历史值或脏值，统一走这里判一次。
 *
 * 以前这段四连判断在 router / useVisibleContentTypes / Sidebar / AppearanceSettings
 * 各抄了一遍 —— 加 video / audio 时漏掉任何一处都会表现成「切过去又跳回来」，
 * 所以收成一个来源。
 */
export function isContentType(value: unknown): value is ContentType {
  return typeof value === "string" && CONTENT_TYPE_SET.has(value);
}
