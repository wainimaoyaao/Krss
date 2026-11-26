import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const applied = vi.hoisted(() => ({
  reduceMotion: vi.fn(),
  quoteStyle: vi.fn(),
  accentColor: vi.fn(),
  uiScale: vi.fn(),
  componentRadius: vi.fn(),
  fieldRadius: vi.fn(),
  iconRadius: vi.fn(),
}));

const settings = vi.hoisted(() => ({
  reduceMotion: true,
  quoteStyle: "bar" as const,
  accentColor: "#ff0055" as string | null,
  uiScale: 1.1,
  componentRadius: "lg" as const,
  fieldRadius: "sm" as const,
  iconRadius: "xs" as const,
}));

vi.mock("@/hooks/useUISettings", async () => {
  const actual =
    await vi.importActual<typeof import("@/hooks/useUISettings")>(
      "@/hooks/useUISettings",
    );
  return {
    ...actual,
    useUISettingKey: (key: keyof typeof settings) => settings[key],
    applyReduceMotionToDocument: applied.reduceMotion,
    applyQuoteStyleToDocument: applied.quoteStyle,
    applyAccentColorToDocument: applied.accentColor,
    applyUiScaleToDocument: applied.uiScale,
    applyComponentRadiusToDocument: applied.componentRadius,
    applyFieldRadiusToDocument: applied.fieldRadius,
    applyIconRadiusToDocument: applied.iconRadius,
  };
});

const { useDocumentAppearance } = await import("@/hooks/useDocumentAppearance");

function Probe() {
  useDocumentAppearance();
  return null;
}

describe("useDocumentAppearance", () => {
  beforeEach(() => {
    for (const fn of Object.values(applied)) fn.mockClear();
  });

  it("挂载时把七个外观旋钮都落到 document 上", () => {
    render(<Probe />);

    expect(applied.reduceMotion).toHaveBeenCalledWith(true);
    expect(applied.quoteStyle).toHaveBeenCalledWith("bar");
    expect(applied.accentColor).toHaveBeenCalledWith("#ff0055");
    expect(applied.uiScale).toHaveBeenCalledWith(1.1);
    expect(applied.componentRadius).toHaveBeenCalledWith("lg");
    expect(applied.fieldRadius).toHaveBeenCalledWith("sm");
    expect(applied.iconRadius).toHaveBeenCalledWith("xs");
  });

  it("主题色为 null 时按「跟随主题」传 null，而不是 undefined", () => {
    const previous = settings.accentColor;
    settings.accentColor = null;
    try {
      render(<Probe />);
      expect(applied.accentColor).toHaveBeenCalledWith(null);
    } finally {
      settings.accentColor = previous;
    }
  });

  it("减少动态效果开关按布尔值传，不把 undefined 传下去", () => {
    const previous = settings.reduceMotion;
    // 设置还没读到时的典型值
    (settings as { reduceMotion: unknown }).reduceMotion = undefined;
    try {
      render(<Probe />);
      expect(applied.reduceMotion).toHaveBeenCalledWith(false);
    } finally {
      settings.reduceMotion = previous;
    }
  });
});
