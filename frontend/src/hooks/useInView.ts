import { useEffect, useRef, useState } from "react";

/**
 * 元素是否进入过视口（进入后保持 true，避免来回卸载重渲染）。
 *
 * 用途：列表「自动展开正文」时，只给靠近视口的卡片渲染完整正文，
 * 否则一屏几十篇全文会把首屏拖垮。
 */
export function useInView<T extends HTMLElement>(rootMargin = "600px") {
  const ref = useRef<T | null>(null);
  // 没有 IntersectionObserver（老浏览器 / jsdom）时直接算「已进入」，
  // 用惰性初值表达，别在 effect 里补一次 setState。
  const [inView, setInView] = useState(
    () => typeof IntersectionObserver === "undefined",
  );

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            return;
          }
        }
      },
      { rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}
