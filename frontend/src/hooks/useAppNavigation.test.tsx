import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentType } from "@/types/api";
import type { SelectionType } from "@/hooks/useSelection";
import type { PluginViewRoute } from "@/plugins/usePluginViewRoute";
import { useAppNavigation } from "./useAppNavigation";

/**
 * 2026-11-26：导航处理器从 `AuthenticatedApp` 整段搬进 `useAppNavigation`。
 * 这里守的是「搬完行为不变」的几条硬约束：
 *   - 桌面端点订阅 / 文件夹 / 全部时，先把目标列表位置清 0 再派发回顶（5b）；
 *   - 手机端不碰滚动位置（两段式点击自己管）；
 *   - 星标入口默认进「只当前视图」档（20-2）；
 *   - 手机底栏的入参原样传给 `applyMobileTabTap`（它才是两段式的判定处）。
 */
const scrollPositions = vi.hoisted(() => new Map<string, number>());
const dispatchScrollToTop = vi.hoisted(() => vi.fn());
const applyMobileTabTap = vi.hoisted(() => vi.fn());
const getMobileListScrollTop = vi.hoisted(() => vi.fn(() => 321));
const markAllAsRead = vi.hoisted(() => vi.fn());
const selectionToParams = vi.hoisted(() => vi.fn(() => ({ sentinel: "params" })));
const feedJump = vi.hoisted(() => ({
  handleJumpToFeed: vi.fn(),
  handleBackFromFeedJump: vi.fn(),
}));

vi.mock("@/components/entry-list/scroll-key", () => ({
  entryListScrollPositions: scrollPositions,
  selectionScrollKey: (selection: { type: string }, contentType?: string) =>
    `${selection.type}:${contentType ?? ""}`,
}));

vi.mock("@/components/mobile/mobile-tab-scroll", () => ({
  applyMobileTabTap,
  getMobileListScrollTop,
}));

vi.mock("@/hooks/useScrollToTop", () => ({ dispatchScrollToTop }));

vi.mock("@/hooks/useEntries", () => ({
  useMarkAllAsRead: () => ({ mutate: markAllAsRead }),
}));

vi.mock("@/hooks/useSelection", () => ({ selectionToParams }));

vi.mock("@/hooks/useFeedJumpBack", () => ({
  useFeedJumpBack: () => ({ ...feedJump, jumpBackHref: "/all?type=article" }),
}));

interface Options {
  selection?: SelectionType;
  contentType?: ContentType;
  isMobile?: boolean;
  hasPluginView?: boolean;
}

function setup({
  selection = { type: "feed", feedId: "7" },
  contentType = "article",
  isMobile = false,
  hasPluginView = false,
}: Options = {}) {
  const closeSidebar = vi.fn();
  const navigate = vi.fn();
  const setAddFeedContentType = vi.fn();
  const selectAll = vi.fn();
  const selectFeed = vi.fn();
  const selectFolder = vi.fn();
  const selectStarred = vi.fn();
  const selectFilter = vi.fn();
  const closePluginView = vi.fn();
  const pluginViewRoute = {
    resolution: { status: hasPluginView ? "ready" : "none" },
    closeView: closePluginView,
  } as unknown as PluginViewRoute;

  const { result } = renderHook(() =>
    useAppNavigation({
      selection,
      contentType,
      isMobile,
      fullLocation: "/feed/7?type=article",
      pluginViewRoute,
      closeSidebar,
      navigate,
      setAddFeedContentType,
      selectAll,
      selectFeed,
      selectFolder,
      selectStarred,
      selectFilter,
    }),
  );

  return {
    handlers: result.current,
    closeSidebar,
    navigate,
    setAddFeedContentType,
    selectAll,
    selectFeed,
    selectFolder,
    selectStarred,
    selectFilter,
    closePluginView,
  };
}

beforeEach(() => {
  scrollPositions.clear();
  dispatchScrollToTop.mockClear();
  applyMobileTabTap.mockClear();
  markAllAsRead.mockClear();
  selectionToParams.mockClear();
});

describe("桌面端点订阅 / 文件夹 / 全部：先清位置再回顶", () => {
  it("点订阅：目标列表位置清 0、派发回顶、关侧栏、选中订阅", () => {
    const ctx = setup();
    scrollPositions.set("feed:article", 480);

    ctx.handlers.handleSelectFeed("9");

    expect(scrollPositions.get("feed:article")).toBe(0);
    expect(dispatchScrollToTop).toHaveBeenCalledTimes(1);
    expect(ctx.closeSidebar).toHaveBeenCalledTimes(1);
    expect(ctx.selectFeed).toHaveBeenCalledWith("9", { replace: true });
  });

  it("点文件夹：位置清 0 且选中文件夹", () => {
    const ctx = setup({ selection: { type: "folder", folderId: "3" } });

    ctx.handlers.handleSelectFolder("5");

    expect(scrollPositions.get("folder:article")).toBe(0);
    expect(dispatchScrollToTop).toHaveBeenCalledTimes(1);
    expect(ctx.selectFolder).toHaveBeenCalledWith("5", { replace: true });
  });

  it("点「全部」：不传类型时用当前内容类型", () => {
    const ctx = setup({ contentType: "picture" });

    ctx.handlers.handleSelectAll();

    expect(scrollPositions.get("all:picture")).toBe(0);
    expect(ctx.selectAll).toHaveBeenCalledWith(undefined, { replace: true });
  });

  it("手机端不碰滚动位置，只关侧栏并选中", () => {
    const ctx = setup({ isMobile: true });

    ctx.handlers.handleSelectFeed("9");

    expect(scrollPositions.size).toBe(0);
    expect(dispatchScrollToTop).not.toHaveBeenCalled();
    expect(ctx.closeSidebar).toHaveBeenCalledTimes(1);
    expect(ctx.selectFeed).toHaveBeenCalledWith("9", { replace: true });
  });
});

describe("星标入口", () => {
  it("点星标：默认进「只当前视图」档（20-2）", () => {
    const ctx = setup({ selection: { type: "all" } });

    ctx.handlers.handleSelectStarred();

    expect(ctx.closeSidebar).toHaveBeenCalledTimes(1);
    expect(ctx.selectStarred).toHaveBeenCalledWith({ replace: true }, true);
  });

  it("列表头的图标只在星标视图里切换档位", () => {
    const 非星标 = setup({ selection: { type: "all" } });
    非星标.handlers.handleToggleStarredViewOnly();
    expect(非星标.selectStarred).not.toHaveBeenCalled();

    const 仅当前视图 = setup({ selection: { type: "starred", viewOnly: true } });
    仅当前视图.handlers.handleToggleStarredViewOnly();
    expect(仅当前视图.selectStarred).toHaveBeenCalledWith({ replace: true }, false);

    const 全部星标 = setup({ selection: { type: "starred", viewOnly: false } });
    全部星标.handlers.handleToggleStarredViewOnly();
    expect(全部星标.selectStarred).toHaveBeenCalledWith({ replace: true }, true);
  });
});

describe("加订阅与筛选", () => {
  it("点加订阅：记住内容类型、关侧栏、跳到 add-feed", () => {
    const ctx = setup();

    ctx.handlers.handleAddClick("picture");

    expect(ctx.setAddFeedContentType).toHaveBeenCalledWith("picture");
    expect(ctx.closeSidebar).toHaveBeenCalledTimes(1);
    expect(ctx.navigate).toHaveBeenCalledWith("/add-feed?type=picture", {
      replace: true,
    });
  });

  it("关掉加订阅页：回当前内容类型的「全部」", () => {
    const ctx = setup({ contentType: "social" });

    ctx.handlers.handleCloseAddFeed();

    expect(ctx.navigate).toHaveBeenCalledWith("/all?type=social", { replace: true });
  });

  it("切全部 / 未读 / 星标胶囊：关侧栏后交给 selectFilter", () => {
    const ctx = setup();

    ctx.handlers.handleFilterChange("unread");

    expect(ctx.closeSidebar).toHaveBeenCalledTimes(1);
    expect(ctx.selectFilter).toHaveBeenCalledWith("unread", { replace: true });
  });
});

describe("手机底栏两段式点击", () => {
  it("把当前状态原样交给 applyMobileTabTap", () => {
    const ctx = setup({
      selection: { type: "all" },
      contentType: "article",
      isMobile: true,
      hasPluginView: true,
    });

    ctx.handlers.handleMobileTabSelect("article");

    expect(applyMobileTabTap).toHaveBeenCalledTimes(1);
    const args = applyMobileTabTap.mock.calls[0]![0] as {
      type: string;
      isActiveTab: boolean;
      hasPluginView: boolean;
      selectionIsAll: boolean;
      scrollTop: number;
      closePluginView: () => void;
      selectAll: () => void;
    };
    expect(args.type).toBe("article");
    expect(args.isActiveTab).toBe(true);
    expect(args.hasPluginView).toBe(true);
    expect(args.selectionIsAll).toBe(true);
    expect(args.scrollTop).toBe(321);
    expect(args.closePluginView).toBe(ctx.closePluginView);

    args.selectAll();
    // handleSelectAll(type) 会再往下走 selectAll(type, { replace: true })
    expect(ctx.selectAll).toHaveBeenCalledWith("article", { replace: true });
  });
});

describe("全部标记已读", () => {
  it("按当前选中态与内容类型算参数", () => {
    const ctx = setup({ selection: { type: "feed", feedId: "7" }, contentType: "article" });

    ctx.handlers.handleMarkAllRead();

    expect(selectionToParams).toHaveBeenCalledWith(
      { type: "feed", feedId: "7" },
      "article",
    );
    expect(markAllAsRead).toHaveBeenCalledWith({ sentinel: "params" });
  });
});

describe("订阅跳转", () => {
  it("透传 useFeedJumpBack 的三个出口", () => {
    const ctx = setup();

    ctx.handlers.handleJumpToFeed("12");
    ctx.handlers.handleBackFromFeedJump();

    expect(feedJump.handleJumpToFeed).toHaveBeenCalledWith("12");
    expect(feedJump.handleBackFromFeedJump).toHaveBeenCalledTimes(1);
    expect(ctx.handlers.jumpBackHref).toBe("/all?type=article");
  });
});
