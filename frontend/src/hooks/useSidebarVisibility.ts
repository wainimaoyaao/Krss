import { useEffect, useMemo } from "react";
import {
  hasSidebarVisibilitySetting,
  setUISetting,
  useUISettingActions,
  useUISettingKey,
} from "@/hooks/useUISettings";

export interface SidebarVisibilityOptions {
  isMobile: boolean;
  isTablet: boolean;
}

export interface SidebarVisibility {
  /** 用户偏好里的侧栏开关（平板用） */
  sidebarVisible: boolean;
  /** 手机端侧栏里是否显示内容类型切换器 */
  mobileSidebarShowViews: boolean;
  /** 三栏布局到底要不要真的渲染侧栏 */
  showSidebar: boolean;
  toggleSidebarVisible: () => void;
}

/**
 * 侧栏可见性：桌面（≥1366）恒显示、平板（768–1366）按用户偏好（首次进平板默认收起）、
 * 手机（<768）走 Sheet 不占位。首次进平板时把偏好落成 `false`，之后不再覆盖用户的选择。
 *
 * 从 `AuthenticatedApp` 里整段搬出来（2026-11-26），行为不变。
 */
export function useSidebarVisibility({
  isMobile,
  isTablet,
}: SidebarVisibilityOptions): SidebarVisibility {
  const sidebarVisible = useUISettingKey("sidebarVisible");
  const mobileSidebarShowViews = useUISettingKey("mobileSidebarShowViews");
  const { toggleSidebarVisible } = useUISettingActions();

  useEffect(() => {
    // 只在平板、且用户从没设置过时落一次默认值
    if (isTablet && !hasSidebarVisibilitySetting()) {
      setUISetting("sidebarVisible", false);
    }
  }, [isTablet]);

  const showSidebar = useMemo(() => {
    if (isMobile) return false; // 手机用 Sheet
    if (isTablet) return sidebarVisible; // 平板尊重用户偏好
    return true; // 桌面恒显示
  }, [isMobile, isTablet, sidebarVisible]);

  return {
    sidebarVisible,
    mobileSidebarShowViews,
    showSidebar,
    toggleSidebarVisible,
  };
}
