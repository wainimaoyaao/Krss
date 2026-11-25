import { useTranslation } from "react-i18next";

/**
 * App 壳里的三种「整屏状态」。原先都内联在 App.tsx 里，F5 拆分时挪出来：
 * 它们是纯展示组件（不读 store、不发请求），放在 App.tsx 里只会让那个文件更难读。
 */

/** 认证状态还没确定、或已认证但路由还没起来时的整屏加载。 */
export function LoadingScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center overflow-x-clip bg-background">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">{t("entry.loading")}</p>
      </div>
    </div>
  );
}

/** 第三栏还没选条目时的空态（文案由调用方给，跟着地区走 i18n）。 */
export function EntryContentPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center px-6" />
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-center text-muted-foreground opacity-60">
          <svg
            className="size-16"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <p className="text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

/** 条目正文 chunk 还在下载时的骨架屏（形状照着正文排版，避免加载完跳动）。 */
export function EntryContentFallback() {
  return (
    <div className="relative flex h-full flex-col animate-pulse">
      <div className="absolute inset-x-0 top-0 z-20">
        <div className="h-12" />
      </div>
      <div className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 pb-20 pt-16">
          <div className="mb-10 space-y-5">
            <div className="h-10 w-3/4 rounded bg-secondary" />
            <div className="flex gap-6">
              <div className="h-4 w-24 rounded bg-secondary" />
              <div className="h-4 w-32 rounded bg-secondary" />
            </div>
            <hr className="border-border/60" />
          </div>
          <div className="space-y-4">
            <div className="h-4 w-full rounded bg-secondary" />
            <div className="h-4 w-full rounded bg-secondary" />
            <div className="h-4 w-3/4 rounded bg-secondary" />
            <div className="h-4 w-full rounded bg-secondary" />
            <div className="h-4 w-5/6 rounded bg-secondary" />
          </div>
        </div>
      </div>
    </div>
  );
}
