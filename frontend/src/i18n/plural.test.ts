import { describe, expect, it } from "vitest";

import i18n from "@/i18n";

/**
 * F1：中英两份 locale 的复数形态不一样 —— 英文用 `_one` / `_other`，中文只有基础键。
 * 这本身不是缺翻译（中文只有一个复数范畴），但「到底渲染出什么」必须实测，不能靠读 JSON 猜。
 * 下面把实际调用点用到的数都跑一遍：`EntryListHeader` 传的是未读数，`unreadCount > 0` 时才渲染。
 */
describe("未读数的中英文渲染", () => {
  const cases: Array<[number, string, string]> = [
    [0, "0 条未读", "0 unread"],
    [1, "1 条未读", "1 unread"],
    [2, "2 条未读", "2 unread"],
    [5, "5 条未读", "5 unread"],
    [1000, "1000 条未读", "1000 unread"],
  ];

  for (const [count, zh, en] of cases) {
    it(`count=${count}`, () => {
      expect(i18n.t("entry.unread_count", { count, lng: "zh" })).toBe(zh);
      expect(i18n.t("entry.unread_count", { count, lng: "en" })).toBe(en);
    });
  }

  it("两种语言都不会回显 key（回显就说明复数形态没兜住）", () => {
    for (const count of [0, 1, 2, 5]) {
      for (const lng of ["zh", "en"] as const) {
        expect(i18n.t("entry.unread_count", { count, lng })).not.toContain("unread_count");
      }
    }
  });
});
