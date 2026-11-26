import { useEffect } from "react";
import {
  applyAccentColorToDocument,
  applyComponentRadiusToDocument,
  applyFieldRadiusToDocument,
  applyIconRadiusToDocument,
  applyQuoteStyleToDocument,
  applyReduceMotionToDocument,
  applyUiScaleToDocument,
  useUISettingKey,
} from "@/hooks/useUISettings";

/**
 * 即时生效的外观设置落到 `<html>` 上。
 *
 * 这些设置改一下就立刻重绘（不等服务端），落点全是 `<html>` 的属性或 CSS 变量：
 *
 * - 「减少动态效果」→ `data-reduce-motion`，由 CSS 统一压掉动画
 * - 「引文样式」→ `data-quote-style`，强调块 / Folo 式分割线
 * - 主题色 → 内联 `--accent`，null = 跟随主题
 * - 界面字号 → `<html>` 基准字号（界面都用 rem，整体跟着缩放）
 * - 圆角三个旋钮（组件 / 表单 / 订阅图标）→ CSS 变量，默认档把变量摘掉
 *
 * 从 `App.tsx` 抽出来的是「挂载点」，取值与落点逻辑本身仍在
 * `@/hooks/useUISettings`（跟着那里的单测走）；这里只保证每个旋钮一个 effect、
 * 依赖只有它自己那一项。
 */
export function useDocumentAppearance(): void {
  const reduceMotion = useUISettingKey("reduceMotion");
  useEffect(() => {
    applyReduceMotionToDocument(Boolean(reduceMotion));
  }, [reduceMotion]);

  const quoteStyle = useUISettingKey("quoteStyle");
  useEffect(() => {
    applyQuoteStyleToDocument(quoteStyle);
  }, [quoteStyle]);

  const accentColor = useUISettingKey("accentColor");
  useEffect(() => {
    applyAccentColorToDocument(accentColor ?? null);
  }, [accentColor]);

  const uiScale = useUISettingKey("uiScale");
  useEffect(() => {
    applyUiScaleToDocument(uiScale);
  }, [uiScale]);

  const componentRadius = useUISettingKey("componentRadius");
  useEffect(() => {
    applyComponentRadiusToDocument(componentRadius);
  }, [componentRadius]);

  const fieldRadius = useUISettingKey("fieldRadius");
  useEffect(() => {
    applyFieldRadiusToDocument(fieldRadius);
  }, [fieldRadius]);

  const iconRadius = useUISettingKey("iconRadius");
  useEffect(() => {
    applyIconRadiusToDocument(iconRadius);
  }, [iconRadius]);
}
