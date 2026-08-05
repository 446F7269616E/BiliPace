import { describe, expect, it } from "vitest";
import {
  MANUAL_IMPORT_LIMITS,
  parseBilibiliVideoReference,
  parseManualBilibiliImport
} from "../../../src/integrations/manual";

describe("manual Bilibili import", () => {
  it("normalizes official video URLs without retaining tracking parameters", () => {
    expect(
      parseBilibiliVideoReference(
        "https://www.bilibili.com/video/BV1GJ411x7h7?p=2&spm_id_from=333.1007",
        "  测试\n视频  "
      )
    ).toEqual({
      ok: true,
      item: {
        bvid: "BV1GJ411x7h7",
        title: "测试 视频",
        url: "https://www.bilibili.com/video/BV1GJ411x7h7"
      }
    });
  });

  it("supports mobile URLs, markdown links, title prefixes and bare BVIDs", () => {
    const result = parseManualBilibiliImport(`
[第一个](https://m.bilibili.com/video/BV1GJ411x7h7)
第二个 | https://www.bilibili.com/video/BV1Q541167Qg?t=2
BV17x411w7KC
`);

    expect(result.items).toEqual([
      {
        bvid: "BV1GJ411x7h7",
        title: "第一个",
        url: "https://www.bilibili.com/video/BV1GJ411x7h7"
      },
      {
        bvid: "BV1Q541167Qg",
        title: "第二个",
        url: "https://www.bilibili.com/video/BV1Q541167Qg"
      },
      {
        bvid: "BV17x411w7KC",
        title: "BV17x411w7KC",
        url: "https://www.bilibili.com/video/BV17x411w7KC"
      }
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("deduplicates by BVID and keeps the first title", () => {
    const result = parseManualBilibiliImport(`
先来 https://www.bilibili.com/video/BV1GJ411x7h7
后来 https://m.bilibili.com/video/BV1GJ411x7h7?p=3
`);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe("先来");
    expect(result.duplicateCount).toBe(1);
  });

  it.each([
    ["http://www.bilibili.com/video/BV1GJ411x7h7", "insecure-url"],
    ["https://evilbilibili.com/video/BV1GJ411x7h7", "unsupported-host"],
    ["https://www.bilibili.com/read/cv1", "missing-bvid"],
    ["https://b23.tv/abcdef", "short-link-requires-browser"],
    ["not a link", "invalid-url"]
  ] as const)("rejects %s as %s", (input, reason) => {
    expect(parseBilibiliVideoReference(input)).toEqual({ ok: false, reason });
  });

  it("reports rejected lines without echoing unbounded text", () => {
    const longBadLine = `https://example.com/${"x".repeat(400)}`;
    const result = parseManualBilibiliImport(longBadLine);

    expect(result.rejected[0]).toMatchObject({ lineNumber: 1, reason: "unsupported-host" });
    expect(result.rejected[0]?.input.length).toBeLessThanOrEqual(240);
  });

  it("bounds input and item counts", () => {
    const validLines = Array.from(
      { length: MANUAL_IMPORT_LIMITS.maxItems + 1 },
      (_, index) => `BV${index.toString(36).padStart(10, "0")}`
    ).join("\n");
    const result = parseManualBilibiliImport(validLines);

    expect(result.items).toHaveLength(MANUAL_IMPORT_LIMITS.maxItems);
    expect(result.rejected.at(-1)?.reason).toBe("item-limit");
  });
});
