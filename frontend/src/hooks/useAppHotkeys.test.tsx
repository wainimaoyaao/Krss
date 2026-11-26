import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppHotkeys } from "./useAppHotkeys";

/**
 * 2026-11-26：`?` / `r` 两个全局快捷键与 `r` 的手动刷新副作用从 `AuthenticatedApp`
 * 搬进 `useAppHotkeys`。守的是：
 *   - `r` 真的打 `/feeds/refresh`，成功后同步列表头并失效未读数；
 *   - `?` 交给快捷键帮助 store；
 *   - `⌘K` / `f` 打开搜索弹窗；
 *   - 快捷键帮助自己打开时，其它快捷键全部让位（`enabled: false`）。
 */
const hotkeys = vi.hoisted(() => ({ options: null as null | Record<string, unknown> }));
const refreshAllFeeds = vi.hoisted(() => vi.fn(async () => undefined));
const requestEntriesHeadSync = vi.hoisted(() => vi.fn());
const shortcuts = vi.hoisted(() => ({
  open: false,
  toggle: vi.fn(),
  set: vi.fn(),
}));

vi.mock("@/hooks/useGlobalHotkeys", () => ({
  useGlobalHotkeys: (options: Record<string, unknown>) => {
    hotkeys.options = options;
  },
}));

vi.mock("@/api", () => ({ refreshAllFeeds }));

vi.mock("@/lib/entries-head-sync", () => ({ requestEntriesHeadSync }));

vi.mock("@/stores/shortcuts-store", () => ({
  shortcutsHelp: {
    toggle: shortcuts.toggle,
    set: shortcuts.set,
  },
  useShortcutsHelpOpen: () => shortcuts.open,
}));

function run() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  const { result } = renderHook(() => useAppHotkeys(), { wrapper });
  return { result, queryClient, invalidate };
}

beforeEach(() => {
  hotkeys.options = null;
  refreshAllFeeds.mockClear();
  requestEntriesHeadSync.mockClear();
  shortcuts.toggle.mockClear();
  shortcuts.open = false;
});

describe("开启条件", () => {
  it("平时启用", () => {
    run();
    expect(hotkeys.options?.enabled).toBe(true);
  });

  it("快捷键帮助打开时全部让位", () => {
    shortcuts.open = true;
    run();
    expect(hotkeys.options?.enabled).toBe(false);
  });
});

describe("r 刷新订阅", () => {
  it("打刷新接口，成功后同步列表头并失效未读数", async () => {
    const { result, queryClient, invalidate } = run();
    refreshAllFeeds.mockClear();

    await act(async () => {
      (hotkeys.options?.onRefresh as () => void)();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(refreshAllFeeds).toHaveBeenCalledTimes(1);
    expect(requestEntriesHeadSync).toHaveBeenCalledWith(queryClient);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["unreadCounts"] });
    expect(result.current.isSearchOpen).toBe(false);
  });
});

describe("? 与搜索", () => {
  it("? 交给快捷键帮助 store", () => {
    run();
    (hotkeys.options?.onToggleHelp as () => void)();
    expect(shortcuts.toggle).toHaveBeenCalledTimes(1);
  });

  it("搜索快捷键把 isSearchOpen 打开，弹窗自己可关", () => {
    const { result } = run();
    act(() => {
      (hotkeys.options?.onSearch as () => void)();
    });
    expect(result.current.isSearchOpen).toBe(true);

    act(() => {
      result.current.setIsSearchOpen(false);
    });
    expect(result.current.isSearchOpen).toBe(false);
  });
});
