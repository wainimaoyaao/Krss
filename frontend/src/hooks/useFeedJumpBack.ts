import { useCallback, useEffect } from "react";
import {
  isSameSelection,
  useFeedJumpBackStore,
} from "@/stores/feed-jump-back-store";
import type { useSelection } from "@/hooks/useSelection";
import type { useLocation } from "wouter";

type FeedJumpOptions = Pick<ReturnType<typeof useSelection>, "selection" | "selectFeed"> & {
  fullLocation: string;
  closeSidebar: () => void;
  navigate: ReturnType<typeof useLocation>[1];
};

export function useFeedJumpBack({ selection, fullLocation, closeSidebar, selectFeed, navigate }: FeedJumpOptions) {
  /**
   * 52-4（用户第 4 条）：点条目的**订阅源名称 / 图标** → 第一栏选中该订阅。
   *
   * 与侧栏点击走同一个 `selectFeed`（所以高亮、列表、滚动位置都是那一套，不另开机制）。
   * 差别只在：跳转前把「此刻的完整地址」记下来，列表头据此出返回按钮。
   * 已经在同一个订阅上就不记（点了等于没跳，返回按钮会指向一个和现在一样的选中态）。
   */
  const handleJumpToFeed = useCallback(
    (feedId: string) => {
      if (!isSameSelection(selection, { type: "feed", feedId })) {
        useFeedJumpBackStore.getState().remember(fullLocation, feedId);
      }
      closeSidebar();
      selectFeed(feedId, { replace: true });
    },
    [selection, fullLocation, closeSidebar, selectFeed],
  );

  /** 返回 = 原样走回跳转前那个地址（selection 与当时打开的条目一起还原） */
  const handleBackFromFeedJump = useCallback(() => {
    const href = useFeedJumpBackStore.getState().previousHref;
    useFeedJumpBackStore.getState().clear();
    if (!href) return;
    navigate(href, { replace: true });
  }, [navigate]);

  const jumpBackHref = useFeedJumpBackStore((state) => state.previousHref);
  const jumpBackFromFeedId = useFeedJumpBackStore((state) => state.fromFeedId);

  // 离开「那一次跳转落到的订阅」（改点侧栏、点了返回、跳到别的订阅）就把返回收掉，别残留
  useEffect(() => {
    if (selection.type !== "feed" || selection.feedId !== jumpBackFromFeedId) {
      useFeedJumpBackStore.getState().clear();
    }
  }, [selection, jumpBackFromFeedId]);

  return { handleJumpToFeed, handleBackFromFeedJump, jumpBackHref };
}
