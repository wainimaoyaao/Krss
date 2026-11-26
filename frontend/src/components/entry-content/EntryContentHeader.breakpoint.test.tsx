import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EntryContentHeader } from "./EntryContentHeader";
import type { Entry } from "@/types/api";

/**
 * 跨断点复用同一挂载点（桌面 ↔ 移动）时必须保持 hook 顺序一致。
 *
 * 曾经的 bug：`useUISettingKey("entryToolbar")` 与 `useMemo(normalizeEntryToolbar)`
 * 落在 `if (isMobile) return ...` 之后 —— 移动端不执行，桌面端执行，
 * 窗口跨过 768px 时 React 会抛 "Rendered more hooks than during the previous render"。
 * 这里就是那条护栏：两个方向各切一次，能渲染即通过。
 */
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useScrollToTop", () => ({
  dispatchScrollToTop: vi.fn(),
}));

vi.mock("@/plugins/useContributions", () => ({
  useContributions: () => [],
}));

vi.mock("@/plugins/useInvokePluginAction", () => ({
  useInvokePluginAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

const entry: Entry = {
  id: "entry-1",
  feedId: "feed-1",
  title: "Entry title",
  content: "<p>body</p>",
  read: false,
  starred: false,
  muted: false,
  publishedAt: "2024-01-01T09:00:00.000Z",
  createdAt: "2024-01-01T09:00:00.000Z",
  updatedAt: "2024-01-01T09:00:00.000Z",
};

const baseProps = {
  entry,
  isAtTop: true,
  isReadableActive: false,
  isLoading: false,
  error: null,
  onToggleReadable: vi.fn(),
  onToggleStarred: vi.fn(),
};

function renderHeader(isMobile: boolean) {
  return (
    <TooltipProvider>
      <EntryContentHeader {...baseProps} isMobile={isMobile} />
    </TooltipProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("EntryContentHeader 跨断点", () => {
  it("移动端 → 桌面端切换不破坏 hook 顺序", () => {
    const { rerender } = render(renderHeader(true));
    expect(() => rerender(renderHeader(false))).not.toThrow();
  });

  it("桌面端 → 移动端切换不破坏 hook 顺序", () => {
    const { rerender } = render(renderHeader(false));
    expect(() => rerender(renderHeader(true))).not.toThrow();
  });

  it("反复切三次仍然能渲染", () => {
    const { rerender } = render(renderHeader(false));
    for (const mobile of [true, false, true]) {
      expect(() => rerender(renderHeader(mobile))).not.toThrow();
    }
  });
});
