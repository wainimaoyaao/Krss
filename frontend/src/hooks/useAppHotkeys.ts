import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { refreshAllFeeds } from "@/api";
import { requestEntriesHeadSync } from "@/lib/entries-head-sync";
import { useGlobalHotkeys } from "@/hooks/useGlobalHotkeys";
import { shortcutsHelp, useShortcutsHelpOpen } from "@/stores/shortcuts-store";

export interface AppHotkeys {
  /** 搜索弹窗开关（`/` 或 `⌘K` 打开，弹窗自己也改它） */
  isSearchOpen: boolean;
  setIsSearchOpen: (open: boolean) => void;
  /** 快捷键帮助弹窗是否打开（弹窗自己的 store 驱动） */
  isShortcutsOpen: boolean;
}

/**
 * 全局快捷键 `?`（快捷键帮助）与 `r`（刷新全部订阅），外加 `r` 之后的手动刷新副作用。
 *
 * 刷新走普通抓取；强制刷新在中栏刷新图标的右键菜单里（那句确认是刻意留的）。
 * 从 `AuthenticatedApp` 里搬出来（2026-11-26），行为不变。
 */
export function useAppHotkeys(): AppHotkeys {
  const isShortcutsOpen = useShortcutsHelpOpen();
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const queryClient = useQueryClient();

  const refreshFeeds = useMutation({
    mutationFn: () => refreshAllFeeds(),
    onSuccess: () => {
      void requestEntriesHeadSync(queryClient);
      queryClient.invalidateQueries({ queryKey: ["unreadCounts"] });
    },
  });

  const handleToggleShortcuts = useCallback(() => shortcutsHelp.toggle(), []);
  const handleRefreshShortcut = useCallback(
    () => refreshFeeds.mutate(),
    [refreshFeeds],
  );

  useGlobalHotkeys({
    onToggleHelp: handleToggleShortcuts,
    onRefresh: handleRefreshShortcut,
    onSearch: () => setIsSearchOpen(true),
    enabled: !isShortcutsOpen,
  });

  return { isSearchOpen, setIsSearchOpen, isShortcutsOpen };
}
