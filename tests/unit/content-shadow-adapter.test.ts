import { describe, expect, it } from "vitest";

import { ContentFilterController } from "../../src/content/content-filters";
import { detectSiteAdapters } from "../../src/content/site-adapters";

describe("shadow-root content adapter", () => {
  it("discovers every open compatibility root without requiring a version attribute", () => {
    const firstRoot = {} as ShadowRoot;
    const secondRoot = {} as ShadowRoot;
    const fakeDocument = {
      querySelectorAll: (selector: string) =>
        selector === "#bewly"
          ? [{ shadowRoot: firstRoot }, { shadowRoot: null }, { shadowRoot: secondRoot }]
          : []
    } as unknown as Document;

    const adapters = detectSiteAdapters(fakeDocument);
    const shadowAdapter = adapters[1];

    expect(shadowAdapter?.roots(fakeDocument)).toEqual([firstRoot, secondRoot]);
    expect(shadowAdapter?.hiddenElementSelectors["home-feed"]).toContain(".video-card");
    expect(shadowAdapter?.hiddenElementSelectors["search-suggestions"]).toContain(
      "#search-suggestion"
    );
  });

  it("listens for the compatibility mount event on window instead of document", () => {
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
