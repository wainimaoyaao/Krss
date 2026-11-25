import { UpdateNotice } from "@/components/update-notice";
import { Toaster } from "@/components/ui/toaster";
import { RefreshReportDialog } from "@/components/refresh/RefreshReportDialog";
import { FilterEditorDialog } from "@/components/automation/FilterEditorDialog";
import { PluginActionDialog } from "@/plugins/PluginSlot";
import { SettingsModal, ProfileModal } from "@/components/settings";
import { EditFeedDialog } from "@/components/settings/tabs/EditFeedDialog";
import { useEditingFeedStore } from "@/stores/editing-feed-store";
import {
  useProfileModalStore,
  useSettingsModalStore,
} from "@/stores/settings-modal-store";

/**
 * 全局弹窗层。必须挂在 `<Router>` 里面、与侧栏的移动端 Sheet 平级 ——
 * 移动端 Sidebar 装在 Sheet 里，Sheet 一关侧栏就卸载，挂在侧栏里的弹窗会跟着消失
 * （2026-09-20 移动端设置滑不动就是这条根因）。
 *
 * F5 拆分：原先这些散写在 App.tsx 的 return 里，开关与依赖跟着 App 一起变；收成一个
 * 组件后，「谁在顶层、谁必须平级」这条约束只有一处需要维护。
 */
export function AppOverlays() {
  const isSettingsOpen = useSettingsModalStore((state) => state.open);
  const setSettingsOpen = useSettingsModalStore((state) => state.setOpen);
  const isProfileOpen = useProfileModalStore((state) => state.open);
  const setProfileOpen = useProfileModalStore((state) => state.setOpen);
  const editingFeed = useEditingFeedStore((state) => state.feed);
  const closeEditingFeed = useEditingFeedStore((state) => state.close);

  return (
    <>
      <UpdateNotice />
      {/* 规则编辑器：设置页/订阅右键/条目右键都靠 filter-editor-store 唤起它 */}
      <FilterEditorDialog />
      {/* 插件动作的弹窗（参数表单 / 确认）：同样必须在顶层 ——
          右键菜单一点就卸载，挂在菜单项里的弹窗会跟着消失 */}
      <PluginActionDialog />
      <SettingsModal open={isSettingsOpen} onOpenChange={setSettingsOpen} />
      <ProfileModal open={isProfileOpen} onOpenChange={setProfileOpen} />
      <EditFeedDialog
        feed={editingFeed}
        open={editingFeed !== null}
        onOpenChange={(open) => {
          if (!open) closeEditingFeed();
        }}
      />
      <Toaster />
      <RefreshReportDialog />
    </>
  );
}
