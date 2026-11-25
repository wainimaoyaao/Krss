import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import i18n from "@/i18n";
import {
  EntryContentFallback,
  EntryContentPlaceholder,
  LoadingScreen,
} from "./AppStates";

/**
 * F5 拆分前这三块内联在 App.tsx 里、没有任何用例；挪出来后至少钉住
 * 「加载文案走 i18n」「空态文案由调用方决定」这两条，避免以后被悄悄改回硬编码。
 */
describe("App 壳的整屏状态", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh");
  });

  it("加载态用 i18n 文案，不退化成 key", () => {
    render(<LoadingScreen />);
    const text = document.body.textContent ?? "";
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).not.toContain("entry.loading");
  });

  it("空态照调用方给的文案渲染", () => {
    render(<EntryContentPlaceholder message="选一条来看看" />);
    expect(screen.getByText("选一条来看看")).toBeTruthy();
  });

  it("正文骨架屏渲得出来（纯展示，不读 store）", () => {
    const { container } = render(<EntryContentFallback />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(1);
  });
});
