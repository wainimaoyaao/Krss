import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { BackToTopButton } from "./entry-content/BackToTopButton";
import { SocialMediaGallery } from "./entry-list/SocialMediaGallery";
import { ArticleVideo } from "./ui/article-video";

vi.mock("@/lib/proxy-image-recovery", () => ({
  isRecoverableProxyUrl: () => false,
  renewProxyCookie: () => Promise.resolve(),
  withProxyCacheBust: (url: string) => url,
}));

vi.mock("@/stores/image-dimensions-store", () => ({
  useImageDimensionsStore: Object.assign(
    (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        dimensions: {},
        failedImages: new Set<string>(),
        setDimension: vi.fn(),
        markFailed: vi.fn(),
        loadFromDB: vi.fn(),
      }),
    { getState: vi.fn() },
  ),
}));

vi.mock("@/lib/use-authed-image", () => ({
  useAuthedImageUrl: (url: string) => url,
}));

/**
 * F2：可访问名称不能是写死的文本。这里用真 i18n 资源（不是 mock 的 t）在中英两种语言下
 * 各渲一遍，确保读屏拿到的是当前语言的那一句。
 */
describe("可访问名称跟着语言走", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh");
  });

  afterEach(() => {
    cleanup();
  });

  it("中文：回到顶部 / 查看大图 / 播放视频", async () => {
    await i18n.changeLanguage("zh");
    const scrollNode = document.createElement("div");
    render(<BackToTopButton scrollNode={scrollNode} />);
    render(<SocialMediaGallery media={[{ src: "https://example.com/a.jpg", width: 800, height: 600 }]} />);
    render(<ArticleVideo src="https://example.com/v.mp4" />);

    expect(screen.getByRole("button", { name: "回到顶部" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看大图" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "播放视频" })).toBeTruthy();
  });

  it("英文：Back to top / View image / Play video", async () => {
    await i18n.changeLanguage("en");
    const scrollNode = document.createElement("div");
    render(<BackToTopButton scrollNode={scrollNode} />);
    render(<SocialMediaGallery media={[{ src: "https://example.com/a.jpg", width: 800, height: 600 }]} />);
    render(<ArticleVideo src="https://example.com/v.mp4" />);

    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View image" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play video" })).toBeTruthy();
  });

  it("侧栏订阅列表的分组名也走 i18n", async () => {
    expect(i18n.t("sidebar.feeds", { lng: "zh" })).toBe("订阅");
    expect(i18n.t("sidebar.feeds", { lng: "en" })).toBe("Feeds");
  });
});
