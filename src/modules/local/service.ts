import {
  declarativeNetRequestGetDynamicRules,
  declarativeNetRequestUpdateDynamicRules,
  hasDeclarativeNetRequestApi,
  hasUserScriptsApi,
  userScriptsGetRegistered,
  userScriptsRegister,
  userScriptsUnregister
} from "../../shared/browser";
import { LocalModuleRepository } from "./repository";
import type {
  LocalModuleDefinition,
  LocalModuleDomainPolicy,
  LocalModulePlatform,
  LocalModuleRuntimeStatus,
  LocalModuleSnapshot,
  LocalModuleStore,
  LocalPageRules
} from "./types";
import { localModuleMatches } from "./validation";

const USER_SCRIPT_PREFIX = "hourleaf-local-";
const DNR_RULE_ID_START = 2_000_000;
const DNR_RULE_ID_END = 2_999_999;
declare const __HOURLEAF_BROWSER_TARGET__: Exclude<LocalModulePlatform, "unknown">;

export class LocalModuleService {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private lastWarnings: string[] = [];

  constructor(
    private readonly repository = new LocalModuleRepository(),
    private readonly platform: LocalModulePlatform = resolveLocalModulePlatform()
  ) {}

  async initialize(): Promise<LocalModuleSnapshot> {
    return this.reconcile(await this.repository.get());
  }

  async getSnapshot(): Promise<LocalModuleSnapshot> {
    return { store: await this.repository.get(), runtime: this.runtimeStatus() };
  }

  async import(definition: LocalModuleDefinition): Promise<LocalModuleSnapshot> {
    if (this.platform === "safari" && definition.userScript.trim()) {
      throw new Error("Safari 商店版不导入或执行用户脚本");
    }
    return this.enqueue(async () => this.reconcile(await this.repository.import(definition)));
  }

  async setEnabled(id: string, enabled: boolean): Promise<LocalModuleSnapshot> {
    return this.enqueue(async () => this.reconcile(await this.repository.setEnabled(id, enabled)));
  }

  async remove(id: string): Promise<LocalModuleSnapshot> {
    return this.enqueue(async () => this.reconcile(await this.repository.remove(id)));
  }

  async getPageRules(url: string): Promise<LocalPageRules> {
    const definitions = await this.enabledDefinitionsFor(url);
    return {
      moduleIds: definitions.map((definition) => definition.id),
      hideSelectors: [...new Set(definitions.flatMap((definition) => definition.hideSelectors))],
      css: definitions
        .filter((definition) => definition.css.trim())
        .map((definition) => `/* Hourleaf local module: ${definition.id} */\n${definition.css}`)
        .join("\n\n")
    };
  }

  async getDomainPolicy(url: string): Promise<LocalModuleDomainPolicy> {
    const policies = (await this.enabledDefinitionsFor(url)).map(
      (definition) => definition.domainPolicy
    );
    if (policies.includes("always-block")) return "always-block";
    if (policies.includes("always-allow")) return "always-allow";
    return "timed";
  }

  private async enabledDefinitionsFor(url: string): Promise<LocalModuleDefinition[]> {
    const store = await this.repository.get();
    return Object.values(store.installations)
      .filter((installation) => installation.enabled)
      .map((installation) => installation.definition)
      .filter((definition) => localModuleMatches(definition, url));
  }

  private async reconcile(store: LocalModuleStore): Promise<LocalModuleSnapshot> {
    const warnings: string[] = [];
    await this.reconcileUserScripts(store, warnings);
    await this.reconcileDnr(store, warnings);
    this.lastWarnings = warnings;
    return { store, runtime: this.runtimeStatus() };
  }

  private async reconcileUserScripts(store: LocalModuleStore, warnings: string[]): Promise<void> {
    const enabledScripts = Object.values(store.installations).filter(
      (installation) => installation.enabled && installation.definition.userScript.trim()
    );
    if (this.platform === "safari") {
      if (enabledScripts.length > 0) {
        warnings.push("Safari 商店版不会执行已存储模块中的用户脚本。");
      }
      return;
    }
    if (!hasUserScriptsApi()) {
      if (enabledScripts.length > 0) {
        warnings.push("当前浏览器未开放 User Scripts API；CSS、元素隐藏和网络规则仍会生效。");
      }
      return;
    }
    try {
      const registered = await userScriptsGetRegistered();
      const ownedIds = registered
        .map((script) => script.id)
        .filter((id) => id.startsWith(USER_SCRIPT_PREFIX));
      if (ownedIds.length > 0) await userScriptsUnregister(ownedIds);
      if (enabledScripts.length === 0) return;
      await userScriptsRegister(
        enabledScripts.map((installation) => ({
          id: userScriptId(installation.definition.id),
          matches: installation.definition.matches,
          js: [{ code: installation.definition.userScript }],
          runAt: "document_idle" as const,
          world: "USER_SCRIPT" as const,
          allFrames: false as const
        }))
      );
    } catch {
      warnings.push("用户脚本尚未启用。请在浏览器扩展详情中允许用户脚本后重新启用模块。");
    }
  }

  private async reconcileDnr(store: LocalModuleStore, warnings: string[]): Promise<void> {
    const definitions = Object.values(store.installations)
      .filter((installation) => installation.enabled)
      .map((installation) => installation.definition)
      .filter((definition) => definition.dnrRules.length > 0);
    if (!hasDeclarativeNetRequestApi()) {
      if (definitions.length > 0) warnings.push("当前浏览器不支持动态声明式网络规则。");
      return;
    }
    try {
      const current = await declarativeNetRequestGetDynamicRules();
      const removeRuleIds = current
        .map((rule) => rule.id)
        .filter((id) => id >= DNR_RULE_ID_START && id <= DNR_RULE_ID_END);
      let nextId = DNR_RULE_ID_START;
      const addRules = definitions.flatMap((definition) => {
        const initiatorDomains = definition.matches.map(
          (pattern) => new URL(pattern.slice(0, -2)).hostname
        );
        return definition.dnrRules.map((rule) => ({
          id: nextId++,
          priority: 1,
          action: { type: rule.action },
          condition: {
            urlFilter: rule.urlFilter,
            initiatorDomains,
            resourceTypes: rule.resourceTypes
          }
        }));
      });
      if (removeRuleIds.length === 0 && addRules.length === 0) return;
      await declarativeNetRequestUpdateDynamicRules({
        ...(removeRuleIds.length > 0 ? { removeRuleIds } : {}),
        ...(addRules.length > 0 ? { addRules } : {})
      });
    } catch {
      warnings.push("声明式网络规则未能应用；其他模块能力不受影响。");
    }
  }

  private runtimeStatus(): LocalModuleRuntimeStatus {
    return {
      userScripts:
        this.platform === "safari"
          ? "disabled-by-platform"
          : hasUserScriptsApi()
            ? "available"
            : "permission-required",
      declarativeNetRequest: hasDeclarativeNetRequestApi() ? "available" : "unsupported",
      warnings: [...this.lastWarnings]
    };
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}

function resolveLocalModulePlatform(): LocalModulePlatform {
  if (typeof __HOURLEAF_BROWSER_TARGET__ !== "undefined") {
    return __HOURLEAF_BROWSER_TARGET__;
  }
  return "unknown";
}

function userScriptId(moduleId: string): string {
  let hash = 2_166_136_261;
  for (const character of moduleId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `${USER_SCRIPT_PREFIX}${(hash >>> 0).toString(36)}`;
}
