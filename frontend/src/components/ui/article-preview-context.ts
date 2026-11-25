import { createContext } from "react";

/**
 * 正文里的图片「点开大图」通道。
 *
 * F4：这个 context 原来定义在 `article-content.tsx` 里。它本身只是一对
 * `{ images, openPreview }`，任何用到正文图片的组件（含图片组件、列表卡片）都只要它 ——
 * 但只要有谁 `import { ImagePreviewContext } from "./article-content"`，那条链就会把
 * `parse-html`（unified + rehype，首屏 71.8 KB gzip）一起拉进首屏。
 * 抽成独立模块后，需要 context 的人不必再背整条正文管线。
 */
export interface ImagePreviewContextValue {
  images: string[];
  openPreview: (src: string) => void;
}

export const ImagePreviewContext =
  createContext<ImagePreviewContextValue | null>(null);
