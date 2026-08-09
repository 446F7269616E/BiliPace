import { describe, expect, it } from "vitest";

import {
  assertValidSiteModuleDescriptor,
  createSiteModuleHashInput
} from "../../src/modules/contracts";
import { BILIBILI_SITE_MODULE_DESCRIPTOR } from "../../src/modules/bilibili";

describe("site module descriptor boundary", () => {
  it("rejects non-HTTPS or unbounded module metadata", () => {
    expect(() =>
      assertValidSiteModuleDescriptor({
        ...BILIBILI_SITE_MODULE_DESCRIPTOR,
        manifest: {
          ...BILIBILI_SITE_MODULE_DESCRIPTOR.manifest,
          hosts: ["http://www.bilibili.com/*"]
        }
      })
    ).toThrow();
  });

  it("sorts object keys without reordering reviewed arrays", () => {
    const first = createSiteModuleHashInput(BILIBILI_SITE_MODULE_DESCRIPTOR);
    const second = createSiteModuleHashInput({
      ...BILIBILI_SITE_MODULE_DESCRIPTOR,
      distribution: { ...BILIBILI_SITE_MODULE_DESCRIPTOR.distribution }
    });
    expect(second).toBe(first);
  });
});
