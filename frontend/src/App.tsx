import {
  Suspense,
  lazy,
  useState,
  useEffect,
} from "react";
import { Router, useLocation, useSearch, Redirect } from "wouter";
import { useTranslation } from "react-i18next";
import {
  SETTINGS_MOBILE_BREAKPOINT,
  initSettingsSync,
} from "@/lib/settings-sync";
import { ThreeColumnLayout } from "@/components/layout/three-column-layout";
import { Sheet } from "@/components/ui/sheet";
import { MotionConfig } from "framer-motion";
import { EntryContentTransition } from "@/components/entry-content/EntryContentTransition";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/sidebar";
import { AddFeedPage } from "@/components/add-feed";
import { EntryList } from "@/components/entry-list";
import { PictureMasonry, Lightbox } from "@/components/picture-masonry";
import { MobileTabBar } from "@/components/mobile/MobileTabBar";
import { MenuIcon, SearchIcon } from "@/components/ui/icons";
import { ScrollToTopZone } from "@/components/layout/ScrollToTopZone";
import { ImagePreview } from "@/components/ui/image-preview";
import { LoginPage, RegisterPage, NetworkErrorPage } from "@/components/auth";
import {
  EntryContentFallback,
  EntryContentPlaceholder,
  LoadingScreen,
} from "@/components/app-shell/AppStates";
import { AppOverlays } from "@/components/app-shell/AppOverlays";
import { useRefreshReportWatcher } from "@/hooks/useRefreshReportWatcher";
import { PluginViewOutlet } from "@/plugins/PluginViewPane";
import { usePluginViewRoute } from "@/plugins/usePluginViewRoute";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useDocumentAppearance } from "@/hooks/useDocumentAppearance";
import { ShortcutsHelpDialog } from "@/components/shortcuts/ShortcutsHelpDialog";
import { SearchModal } from "@/components/search/SearchModal";
import { VideoPreview } from "@/components/ui/video-preview";
import { useAppHotkeys } from "@/hooks/useAppHotkeys";
import { useSidebarVisibility } from "@/hooks/useSidebarVisibility";
import { shortcutsHelp } from "@/stores/shortcuts-store";
import { useSelection } from "@/hooks/useSelection";
import { useMobileLayout } from "@/hooks/useMobileLayout";
import { useMobileDocumentScrollMode } from "@/hooks/useMobileDocumentScrollMode";
import { useAuth } from "@/hooks/useAuth";
import { useAppearanceSettings } from "@/hooks/useAppearanceSettings";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSettingsToast } from "@/hooks/useSettingsToast";
import { useVisibleContentTypes } from "@/hooks/useVisibleContentTypes";
import {
  useUISettingKey,
  refreshDeviceScopedSettings,
} from "@/hooks/useUISettings";
import { useRefreshStatus } from "@/hooks/useRefreshStatus";
import { isAddFeedPath } from "@/lib/router";
import { initProxyImageRecovery } from "@/lib/proxy-image-recovery";
import { cn } from "@/lib/utils";
import type { ContentType } from "@/types/api";

const LazyEntryContent = lazy(async () => {
  const module = await import("@/components/entry-content");
  return { default: module.EntryContent };
});

function AuthenticatedApp() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  /**
   * 52-4：wouter 的 `location` 只是 pathname（`?unread&type` 不在里面）——
   * 返回键要记的是「跳转前那一刻的完整地址」，所以这里把 search 拼上。
   */
  const fullLocation = search ? `${location}?${search}` : location;
  const {
    isMobile,
    isTablet,
    mobileView,
    sidebarOpen,
    setSidebarOpen,
    showList,
    openSidebar,
    closeSidebar,
  } = useMobileLayout();

  /**
   * 21 批（2026-09-18）：登录后把「界面设置」与服务端对齐一次。
   *   服务端一条没存过（首次迁移）或本地有没推上去的改动 → 以本地为准推上去；
   *   否则**服务端为准**覆盖本地 —— 这就是「换台设备打开是同一套设置」。
   * 放在这个组件里是因为它只在已登录时渲染，未登录时不会发这个请求。
   */
  useEffect(() => {
    void initSettingsSync();
  }, []);

  /**
   * 21 批：尺寸类（列宽 / 整体缩放 / 侧栏显隐）按设备分套存，
   * 窗口跨过 768px 断点就换到另一套；matchMedia 的 change 只在跨断点时触发，比监听 resize 省事。
   */
  useEffect(() => {
    const media = window.matchMedia(
      `(min-width: ${SETTINGS_MOBILE_BREAKPOINT}px)`,
    );
    const onChange = () => refreshDeviceScopedSettings();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const {
    selection,
    selectAll,
    selectFeed,
    selectFolder,
    selectStarred,
    selectFilter,
    selectedEntryId,
    selectEntry,
    unreadOnly,
    toggleUnreadOnly,
    contentType,
  } = useSelection();

  /**
   * 56-28：插件视图路由（`?view=插件id:视图id`）。
   * 放在这里而不是靠后的布局分支里 —— 它是钩子，必须在所有 early return 之前。
   */
  const pluginViewRoute = usePluginViewRoute();

  const [addFeedContentType, setAddFeedContentType] =
    useState<ContentType>("article");

  // Poll refresh status and auto-invalidate entries when scheduled refresh completes
  useRefreshStatus();

  const { isSearchOpen, setIsSearchOpen, isShortcutsOpen } = useAppHotkeys();
  const { sidebarVisible, mobileSidebarShowViews, showSidebar, toggleSidebarVisible } =
    useSidebarVisibility({ isMobile, isTablet });

  const { t } = useTranslation();
  // 外观设置：视图清单、加载门（未加载完不渲染，避免三视图闪烁）与侧栏视图切换器都要它
  const { data: appearanceSettings, isLoading: isAppearanceLoading } =
    useAppearanceSettings();

  // 文档标题：<条目> / <订阅> / <文件夹> / <内容类型> | Krss
  useDocumentTitle({ selection, contentType, selectedEntryId });

  const {
    handleToggleStarredViewOnly,
    handleSelectFeed,
    handleSelectFolder,
    handleSelectStarred,
    handleAddClick,
    handleCloseAddFeed,
    handleSelectAll,
    handleMarkAllRead,
    handleMobileTabSelect,
    handleFilterChange,
    handleJumpToFeed,
    handleBackFromFeedJump,
    jumpBackHref,
  } = useAppNavigation({
    selection,
    contentType,
    isMobile,
    fullLocation,
    pluginViewRoute,
    closeSidebar,
    navigate,
    setAddFeedContentType,
    selectAll,
    selectFeed,
    selectFolder,
    selectStarred,
    selectFilter,
  });

  // 刷新结果弹框：盯住「刷新中 → 刷新完」的跳变（用户 11-8）
  useRefreshReportWatcher();

  // 24-4：代理图 401 全局兜底（续期 cookie 后重载），挂一次
  useEffect(() => {
    initProxyImageRecovery();
  }, []);

  // 外观类设置落到 <html>：减少动态效果 / 引文样式 / 主题色 / 界面字号 / 圆角三个旋钮
  useDocumentAppearance();

  // 设置写的两句提示：即时型设置「已保存」（防抖 700ms）与「同步失败」
  useSettingsToast();

  const visibleContentTypes = useVisibleContentTypes({
    appearanceSettings,
    contentType,
    selectAll,
  });

  const usesMobileDocumentScroll = isMobile && !isAddFeedPath(location);
  useMobileDocumentScrollMode({
    enabled: usesMobileDocumentScroll,
    // Changing root overflow destabilizes viewport-pinned UI in iOS WebKit.
    // Only the full-screen detail view needs a document lock.
    locked: usesMobileDocumentScroll && mobileView === "detail",
  });

  // 28-3：文章视图的「悬停大图」档 —— 未选中条目时整块收起第三栏（用户：
  // 「默认是不显示第三栏的，我们点击条目之后，第三栏才像 Nextflux 一样推进来」）。
  // 只作用于 article + hover，其它视图/档位不受影响。
  const articleLayout = useUISettingKey("articleLayout");
  const isArticleHoverLayout =
    contentType === "article" && articleLayout === "hover";

  // 桌面三栏的第三栏：Nextflux 式转场（reader-transition 批）。
  // 未选 → 首次选中 = 整块从右侧推进；已选 → 换另一条 = 正文上下滑动。
  // 触发条件与数值见 entry-content/reader-transition.ts（抄自 Nextflux ArticleView.jsx L146-202）。
  const entryContent = (
    <EntryContentTransition entryId={selectedEntryId}>
      {selectedEntryId ? (
        <Suspense fallback={<EntryContentFallback />}>
          <LazyEntryContent
            key={selectedEntryId}
            entryId={selectedEntryId}
            contentType={contentType}
            onClose={() => selectEntry(null)}
          />
        </Suspense>
      ) : (
        <EntryContentPlaceholder message={t("entry.select_article")} />
      )}
    </EntryContentTransition>
  );

  const mobileEntryContent = selectedEntryId ? (
    <Suspense fallback={<EntryContentFallback />}>
      <LazyEntryContent
        key={selectedEntryId}
        entryId={selectedEntryId}
        contentType={contentType}
        isMobile
        onBack={showList}
      />
    </Suspense>
  ) : (
    <EntryContentPlaceholder message={t("entry.select_article")} />
  );

  /**
   * 中栏条目列表（默认三栏布局那一份）。
   *
   * 单独提出来是给 56-28 的插件视图当**回落**用：`?view=` 认不出（插件停用 / 卸载 /
   * 手写错）时要落到「文章」这一屏，而不是一块白屏。两处必须是同一个元素，
   * 否则回落的列表与正常列表的行为会悄悄分叉。
   */
  const desktopEntryList = (
    <EntryList
      selection={selection}
      selectedEntryId={selectedEntryId}
      onSelectEntry={selectEntry}
      onMarkAllRead={handleMarkAllRead}
      unreadOnly={unreadOnly}
      onToggleUnreadOnly={toggleUnreadOnly}
      onFilterChange={handleFilterChange}
      onCloseEntry={() => selectEntry(null)}
      onToggleStarredViewOnly={handleToggleStarredViewOnly}
      contentType={contentType}
      isTablet={isTablet}
      onToggleSidebar={toggleSidebarVisible}
      sidebarVisible={sidebarVisible}
      onSelectFeedFromEntry={handleJumpToFeed}
      feedJumpBackHref={jumpBackHref}
      onBackFromFeedJump={handleBackFromFeedJump}
    />
  );

  // Redirect root to /all with first visible type (must be after ALL hooks including useCallback)
  if (location === "/") {
    // 等待 appearanceSettings 加载完成再跳转，避免先跳 article 再跳正确类型
    if (isAppearanceLoading) {
      return <div className="h-full bg-background" />;
    }
    const defaultType = visibleContentTypes[0] ?? "article";
    return <Redirect to={`/all?type=${defaultType}`} replace />;
  }

  // 等待 appearanceSettings 加载完成，避免显示默认三视图的闪烁
  if (isAppearanceLoading) {
    return <div className="h-full bg-background" />;
  }

  // Sidebar component (shared between mobile and desktop)
  const sidebarContent = (
    <Sidebar
      onAddClick={handleAddClick}
      selection={selection}
      onSelectFeed={handleSelectFeed}
      onSelectFolder={handleSelectFolder}
      onSelectStarred={handleSelectStarred}
      onSelectAll={handleSelectAll}
      contentType={contentType}
      appearanceSettings={appearanceSettings}
      // 56-28：视图切换器里的「插件」分组（清单 / 当前选中 / 点击切换）
      pluginViews={pluginViewRoute.views}
      activePluginView={pluginViewRoute.activeKey}
      onSelectPluginView={pluginViewRoute.openView}
      // 手机默认隐藏侧栏里重复的视图切换器（设置 → 外观 → 移动端样式可开）
      showContentTypeSwitcher={!isMobile || mobileSidebarShowViews}
      // 移动端：侧栏里的设置/资料弹窗打开时先关 Sheet，否则 Sheet 的滚动锁
      // 会吃掉弹窗内容区的滚动（移动端设置滑不动，2026-09-20）。
      onRequestClose={closeSidebar}
    />
  );

  /**
   * 56-28：插件视图接管主内容区。
   *
   * 判据是「地址栏里有 `?view=`」而不是 `status === "resolved"` —— 清单还没回来时
   * （loading）与认不出的值（unknown，钩子会把参数摘掉）也要走这一支：
   * 前者给空底避免「先画内置列表再跳」，后者把回落交给 `PluginViewOutlet` 的 fallback。
   */
  if (pluginViewRoute.resolution.status !== "none") {
    /** 沙箱里的「切视图 / 打开条目」：条目走宿主的选中（会离开插件视图），视图就地在插件内切 */
    const handlePluginNavigate = (target: {
      viewId?: string;
      entryId?: string;
    }) => {
      if (target.entryId) {
        selectEntry(target.entryId);
        return;
      }
      if (!target.viewId) return;
      const owner =
        pluginViewRoute.resolution.status === "resolved"
          ? pluginViewRoute.resolution.view.plugin
          : "";
      if (owner) pluginViewRoute.openView(`${owner}:${target.viewId}`);
    };

    const pluginOutlet = (
      <PluginViewOutlet
        resolution={pluginViewRoute.resolution}
        entry={pluginViewRoute.entry ?? undefined}
        fallback={desktopEntryList}
        onExit={pluginViewRoute.closeView}
        onSelectEntry={(entryId) => selectEntry(entryId)}
        onNavigate={handlePluginNavigate}
      />
    );

    if (isMobile) {
      return (
        <div className="flex h-[var(--app-dvh)] flex-col bg-background">
          <header className="shrink-0 border-b border-border/45 bg-background/88 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
            <div className="flex h-11 items-center gap-1 px-1.5">
              <button
                type="button"
                onClick={openSidebar}
                aria-label={t("actions.show_sidebar")}
                className="-ml-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-item-hover"
              >
                <MenuIcon className="size-5" />
              </button>
              <div className="min-w-0 flex-1 px-1">
                <div className="truncate text-[15px] font-semibold leading-5 text-foreground">
                  {t("plugins.plugin_view_badge")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                aria-label={t("search.title")}
                className="-mr-1.5 flex size-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-item-hover"
              >
                <SearchIcon className="size-5" />
              </button>
            </div>
          </header>
          <div className="min-h-0 flex-1 overflow-hidden pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
            {pluginOutlet}
          </div>
          <MobileTabBar
            contentType={contentType}
            visibleContentTypes={visibleContentTypes}
            onSelect={handleMobileTabSelect}
          />
          <ScrollToTopZone />
          {contentType === "picture" && <Lightbox />}
          {contentType !== "picture" && (
            <>
              <ImagePreview />
              <VideoPreview />
            </>
          )}
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            {sidebarContent}
          </Sheet>
          <ShortcutsHelpDialog
            open={isShortcutsOpen}
            onOpenChange={(open) => shortcutsHelp.set(open)}
          />
          <SearchModal open={isSearchOpen} onOpenChange={setIsSearchOpen} />
        </div>
      );
    }

    return (
      <>
        <ThreeColumnLayout
          sidebar={sidebarContent}
          list={null}
          content={pluginOutlet}
          hideList
          showSidebar={showSidebar}
        />
        <ShortcutsHelpDialog
          open={isShortcutsOpen}
          onOpenChange={(open) => shortcutsHelp.set(open)}
        />
        <SearchModal open={isSearchOpen} onOpenChange={setIsSearchOpen} />
      </>
    );
  }

  // Mobile layout - Sheet is rendered once at the top level to prevent animation flickering
  if (isMobile) {
    // Determine mobile content based on current route/mode
    let mobileContent: React.ReactNode;

    if (isAddFeedPath(location)) {
      mobileContent = (
        <div className="h-full safe-area-top">
          <AddFeedPage
            onClose={handleCloseAddFeed}
            contentType={addFeedContentType}
          />
        </div>
      );
    } else if (contentType === "picture") {
      mobileContent = (
        <div className="min-h-[var(--app-dvh)] bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
          <PictureMasonry
            selection={selection}
            contentType={contentType}
            unreadOnly={unreadOnly}
            onToggleUnreadOnly={toggleUnreadOnly}
            onMarkAllRead={handleMarkAllRead}
            isMobile
            onMenuClick={openSidebar}
            onSelectFeedFromEntry={handleJumpToFeed}
            feedJumpBackHref={jumpBackHref}
            onBackFromFeedJump={handleBackFromFeedJump}
            onSearchClick={() => setIsSearchOpen(true)}
          />
        </div>
      );
    } else {
      // List and detail views rendered together, controlled by CSS
      mobileContent = (
        <div className="mobile-reading-stack relative min-h-[var(--app-dvh)] w-screen max-w-full bg-background">
          {/* The list stays mounted in normal document flow to preserve state. */}
          <section
            className={cn(
              "mobile-list-page min-h-[var(--app-dvh)] bg-background pb-[calc(4.5rem+env(safe-area-inset-bottom))]",
              mobileView === "detail" && "pointer-events-none select-none",
            )}
            aria-hidden={mobileView === "detail"}
            inert={mobileView === "detail" ? true : undefined}
          >
            <EntryList
              selection={selection}
              selectedEntryId={selectedEntryId}
              onSelectEntry={selectEntry}
              onMarkAllRead={handleMarkAllRead}
              unreadOnly={unreadOnly}
              onToggleUnreadOnly={toggleUnreadOnly}
              onFilterChange={handleFilterChange}
              onToggleStarredViewOnly={handleToggleStarredViewOnly}
              onCloseEntry={() => selectEntry(null)}
              contentType={contentType}
              isMobile
              isActive={mobileView === "list"}
              onMenuClick={openSidebar}
              onSelectFeedFromEntry={handleJumpToFeed}
              feedJumpBackHref={jumpBackHref}
              onBackFromFeedJump={handleBackFromFeedJump}
              onSearchClick={() => setIsSearchOpen(true)}
            />
          </section>
          {/* Detail remains an internal scroller and slides over the document list. */}
          <section
            className={cn(
              "mobile-detail-page fixed inset-0 z-30 h-[var(--app-dvh)] overflow-hidden bg-background transition-transform duration-300 ease-out",
              mobileView === "detail"
                ? "translate-x-0"
                : "pointer-events-none translate-x-full",
            )}
            aria-hidden={mobileView !== "detail"}
            inert={mobileView !== "detail" ? true : undefined}
          >
            {mobileEntryContent}
          </section>
        </div>
      );
    }

    return (
      <>
        {mobileContent}
        {!isAddFeedPath(location) ? (
          <MobileTabBar
            contentType={contentType}
            visibleContentTypes={visibleContentTypes}
            onSelect={handleMobileTabSelect}
          />
        ) : null}
        <ScrollToTopZone />
        {/* Lightbox for picture mode */}
        {contentType === "picture" && <Lightbox />}
        {/* ImagePreview for article/notification mode */}
        {contentType !== "picture" && (
          <>
            <ImagePreview />
            <VideoPreview />
          </>
        )}
        {/* Sheet rendered once to prevent animation flickering on route/mode changes */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          {sidebarContent}
        </Sheet>
        <ShortcutsHelpDialog
          open={isShortcutsOpen}
          onOpenChange={(open) => shortcutsHelp.set(open)}
        />
        <SearchModal open={isSearchOpen} onOpenChange={setIsSearchOpen} />
      </>
    );
  }

  // Desktop layout
  if (isAddFeedPath(location)) {
    return (
      <ThreeColumnLayout
        sidebar={sidebarContent}
        list={null}
        content={
          <AddFeedPage
            onClose={handleCloseAddFeed}
            contentType={addFeedContentType}
          />
        }
        hideList
        showSidebar={showSidebar}
      />
    );
  }

  // Desktop social mode —— 两栏（对齐 Folo：SocialMedia 是 wideMode 视图，没有独立列表列；
  // 选中条目时内容在主列内替换时间线，而不是占用第三列）
  if (contentType === "social") {
    return (
      <>
        <ThreeColumnLayout
          sidebar={sidebarContent}
          list={null}
          content={
            /* 列表**常驻**：选中条目时只把详情盖在上面，不卸载列表。
               原来这里是「详情 or 列表」二选一 —— 点开条目会整块卸载 EntryList，关闭时重新挂载，
               滚动位置只能靠模块级 map 还原，表现就是「关掉详情后列表自己往上滚了」（用户报的 BUG-1）。
               移动端那段早就用「列表保持挂载以保留状态」，这里与它对齐。 */
            <div className="relative h-full min-h-0">
              <section
                className={cn(
                  "h-full min-h-0",
                  selectedEntryId && "pointer-events-none select-none",
                )}
                aria-hidden={selectedEntryId ? true : undefined}
                inert={selectedEntryId ? true : undefined}
              >
                <EntryList
                  selection={selection}
                  selectedEntryId={selectedEntryId}
                  onSelectEntry={selectEntry}
                  onMarkAllRead={handleMarkAllRead}
                  unreadOnly={unreadOnly}
                  onToggleUnreadOnly={toggleUnreadOnly}
                  onFilterChange={handleFilterChange}
                  onToggleStarredViewOnly={handleToggleStarredViewOnly}
                  onCloseEntry={() => selectEntry(null)}
                  contentType={contentType}
                  isActive={!selectedEntryId}
                  isTablet={isTablet}
                  onToggleSidebar={toggleSidebarVisible}
                  sidebarVisible={sidebarVisible}
                  onSelectFeedFromEntry={handleJumpToFeed}
                  feedJumpBackHref={jumpBackHref}
                  onBackFromFeedJump={handleBackFromFeedJump}
                />
              </section>

              {selectedEntryId && (
                <section className="absolute inset-0 z-10 overflow-hidden bg-background">
                  <Suspense fallback={<EntryContentFallback />}>
                    <LazyEntryContent
                      key={selectedEntryId}
                      entryId={selectedEntryId}
                      contentType={contentType}
                      onBack={() => selectEntry(null)}
                    />
                  </Suspense>
                </section>
              )}
            </div>
          }
          hideList
          showSidebar={showSidebar}
        />
        <ImagePreview />
        <VideoPreview />
        <ShortcutsHelpDialog
          open={isShortcutsOpen}
          onOpenChange={(open) => shortcutsHelp.set(open)}
        />
        <SearchModal open={isSearchOpen} onOpenChange={setIsSearchOpen} />
      </>
    );
  }

  // Desktop picture mode - two column layout
  if (contentType === "picture") {
    return (
      <>
        <ThreeColumnLayout
          sidebar={sidebarContent}
          list={null}
          content={
            <PictureMasonry
              selection={selection}
              contentType={contentType}
              unreadOnly={unreadOnly}
              onToggleUnreadOnly={toggleUnreadOnly}
              onMarkAllRead={handleMarkAllRead}
              isTablet={isTablet}
              onToggleSidebar={toggleSidebarVisible}
              sidebarVisible={sidebarVisible}
              onSelectFeedFromEntry={handleJumpToFeed}
              feedJumpBackHref={jumpBackHref}
              onBackFromFeedJump={handleBackFromFeedJump}
            />
          }
          hideList
          showSidebar={showSidebar}
        />
        <Lightbox />
      </>
    );
  }

  // Desktop notification mode —— 24-8：两栏（侧栏 + 时间线，参照 social/picture），
  // 不再渲染第三栏详情；点条目只在时间线内展开（正文级完整渲染 + 固定高度容器）。
  if (contentType === "notification") {
    return (
      <>
        <ThreeColumnLayout
          sidebar={sidebarContent}
          list={null}
          content={
            <EntryList
              selection={selection}
              selectedEntryId={selectedEntryId}
              onSelectEntry={selectEntry}
              onMarkAllRead={handleMarkAllRead}
              unreadOnly={unreadOnly}
              onToggleUnreadOnly={toggleUnreadOnly}
              onFilterChange={handleFilterChange}
              onCloseEntry={() => selectEntry(null)}
              onToggleStarredViewOnly={handleToggleStarredViewOnly}
              contentType={contentType}
              isTablet={isTablet}
              onToggleSidebar={toggleSidebarVisible}
              sidebarVisible={sidebarVisible}
              onSelectFeedFromEntry={handleJumpToFeed}
              feedJumpBackHref={jumpBackHref}
              onBackFromFeedJump={handleBackFromFeedJump}
            />
          }
          hideList
          showSidebar={showSidebar}
        />
        <ImagePreview />
        <VideoPreview />
        <ShortcutsHelpDialog
          open={isShortcutsOpen}
          onOpenChange={(open) => shortcutsHelp.set(open)}
        />
        <SearchModal open={isSearchOpen} onOpenChange={setIsSearchOpen} />
      </>
    );
  }

  return (
    <>
      <ThreeColumnLayout
        sidebar={sidebarContent}
        list={desktopEntryList}
        content={entryContent}
        showSidebar={showSidebar}
        hideContent={isArticleHoverLayout && !selectedEntryId}
      />
      <ImagePreview />
      <VideoPreview />
      <ShortcutsHelpDialog
        open={isShortcutsOpen}
        onOpenChange={(open) => shortcutsHelp.set(open)}
      />
      <SearchModal open={isSearchOpen} onOpenChange={setIsSearchOpen} />
    </>
  );
}

function AppContent() {
  const [location, navigate] = useLocation();
  const {
    isLoading,
    isAuthenticated,
    needsRegistration,
    needsLogin,
    isNetworkError,
    error,
    shouldRedirectToRoot,
    login,
    register,
    retry,
    clearError,
    consumeRootRedirect,
  } = useAuth();

  useEffect(() => {
    if (!shouldRedirectToRoot) {
      return;
    }
    if (location !== "/") {
      navigate("/", { replace: true });
    }
    consumeRootRedirect();
  }, [shouldRedirectToRoot, location, navigate, consumeRootRedirect]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (isNetworkError) {
    return <NetworkErrorPage onRetry={retry} />;
  }

  if (needsRegistration) {
    return (
      <RegisterPage
        onRegister={register}
        error={error}
        onClearError={clearError}
      />
    );
  }

  if (needsLogin) {
    return (
      <LoginPage onLogin={login} error={error} onClearError={clearError} />
    );
  }

  if (isAuthenticated) {
    return <AuthenticatedApp />;
  }

  return <LoadingScreen />;
}

function App() {
  // 「减少动态效果」也要管住 framer-motion 的 JS 动画（CSS 覆盖只影响 CSS 动画）
  const reduceMotion = useUISettingKey("reduceMotion");
  // 全局弹窗层见 components/app-shell/AppOverlays.tsx（与侧栏 Sheet 平级的那条约束写在那里）。

  return (
    <div className="app-shell">
      <MotionConfig reducedMotion={reduceMotion ? "always" : "user"}>
        <TooltipProvider delayDuration={300}>
          <Router>
            <AppContent />
            <AppOverlays />
          </Router>
        </TooltipProvider>
      </MotionConfig>
    </div>
  );
}

export default App;
