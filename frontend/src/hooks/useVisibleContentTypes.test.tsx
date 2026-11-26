import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContentTypes, useVisibleContentTypes } from "./useVisibleContentTypes";

/**
 * 2026-11-26：可见视图集合与「地址栏 type 被关掉就原地 replace」从 `AuthenticatedApp` 搬出来。
 */
const selectAll = vi.fn();

function run(
  options: Partial<Parameters<typeof useVisibleContentTypes>[0]> = {},
) {
  const { result } = renderHook(() =>
    useVisibleContentTypes({
      appearanceSettings: undefined,
      contentType: "article",
      selectAll,
      ...options,
    }),
  );
  return result.current;
}

beforeEach(() => {
  selectAll.mockClear();
});

describe("可见集合", () => {
  it("设置没加载完 / 没配时给四档默认", () => {
    expect(run()).toEqual(defaultContentTypes);
    expect(run({ appearanceSettings: { contentTypes: [] } })).toEqual(
      defaultContentTypes,
    );
  });

  it("按设置顺序保留，未知值丢掉", () => {
    expect(
      run({
        appearanceSettings: {
          contentTypes: ["picture", "unknown" as never, "article"],
        },
      }),
    ).toEqual(["picture", "article"]);
  });
});

describe("当前 type 被关掉时的兜底", () => {
  it("不在集合里 → replace 到第一个可见档", () => {
    run({
      appearanceSettings: { contentTypes: ["picture", "notification"] },
      contentType: "article",
    });
    expect(selectAll).toHaveBeenCalledWith("picture", { replace: true });
  });

  it("在集合里就不动", () => {
    run({
      appearanceSettings: { contentTypes: ["picture", "article"] },
      contentType: "article",
    });
    expect(selectAll).not.toHaveBeenCalled();
  });

  it("集合被清空时退回 article", () => {
    run({
      appearanceSettings: { contentTypes: [] },
      contentType: "picture",
    });
    expect(selectAll).not.toHaveBeenCalled();
  });
});
