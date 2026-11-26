import { useTranslation } from "react-i18next";
import { useEntry } from "@/hooks/useEntries";
import { buildTitle, useTitle } from "@/hooks/useTitle";
import { useFeeds } from "@/hooks/useFeeds";
import { useFolders } from "@/hooks/useFolders";
import type { SelectionType } from "@/hooks/useSelection";
import type { ContentType, Feed, Folder } from "@/types/api";
import { useMemo } from "react";

export interface DocumentTitleOptions {
  selection: SelectionType;
  contentType: ContentType;
  /** 当前打开条目的 id（详情视图里标题优先用它） */
  selectedEntryId: string | null;
}

/**
 * 文档标题：`<条目标题> | Krss` / `<订阅名> | Krss` / `<内容类型> | Krss`。
 *
 * 需要订阅与文件夹的名字，所以自己拉这两份列表（react-query 同 key 共享，不会多打请求），
 * 再把两个 Map 交给 `buildTitle`。从 `AuthenticatedApp` 里整段搬出来（2026-11-26），行为不变。
 */
export function useDocumentTitle({
  selection,
  contentType,
  selectedEntryId,
}: DocumentTitleOptions): void {
  const { t } = useTranslation();
  const { data: feeds = [] } = useFeeds();
  const { data: folders = [] } = useFolders();
  const { data: entry } = useEntry(selectedEntryId);

  const feedsMap = useMemo(() => {
    const map = new Map<string, Feed>();
    for (const feed of feeds) {
      map.set(feed.id, feed);
    }
    return map;
  }, [feeds]);

  const foldersMap = useMemo(() => {
    const map = new Map<string, Folder>();
    for (const folder of folders) {
      map.set(folder.id, folder);
    }
    return map;
  }, [folders]);

  const title = buildTitle({
    selection,
    contentType,
    entryTitle: entry?.title,
    feedsMap,
    foldersMap,
    t,
  });

  useTitle(title);
}
