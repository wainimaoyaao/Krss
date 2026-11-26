import { useEffect, useMemo } from "react";
import { CONTENT_TYPE_ORDER, isContentType } from "@/lib/content-type-meta";
import type { ContentType } from "@/types/api";

/** 外观设置里没配或配空时的默认视图（= 全部六档，顺序见 CONTENT_TYPE_ORDER） */
export const defaultContentTypes: ContentType[] = CONTENT_TYPE_ORDER;

export interface VisibleContentTypesOptions {
  /** `useAppearanceSettings()` 的 data；未加载完是 undefined */
  appearanceSettings?: { contentTypes?: ContentType[] } | null;
  /** 当前地址栏上的内容类型（`?type=`） */
  contentType: ContentType;
  /** 走 `/all?type=…` 的导航器（`useSelection()` 的 selectAll） */
  selectAll: (contentType?: ContentType, options?: { replace?: boolean }) => void;
}

/**
 * 侧栏里真正要显示的视图集合（写死的四档里取用户勾选的），外加一条兜底：
 * 当前地址栏的 `?type=` 不在这个集合里（用户在设置里关掉了它）时，原地 replace 到第一个可见档。
 *
 * 从 `AuthenticatedApp` 里整段搬出来（2026-11-26），行为不变。
 */
export function useVisibleContentTypes({
  appearanceSettings,
  contentType,
  selectAll,
}: VisibleContentTypesOptions): ContentType[] {
  const visibleContentTypes = useMemo(() => {
    const current = appearanceSettings?.contentTypes;
    if (!current || current.length === 0) return defaultContentTypes;
    return current.filter(isContentType);
  }, [appearanceSettings]);

  useEffect(() => {
    if (!visibleContentTypes.includes(contentType)) {
      const next = visibleContentTypes[0] ?? "article";
      selectAll(next, { replace: true });
    }
  }, [visibleContentTypes, contentType, selectAll]);

  return visibleContentTypes;
}
