import { describe, expect, it } from "vitest";

import {
  BILIBILI_SITE_MODULE,
  BILIBILI_SITE_MODULE_DESCRIPTOR,
  BILIBILI_SITE_MODULE_HASH_INPUT,
  canonicalVideoUrl,
  classifyBilibiliModuleUrl,
  extractBilibiliPlanIdentity
} from "../../src/modules/bilibili";
import { createSiteModuleHashInput } from "../../src/modules/contracts";

describe("hourleaf.site.bilibili", () => {
  it.each([
    ["https://www.bilibili.com/", "home"],
    ["https://www.bilibili.com/?page=Moments", "dynamic"],
    ["https://www.bilibili.com/v/popular/all", "popular"],
    ["https://www.bilibili.com/video/BV1xx411c7mD", "video"],
    ["https://live.bilibili.com/6", "live"],
    ["https://search.bilibili.com/all", "search"],
    ["https://www.bilibili.com/?page=Unknown", null],
    ["https://space.bilibili.com/1", null],
    ["https://www.bilibili.com.evil.example/", null]
  ] as const)("classifies %s", (url, expected) => {
    expect(classifyBilibiliModuleUrl(url)).toBe(expected);
  });

  it("derives stable target identities from the descriptor", () => {
    expect(BILIBILI_SITE_MODULE.match("https://www.bilibili.com/video/BV1xx411c7mD")).toMatchObject(
      {
        moduleId: "hourleaf.site.bilibili",
        targetId: "module:bilibili:video",
        sectionId: "video"
      }
    );
  });

  it("keeps the release hash input canonical", () => {
    expect(createSiteModuleHashInput(BILIBILI_SITE_MODULE_DESCRIPTOR)).toBe(
      BILIBILI_SITE_MODULE_HASH_INPUT
    );
    expect(BILIBILI_SITE_MODULE_HASH_INPUT).toContain('"id":"hourleaf.site.bilibili"');
  });

  it("owns BVID parsing and canonicalization inside the module", () => {
    expect(extractBilibiliPlanIdentity("https://www.bilibili.com/video/BV1xx411c7mD?p=2")).toEqual({
      kind: "bvid",
      value: "BV1xx411c7mD",
      canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD"
    });
    expect(canonicalVideoUrl("BV1xx411c7mD")).toBe("https://www.bilibili.com/video/BV1xx411c7mD");
  });

  it("keeps Ave Shadow DOM hooks inside the optional descriptor", () => {
    const profile = BILIBILI_SITE_MODULE_DESCRIPTOR.contentProfiles.find(
      (candidate) => candidate.id === "ave-mujica"
    );
    expect(profile?.root).toEqual({
      id: "bewly-shadow",
      kind: "open-shadow",
      hostSelector: "#bewly"
    });
    expect(profile?.hiddenElementSelectors["home-feed"]).toContain(".video-card");
    expect(BILIBILI_SITE_MODULE_DESCRIPTOR.lifecycle).toContainEqual({
      target: "window",
      event: "bewlyMounted"
    });
  });
});
