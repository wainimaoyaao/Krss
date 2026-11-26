import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SETTINGS_SAVED_EVENT,
  SETTINGS_SYNC_FAILED_EVENT,
} from "@/lib/settings-saved";
import { useSettingsToast } from "./useSettingsToast";

/**
 * 2026-11-26：两句设置提示从 `AuthenticatedApp` 搬进 `useSettingsToast`。
 * 「已保存」必须防抖 700ms（连点开关只提示一次），「同步失败」必须带上原因。
 */
const toast = vi.hoisted(() => vi.fn());

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { reason?: string }) =>
      options?.reason ? `${key}|${options.reason}` : key,
  }),
}));

vi.mock("@/stores/toast-store", () => ({ showToast: toast }));

beforeEach(() => {
  vi.useFakeTimers();
  toast.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("已保存提示", () => {
  it("连发三次只提示一次", () => {
    renderHook(() => useSettingsToast());
    for (let i = 0; i < 3; i += 1) {
      window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
    }
    expect(toast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("settings.saved_toast");
  });

  it("卸载时把待发的提示清掉", () => {
    const { unmount } = renderHook(() => useSettingsToast());
    window.dispatchEvent(new Event(SETTINGS_SAVED_EVENT));
    unmount();
    vi.advanceTimersByTime(700);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe("同步失败提示", () => {
  it("带原因时把原因塞进文案", () => {
    renderHook(() => useSettingsToast());
    window.dispatchEvent(
      new CustomEvent(SETTINGS_SYNC_FAILED_EVENT, { detail: "network down" }),
    );
    expect(toast).toHaveBeenCalledWith(
      "settings.sync_failed_toast|network down",
    );
  });

  it("没有原因时用兜底文案", () => {
    renderHook(() => useSettingsToast());
    window.dispatchEvent(new Event(SETTINGS_SYNC_FAILED_EVENT));
    expect(toast).toHaveBeenCalledWith(
      "settings.sync_failed_toast|settings.sync_failed_unknown",
    );
  });

  it("立即提示，不防抖", () => {
    renderHook(() => useSettingsToast());
    window.dispatchEvent(
      new CustomEvent(SETTINGS_SYNC_FAILED_EVENT, { detail: "boom" }),
    );
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
