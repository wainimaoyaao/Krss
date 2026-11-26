import { describe, expect, it } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { useImageZoom } from "./useImageZoom";

/**
 * 拖动时必须关掉位移补间：`transition` 由拖动态决定。
 *
 * 原来的写法是 `transition: dragRef.current ? "none" : ...` —— 渲染期读 ref，
 * ref 变了不触发渲染。改成 state 之后语义清楚了。
 *
 * 说明（不要被这份测试骗了）：把实现换回读 ref 的写法，这三条断言**依然全过**，
 * 因为 jsdom 里 pointerdown 之后同一 tick 内就会重渲染，两种实现落到 DOM 上没差别；
 * 真正的差别只在浏览器首帧跟手手感。所以这里守的是「拖动态约束」（拖动中 none、抬手恢复补间），
 * 不是「读 ref vs 读 state」的红证 —— 后者本机没法验：受控 RSS 的图在 loopback，
 * 会被媒体代理的 SSRF 守卫 403 掉，真浏览器里根本进不了可缩放的灯箱。
 */
function ZoomProbe() {
  const { containerRef, handlers, style } = useImageZoom("probe");
  return (
    <div ref={containerRef} {...handlers} data-testid="surface">
      <img alt="" style={style} data-testid="target" />
    </div>
  );
}

/** jsdom 没有 setPointerCapture，pointerdown 里会调到它 */
function stubPointerCapture(el: HTMLElement) {
  el.setPointerCapture = () => {};
}

function mountZoomed() {
  const view = render(<ZoomProbe />);
  const surface = view.getByTestId("surface");
  // 先双击放大到 2 倍（scale > 1 才允许拖动）
  act(() => {
    fireEvent.doubleClick(surface, { clientX: 40, clientY: 40 });
  });
  return view;
}

describe("useImageZoom 拖动补间", () => {
  it("未拖动时保留 160ms 补间", () => {
    mountZoomed();
    const target = document.querySelector<HTMLElement>('[data-testid="target"]');
    expect(target?.style.transition).toContain("160ms");
  });

  it("pointerdown 之后同一轮渲染就切成 none（不再读旧 ref）", () => {
    mountZoomed();
    const surface = document.querySelector<HTMLElement>('[data-testid="surface"]');
    const target = document.querySelector<HTMLElement>('[data-testid="target"]');

    act(() => {
      if (surface) stubPointerCapture(surface);
      fireEvent.pointerDown(surface as HTMLElement, {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
    });

    expect(target?.style.transition).toBe("none");
  });

  it("抬手后恢复补间", () => {
    mountZoomed();
    const surface = document.querySelector<HTMLElement>('[data-testid="surface"]');
    const target = document.querySelector<HTMLElement>('[data-testid="target"]');

    act(() => {
      if (surface) stubPointerCapture(surface);
      fireEvent.pointerDown(surface as HTMLElement, {
        pointerId: 1,
        clientX: 10,
        clientY: 10,
      });
    });
    act(() => {
      fireEvent.pointerUp(surface as HTMLElement, { pointerId: 1 });
    });

    expect(target?.style.transition).toContain("160ms");
  });
});
