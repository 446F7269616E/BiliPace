import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BILIBILI_LOGIN_URL,
  BILIBILI_OPEN_PLATFORM_URL,
  BilibiliOpenPlatformProvider
} from "../../../src/integrations/open-platform";

describe("BilibiliOpenPlatformProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is an explicit safe placeholder until an official application is approved", async () => {
    const provider = new BilibiliOpenPlatformProvider();

    await expect(provider.getStatus()).resolves.toMatchObject({
      state: "not-configured",
      availableCapabilities: [],
      manualImportAvailable: true,
      setupUrl: BILIBILI_OPEN_PLATFORM_URL,
      loginUrl: BILIBILI_LOGIN_URL
    });
  });

  it("degrades every account-backed operation without making a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new BilibiliOpenPlatformProvider();

    const results = await Promise.all([
      provider.listWatchLater({ limit: 20 }),
      provider.listFavoriteFolders({ limit: 20 }),
      provider.listFavoriteMedia("folder-id", { limit: 20 })
    ]);

    for (const result of results) {
      expect(result).toMatchObject({
        ok: false,
        error: { code: "not-configured", retryable: false }
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
