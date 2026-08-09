import { describe, expect, it } from "vitest";

import { ContentFilterController } from "../../src/content/content-filters";
import { detectSiteAdapters } from "../../src/content/site-adapters";

describe("Ave Mujica content adapter", () => {
  it("discovers every open #bewly root without requiring a version attribute", () => {
    const firstRoot = {} as ShadowRoot;
    const secondRoot = {} as ShadowRoot;
    const fakeDocument = {
      querySelectorAll: (selector: string) =>
        selector === "#bewly"
          ? [{ shadowRoot: firstRoot }, { shadowRoot: null }, { shadowRoot: secondRoot }]
          : []
    } as unknown as Document;

    const adapters = detectSiteAdapters(fakeDocument);
    const aveAdapter = adapters[1];

    expect(aveAdapter?.roots(fakeDocument)).toEqual([firstRoot, secondRoot]);
    expect(aveAdapter?.hiddenElementSelectors["home-feed"]).toContain(".video-card");
    expect(aveAdapter?.hiddenElementSelectors["search-suggestions"]).toContain(
      "#search-suggestion"
    );
  });

  it("listens for the Ave mount event on window instead of document", () => {
    const documentEvents: string[] = [];
    const windowEvents: string[] = [];
    const fakeWindow = {
      addEventListener: (type: string) => windowEvents.push(type),
      removeEventListener: () => undefined
    };
    const fakeDocument = {
      defaultView: fakeWindow,
      addEventListener: (type: string) => documentEvents.push(type),
      removeEventListener: () => undefined
    } as unknown as Document;

    new ContentFilterController(fakeDocument);

    expect(windowEvents).toContain("bewlyMounted");
    expect(documentEvents).not.toContain("bewlyMounted");
    expect(documentEvents).toContain("keydown");
  });
});
