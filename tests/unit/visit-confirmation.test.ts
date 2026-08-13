import { describe, expect, it } from "vitest";
import { VisitConfirmationService } from "../../src/background/visit-confirmation";

describe("visit confirmation grants", () => {
  it("enforces the independent wait and grants one tab for one policy version", async () => {
    const service = new VisitConfirmationService(null);
    expect(await service.requireConfirmation(12, "site:test", "https://example.com", 4, 3, 0)).toBe(
      3
    );
    await expect(
      service.grant(12, "site:test", "https://example.com", 4, 3, 2_999)
    ).rejects.toThrow(/wait/u);
    await service.grant(12, "site:test", "https://example.com", 4, 3, 3_000);
    expect(await service.isGranted(12, "site:test", "https://example.com", 4)).toBe(true);
    expect(await service.isGranted(12, "site:test", "https://example.com", 5)).toBe(false);
  });

  it("keeps the grant through the shared extension page and revokes it after leaving", async () => {
    const service = new VisitConfirmationService(null);
    await service.requireConfirmation(8, "site:test", "https://example.com", 9, 0, 100);
    await service.grant(8, "site:test", "https://example.com", 9, 0, 100);
    await service.revokeIfOriginChanged(
      8,
      "chrome-extension://hourleaf/end.html",
      "chrome-extension://hourleaf/"
    );
    expect(await service.isGranted(8, "site:test", "https://example.com", 9)).toBe(true);
    await service.revokeIfOriginChanged(
      8,
      "https://other.example/",
      "chrome-extension://hourleaf/"
    );
    expect(await service.isGranted(8, "site:test", "https://example.com", 9)).toBe(false);
  });
});
