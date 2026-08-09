import { describe, expect, it } from "vitest";
import { classifyBilibiliModuleUrl as classifyBilibiliUrl } from "../../src/modules/bilibili";

describe("classifyBilibiliUrl", () => {
  it.each([
    ["https://www.bilibili.com/", "home"],
    ["https://www.bilibili.com/index.html", "home"],
    ["https://www.bilibili.com/v/dynamic", "dynamic"],
    ["https://t.bilibili.com/123", "dynamic"],
    ["https://www.bilibili.com/v/popular/all", "popular"],
    ["https://www.bilibili.com/video/BV1xx411c7mD", "video"],
    ["https://www.bilibili.com/list/watchlater", "video"],
    ["https://live.bilibili.com/6", "live"],
    ["https://www.bilibili.com/bangumi/play/ep123", "bangumi"],
    ["https://www.bilibili.com/cinema/", "bangumi"],
    ["https://search.bilibili.com/all?keyword=test", "search"],
    ["https://www.bilibili.com/?page=Home", "home"],
    ["https://www.bilibili.com/?page=Search", "search"],
    ["https://www.bilibili.com/?page=Anime", "bangumi"],
    ["https://www.bilibili.com/?page=Moments", "dynamic"],
    ["https://www.bilibili.com/?page=WatchLater", null],
    ["https://www.bilibili.com/?page=Unknown", null],
    ["https://space.bilibili.com/123", null],
    ["https://www.bilibili.com/read/cv123", null],
    ["https://www.bilibili.com.evil.example/", null],
    ["not a url", null]
  ] as const)("classifies %s as %s", (url, section) => {
    expect(classifyBilibiliUrl(url)).toBe(section);
  });
});
