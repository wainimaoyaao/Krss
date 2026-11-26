import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDocumentTitle } from "./useDocumentTitle";

/**
 * 2026-11-26：文档标题从 `AuthenticatedApp` 搬进 `useDocumentTitle`。
 * 守的是优先级（条目 > 订阅 > 文件夹 > 内容类型）与「名字查不到就退回 Krss」。
 */
const feeds = vi.hoisted(() => ({
  data: [
    { id: "f1", title: "少数派" },
    { id: "f2", title: "阮一峰" },
  ] as { id: string; title: string }[],
}));
const folders = vi.hoisted(() => ({
  data: [{ id: "d1", name: "技术" }] as { id: string; name: string }[],
}));
const entry = vi.hoisted(() => ({ data: { id: "e1", title: "一篇好文章" } as { id: string; title: string } | undefined }));
const applied = vi.hoisted(() => ({ titles: [] as string[] }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => `T:${key}` }),
}));

vi.mock("@/hooks/useFeeds", () => ({ useFeeds: () => ({ data: feeds.data }) }));
vi.mock("@/hooks/useFolders", () => ({ useFolders: () => ({ data: folders.data }) }));
vi.mock("@/hooks/useEntries", () => ({
  useEntry: (id: string | null) => ({ data: id ? entry.data : undefined }),
}));
vi.mock("@/hooks/useTitle", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useTitle")>("@/hooks/useTitle");
  return {
    buildTitle: actual.buildTitle,
    useTitle: (title: string) => {
      applied.titles.push(title);
    },
  };
});

function lastTitle(options: Parameters<typeof useDocumentTitle>[0]): string {
  applied.titles = [];
  renderHook(() => useDocumentTitle(options));
  return applied.titles[applied.titles.length - 1] ?? "";
}

beforeEach(() => {
  applied.titles = [];
});

describe("标题优先级", () => {
  it("选中条目时用条目标题", () => {
    expect(
      lastTitle({
        selection: { type: "feed", feedId: "f1" },
        contentType: "article",
        selectedEntryId: "e1",
      }),
    ).toBe("一篇好文章 | Krss");
  });

  it("没选中条目时用订阅名", () => {
    expect(
      lastTitle({
        selection: { type: "feed", feedId: "f2" },
        contentType: "article",
        selectedEntryId: null,
      }),
    ).toBe("阮一峰 | Krss");
  });

  it("文件夹用文件夹名", () => {
    expect(
      lastTitle({
        selection: { type: "folder", folderId: "d1" },
        contentType: "article",
        selectedEntryId: null,
      }),
    ).toBe("技术 | Krss");
  });

  it("全部视图用内容类型（走 i18n）", () => {
    expect(
      lastTitle({
        selection: { type: "all" },
        contentType: "picture",
        selectedEntryId: null,
      }),
    ).toBe("T:content_type.picture | Krss");
  });

  it("名字查不到时退回 Krss", () => {
    expect(
      lastTitle({
        selection: { type: "feed", feedId: "missing" },
        contentType: "article",
        selectedEntryId: null,
      }),
    ).toBe("Krss");
  });
});
