import { useCallback } from "react";
import type { ContentType } from "@/types/api";
import { selectionToParams, type SelectionType } from "@/hooks/useSelection";
import { useMarkAllAsRead } from "@/hooks/useEntries";
import type { PluginViewRoute } from "@/plugins/usePluginViewRoute";
import {
  selectionScrollKey,
  entryListScrollPositions,
} from "@/components/entry-list/scroll-key";
import {
  applyMobileTabTap,
  getMobileListScrollTop,
} from "@/components/mobile/mobile-tab-scroll";
import { dispatchScrollToTop } from "@/hooks/useScrollToTop";
import { useFeedJumpBack } from "@/hooks/useFeedJumpBack";

interface NavigateOptions {
  replace?: boolean;
}

export interface AppNavigationOptions {
  selection: SelectionType;
  contentType: ContentType;
  isMobile: boolean;
  fullLocation: string;
  pluginViewRoute: PluginViewRoute;
  closeSidebar: () => void;
  navigate: (to: string, options?: NavigateOptions) => void;
  setAddFeedContentType: (contentType: ContentType) => void;
  selectAll: (contentType?: ContentType, options?: NavigateOptions) => void;
  selectFeed: (feedId: string, options?: NavigateOptions) => void;
  selectFolder: (folderId: string, options?: NavigateOptions) => void;
  selectStarred: (options?: NavigateOptions, viewOnly?: boolean) => void;
  selectFilter: (filter: "all" | "unread" | "starred", options?: NavigateOptions) => void;
}

export interface AppNavigationHandlers {
  handleToggleStarredViewOnly: () => void;
  handleSelectFeed: (feedId: string) => void;
  handleSelectFolder: (folderId: string) => void;
  handleSelectStarred: () => void;
  handleAddClick: (contentType: ContentType) => void;
  handleCloseAddFeed: () => void;
  handleSelectAll: (type?: ContentType) => void;
  handleMarkAllRead: () => void;
  handleMobileTabSelect: (type: ContentType) => void;
  handleFilterChange: (filter: "all" | "unread" | "starred") => void;
  handleJumpToFeed: (feedId: string) => void;
  handleBackFromFeedJump: () => void;
  jumpBackHref: string | null;
}

/**
 * 侧栏 / 列表头 / 手机底栏共用的导航处理器：选中订阅、文件夹、星标、内容类型、
 * 手机 tab 两段式点击，以及从条目跳去订阅再返回。
 * 从 AuthenticatedApp 里整段搬出来（2026-11-26），行为不变。
 */
export function useAppNavigation({
  selection,
  contentType,
  isMobile,
  fullLocation,
  pluginViewRoute,
  closeSidebar,
  navigate,
  setAddFeedContentType,
  selectAll,
  selectFeed,
  selectFolder,
  selectStarred,
  selectFilter,
}: AppNavigationOptions): AppNavigationHandlers {
  const { mutate: markAllAsRead } = useMarkAllAsRead();

  /**
   * 12-6：星标视图下切换「只查看当前视图」（只看当前内容类型的星标）。
   * 侧栏那一档已按 20-2 收敛掉，现在只剩中栏列表头那个图标按钮走这里。
   */
  const handleToggleStarredViewOnly = useCallback(() => {
    if (selection.type !== "starred") return;
    selectStarred({ replace: true }, !selection.viewOnly);
  }, [selectStarred, selection]);

  // Mobile-aware selection handlers (all hooks must be before any conditional returns)
  // Use replace to avoid creating history entries for sidebar navigation

  /**
   * 5b（用户 2026-11-23）：Web 端点第一栏的**订阅 / 文件夹 / 视图入口**（含内容类型切换）时，
   * 列表要回到顶部。EntryList 的滚动还原会按 `selection+contentType` 恢复旧位置，
   * 所以先把目标列表位置清 0，再派发一次回顶，双保险。手机端走两段式（handleMobileTabSelect），
   * 这里只在非移动端生效，不动手机行为。
   */
  const jumpToTopOnWeb = useCallback(
    (key: string) => {
      if (isMobile) return;
      entryListScrollPositions.set(key, 0);
      dispatchScrollToTop();
    },
    [isMobile],
  );

  const handleSelectFeed = useCallback(
    (feedId: string) => {
      jumpToTopOnWeb(selectionScrollKey({ type: "feed", feedId }, contentType));
      closeSidebar();
      selectFeed(feedId, { replace: true });
    },
    [selectFeed, closeSidebar, jumpToTopOnWeb, contentType],
  );

  const { handleJumpToFeed, handleBackFromFeedJump, jumpBackHref } =
    useFeedJumpBack({ selection, fullLocation, closeSidebar, selectFeed, navigate });

  const handleSelectFolder = useCallback(
    (folderId: string) => {
      jumpToTopOnWeb(
        selectionScrollKey({ type: "folder", folderId }, contentType),
      );
      closeSidebar();
      selectFolder(folderId, { replace: true });
    },
    [selectFolder, closeSidebar, jumpToTopOnWeb, contentType],
  );

  /**
   * 20-2：星标入口收敛后只剩这一个入口（侧栏那一行）——**默认进「只当前视图」那一档**
   * （用户 2026-09-18：「默认选中」）。要看全部星标就在第二栏列表头把那个图标按钮关掉。
   */
  const handleSelectStarred = useCallback(() => {
    closeSidebar();
    selectStarred({ replace: true }, true);
  }, [selectStarred, closeSidebar]);

  const handleAddClick = useCallback(
    (ct: ContentType) => {
      setAddFeedContentType(ct);
      closeSidebar();
      navigate(`/add-feed?type=${ct}`, { replace: true });
    },
    // setAddFeedContentType 来自 useState，引用稳定
    [navigate, closeSidebar, setAddFeedContentType],
  );

  const handleCloseAddFeed = useCallback(() => {
    navigate(`/all?type=${contentType}`, { replace: true });
  }, [navigate, contentType]);

  const handleMarkAllRead = useCallback(() => {
    markAllAsRead(selectionToParams(selection, contentType));
  }, [markAllAsRead, selection, contentType]);

  const handleSelectAll = useCallback(
    (type?: ContentType) => {
      jumpToTopOnWeb(selectionScrollKey({ type: "all" }, type ?? contentType));
      closeSidebar();
      selectAll(type, { replace: true });
    },
    [selectAll, closeSidebar, jumpToTopOnWeb, contentType],
  );

  const handleMobileTabSelect = useCallback(
    (type: ContentType) => {
      // 用户 2026-11-22：第一次点当前 tab 回顶部，第二次才切到该类的「全部」。
      // 插件视图是路由上的一层覆盖；走「切全部」分支前先退出，否则 ?view= 会把新列表挡住。
      applyMobileTabTap({
        type,
        isActiveTab: type === contentType,
        hasPluginView: pluginViewRoute.resolution.status !== "none",
        selectionIsAll: selection.type === "all",
        scrollTop: getMobileListScrollTop(),
        scrollToTop: dispatchScrollToTop,
        closePluginView: pluginViewRoute.closeView,
        selectAll: () => handleSelectAll(type),
      });
    },
    [contentType, pluginViewRoute, selection.type, handleSelectAll],
  );

  const handleFilterChange = useCallback(
    (filter: "all" | "unread" | "starred") => {
      closeSidebar();
      selectFilter(filter, { replace: true });
    },
    [selectFilter, closeSidebar],
  );

  return {
    handleToggleStarredViewOnly,
    handleSelectFeed,
    handleSelectFolder,
    handleSelectStarred,
    handleAddClick,
    handleCloseAddFeed,
    handleSelectAll,
    handleMarkAllRead,
    handleMobileTabSelect,
    handleFilterChange,
    handleJumpToFeed,
    handleBackFromFeedJump,
    jumpBackHref,
  };
}
