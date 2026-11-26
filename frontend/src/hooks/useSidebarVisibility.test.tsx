import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSidebarVisibility } from "./useSidebarVisibility";

/**
 * 2026-11-26：侧栏可见性从 `AuthenticatedApp` 搬进 hook。
 * 三条断点口径是原来的硬约束：
 *   桌面（≥1366）恒显示；平板（768–1366）跟用户偏好、首次进平板落一次 `false`；
 *   手机（<768）不占位（走 Sheet）。
 */
const settings = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
  hasSetting: false,
  setUISetting: vi.fn(),
  toggleSidebarVisible: vi.fn(),
}));

vi.mock("@/hooks/useUISettings", () => ({
  useUISettingKey: (key: string) => settings.values[key],
  useUISettingActions: () => ({ toggleSidebarVisible: settings.toggleSidebarVisible }),
  hasSidebarVisibilitySetting: () => settings.hasSetting,
  setUISetting: settings.setUISetting,
}));

function run(options: { isMobile?: boolean; isTablet?: boolean } = {}) {
  const { result } = renderHook(() =>
    useSidebarVisibility({ isMobile: false, isTablet: false, ...options }),
  );
  return result.current;
}

beforeEach(() => {
  settings.values = { sidebarVisible: true, mobileSidebarShowViews: false };
  settings.hasSetting = false;
  settings.setUISetting.mockClear();
  settings.toggleSidebarVisible.mockClear();
});

describe("三档断点下的侧栏", () => {
  it("桌面恒显示，不看偏好", () => {
    settings.values.sidebarVisible = false;
    expect(run({}).showSidebar).toBe(true);
  });

  it("平板跟用户偏好", () => {
    expect(run({ isTablet: true }).showSidebar).toBe(true);
    settings.values.sidebarVisible = false;
    expect(run({ isTablet: true }).showSidebar).toBe(false);
  });

  it("手机不占位（走 Sheet）", () => {
    expect(run({ isMobile: true }).showSidebar).toBe(false);
  });
});

describe("首次进平板落默认值", () => {
  it("平板 + 从没设置过 → 写一次 false", () => {
    run({ isTablet: true });
    expect(settings.setUISetting).toHaveBeenCalledWith("sidebarVisible", false);
  });

  it("已经设置过就不覆盖用户的选择", () => {
    settings.hasSetting = true;
    run({ isTablet: true });
    expect(settings.setUISetting).not.toHaveBeenCalled();
  });

  it("桌面与手机都不落默认值", () => {
    run({});
    run({ isMobile: true });
    expect(settings.setUISetting).not.toHaveBeenCalled();
  });
});

describe("透传", () => {
  it("侧栏开关、手机内容类型开关与 toggle 原样给出", () => {
    settings.values = { sidebarVisible: false, mobileSidebarShowViews: true };
    const out = run({ isTablet: true });

    expect(out.sidebarVisible).toBe(false);
    expect(out.mobileSidebarShowViews).toBe(true);
    out.toggleSidebarVisible();
    expect(settings.toggleSidebarVisible).toHaveBeenCalledTimes(1);
  });
});
