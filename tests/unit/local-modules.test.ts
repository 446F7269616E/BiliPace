import { afterEach, describe, expect, it } from "vitest";
import { parseLocalModuleFiles } from "../../src/modules/local/importer";
import { LocalModuleRepository } from "../../src/modules/local/repository";
import { LocalModuleService } from "../../src/modules/local/service";
import {
  localModuleMatches,
  normalizeLocalModuleDefinition
} from "../../src/modules/local/validation";
import { parseMessageRequest } from "../../src/shared/messages";
import type { ExtensionApi, StorageAreaLike } from "../../src/shared/browser";

const manifest = {
  schemaVersion: 1,
  id: "example.local.focus",
  name: "Example Focus",
  version: "1.0.0",
  description: "Local test module",
  matches: ["https://example.com/*"],
  domainPolicy: "always-block",
  hideSelectors: [".recommendations"],
  cssFiles: ["focus.css"],
  dnrRules: [{ action: "block", urlFilter: "||ads.example^", resourceTypes: ["script", "image"] }],
  userScriptFiles: ["focus.user.js"]
};

describe("local module boundary", () => {
  it("resolves only files selected in the same local import", () => {
    const module = parseLocalModuleFiles([
      { name: "hourleaf-module.json", text: JSON.stringify(manifest) },
      { name: "focus.css", text: ".recommendations { opacity: .2; }" },
      { name: "focus.user.js", text: "document.documentElement.dataset.focus = 'on';" }
    ]);

    expect(module).toMatchObject({
      id: "example.local.focus",
      matches: ["https://example.com/*"],
      domainPolicy: "always-block"
    });
    expect(module.capabilities).toEqual(
      expect.arrayContaining([
        "domain-policy",
        "hide-elements",
        "css",
        "declarative-net-request",
        "user-script"
      ])
    );
    expect(localModuleMatches(module, "https://example.com/path")).toBe(true);
    expect(localModuleMatches(module, "https://other.example/path")).toBe(false);
  });

  it("accepts standalone user-script metadata without fetching anything", () => {
    const module = parseLocalModuleFiles([
      {
        name: "focus.user.js",
        text: [
          "// ==UserScript==",
          "// @id example.local.script",
          "// @name Example Script",
          "// @version 1.2.0",
          "// @match https://example.com/*",
          "// ==/UserScript==",
          "document.body.dataset.example = 'true';"
        ].join("\n")
      }
    ]);

    expect(module).toMatchObject({ id: "example.local.script", version: "1.2.0" });
    expect(module.userScript).toContain("document.body.dataset.example");
  });

  it("rejects wildcard hosts, remote CSS and unsafe network actions", () => {
    const baseline = {
      schemaVersion: 1,
      id: "example.local.invalid",
      name: "Invalid",
      version: "1.0.0",
      description: "",
      matches: ["https://example.com/*"],
      domainPolicy: "timed",
      hideSelectors: [],
      css: "",
      dnrRules: [],
      userScript: "",
      capabilities: []
    };

    expect(
      normalizeLocalModuleDefinition({ ...baseline, matches: ["https://*.example.com/*"] })
    ).toBeNull();
    expect(
      normalizeLocalModuleDefinition({
        ...baseline,
        css: "@import url('https://cdn.example/style.css');"
      })
    ).toBeNull();
    expect(
      normalizeLocalModuleDefinition({
        ...baseline,
        css: ".leak { background: image-set('https://cdn.example/pixel'); }"
      })
    ).toBeNull();
    expect(
      normalizeLocalModuleDefinition({
        ...baseline,
        dnrRules: [{ action: "redirect", urlFilter: "*", resourceTypes: ["script"] }]
      })
    ).toBeNull();
  });

  it("normalizes imported modules again at the privileged message boundary", () => {
    const definition = parseLocalModuleFiles([
      { name: "hourleaf-module.json", text: JSON.stringify({ ...manifest, cssFiles: [] }) },
      { name: "focus.user.js", text: "document.body.dataset.focus = 'on';" }
    ]);
    const parsed = parseMessageRequest({
      version: 1,
      requestId: "local-module-1",
      type: "IMPORT_LOCAL_MODULE",
      payload: { module: definition }
    });

    expect(parsed?.request).toMatchObject({
      type: "IMPORT_LOCAL_MODULE",
      module: { id: "example.local.focus" }
    });
  });

  it("binds imported code to browser-owned isolation and declared initiator domains", async () => {
    const storage = new MemoryStorage();
    const registeredScripts: unknown[][] = [];
    const dnrUpdates: unknown[] = [];
    (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
      runtime: {
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: () => undefined }
      },
      storage: { local: storage },
      userScripts: {
        getScripts: () => Promise.resolve([]),
        register: (scripts) => {
          registeredScripts.push(scripts);
          return Promise.resolve();
        },
        unregister: () => Promise.resolve()
      },
      declarativeNetRequest: {
        getDynamicRules: () => Promise.resolve([]),
        updateDynamicRules: (update) => {
          dnrUpdates.push(update);
          return Promise.resolve();
        }
      }
    };
    const definition = parseLocalModuleFiles([
      { name: "hourleaf-module.json", text: JSON.stringify({ ...manifest, cssFiles: [] }) },
      { name: "focus.user.js", text: "document.body.dataset.focus = 'on';" }
    ]);
    const service = new LocalModuleService(new LocalModuleRepository(storage));
    await service.import(definition);
    await service.setEnabled(definition.id, true);

    expect(registeredScripts.at(-1)?.[0]).toMatchObject({
      matches: ["https://example.com/*"],
      world: "USER_SCRIPT",
      allFrames: false,
      runAt: "document_idle"
    });
    expect(dnrUpdates.at(-1)).toMatchObject({
      addRules: [
        {
          action: { type: "block" },
          condition: { initiatorDomains: ["example.com"] }
        }
      ]
    });
  });

  it("enforces Safari's no-user-script boundary in the privileged service", async () => {
    const storage = new MemoryStorage();
    const registeredScripts: unknown[][] = [];
    (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser = {
      runtime: {
        sendMessage: () => Promise.resolve(),
        onMessage: { addListener: () => undefined }
      },
      storage: { local: storage },
      userScripts: {
        getScripts: () => Promise.resolve([]),
        register: (scripts) => {
          registeredScripts.push(scripts);
          return Promise.resolve();
        },
        unregister: () => Promise.resolve()
      }
    };
    const definition = parseLocalModuleFiles([
      { name: "hourleaf-module.json", text: JSON.stringify({ ...manifest, cssFiles: [] }) },
      { name: "focus.user.js", text: "document.body.dataset.focus = 'on';" }
    ]);
    const service = new LocalModuleService(new LocalModuleRepository(storage), "safari");

    await expect(service.import(definition)).rejects.toThrow("Safari 商店版");
    expect((await service.getSnapshot()).runtime.userScripts).toBe("disabled-by-platform");
    expect((await service.getSnapshot()).store.installations).toEqual({});

    const repository = new LocalModuleRepository(storage);
    await repository.import(definition);
    await repository.setEnabled(definition.id, true);
    await new LocalModuleService(repository, "safari").initialize();
    expect(registeredScripts).toEqual([]);
  });
});

afterEach(() => {
  delete (globalThis as typeof globalThis & { browser?: ExtensionApi }).browser;
});

class MemoryStorage implements StorageAreaLike {
  private readonly values: Record<string, unknown> = {};

  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
    if (typeof keys === "string") return Promise.resolve({ [keys]: this.values[keys] });
    return Promise.resolve({ ...this.values });
  }

  set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
    return Promise.resolve();
  }
}
