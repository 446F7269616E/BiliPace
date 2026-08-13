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
  LocalModuleWarningCode,
  LocalPageRules
} from "./types";
import { getLocalModuleContentSafetyIssue, localModuleMatches } from "./validation";

const USER_SCRIPT_PREFIX = "hourleaf-local-";
const DNR_RULE_ID_START = 2_000_000;
const DNR_RULE_ID_END = 2_999_999;
declare const __HOURLEAF_BROWSER_TARGET__: Exclude<LocalModulePlatform, "unknown">;

export class LocalModuleService {
  private writeQueue: Promise<unknown> = Promise.resolve();
  private lastWarnings: LocalModuleWarningCode[] = [];

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
    const warnings: LocalModuleWarningCode[] = [];
    await this.reconcileUserScripts(store, warnings);
    await this.reconcileDnr(warnings);
    this.lastWarnings = warnings;
    return { store, runtime: this.runtimeStatus() };
  }

  private async reconcileUserScripts(
    store: LocalModuleStore,
    warnings: LocalModuleWarningCode[]
  ): Promise<void> {
    const scriptInstallations = Object.values(store.installations).filter(
      (installation) => installation.enabled && installation.definition.userScript.trim()
    );
    const enabledScripts = scriptInstallations.filter(
      (installation) =>
        getLocalModuleContentSafetyIssue("", installation.definition.userScript) === null
    );
    if (enabledScripts.length !== scriptInstallations.length) {
      warnings.push("unsafe-user-script");
    }
    if (this.platform === "safari") {
      if (enabledScripts.length > 0) {
        warnings.push("safari-user-script-disabled");
      }
      return;
    }
    if (!hasUserScriptsApi()) {
      if (enabledScripts.length > 0) {
        warnings.push("user-scripts-api-unavailable");
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
      warnings.push("user-scripts-permission-required");
    }
  }

  private async reconcileDnr(warnings: LocalModuleWarningCode[]): Promise<void> {
    if (!hasDeclarativeNetRequestApi()) return;
    try {
      const current = await declarativeNetRequestGetDynamicRules();
      const removeRuleIds = current
        .map((rule) => rule.id)
        .filter((id) => id >= DNR_RULE_ID_START && id <= DNR_RULE_ID_END);
      if (removeRuleIds.length === 0) return;
      await declarativeNetRequestUpdateDynamicRules({ removeRuleIds });
    } catch {
      warnings.push("legacy-dnr-cleanup-failed");
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
      declarativeNetRequest: "unsupported",
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
