import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  SETTINGS_SAVED_EVENT,
  SETTINGS_SYNC_FAILED_EVENT,
} from "@/lib/settings-saved";
import { showToast } from "@/stores/toast-store";

/**
 * 设置写的两句提示，从 `AuthenticatedApp` 里搬出来（2026-11-26）：
 *
 * - 12-7 即时型设置项（开关 / 数量 / 下拉）改一下就落库，这里给一句「已保存」；
 *   防抖 700ms —— 连续拨数字或连点开关只在停手后提示一次，避免刷屏。
 * - 21 批：写服务端失败必须看得见 —— 本地那份已经改好了、界面也生效了，只有上传失败；
 *   不说的话用户会以为都保存好了，换台设备才发现少了一半。
 */
export function useSettingsToast(): void {
  const { t } = useTranslation();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onSaved = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => showToast(t("settings.saved_toast")), 700);
    };
    window.addEventListener(SETTINGS_SAVED_EVENT, onSaved);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(SETTINGS_SAVED_EVENT, onSaved);
    };
  }, [t]);

  useEffect(() => {
    const onSyncFailed = (event: Event) => {
      const reason =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail
          : "";
      showToast(
        t("settings.sync_failed_toast", {
          reason: reason || t("settings.sync_failed_unknown"),
        }),
      );
    };
    window.addEventListener(SETTINGS_SYNC_FAILED_EVENT, onSyncFailed);
    return () => {
      window.removeEventListener(SETTINGS_SYNC_FAILED_EVENT, onSyncFailed);
    };
  }, [t]);
}
