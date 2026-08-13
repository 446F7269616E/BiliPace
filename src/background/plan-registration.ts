import {
  permissionsContains,
  scriptingGetRegisteredContentScripts,
  scriptingRegisterContentScript,
  scriptingUnregisterContentScripts,
  type ExtensionMessageSender
} from "../shared/browser";
import { normalizePlanUrl } from "../shared/plan";
import { PlanAccessRepository, PlanQueueRepository, SettingsRepository } from "../shared/storage";

export const PLAN_CONTENT_SCRIPT_REGISTRATION_ID = "hourleaf-plan-active";

export interface PlanRegistrationRuntime {
  contains(origins: string[]): Promise<boolean>;
  list(): Promise<Array<{ id: string; matches?: string[] }>>;
  register(id: string, matches: string[]): Promise<void>;
  unregister(ids: string[]): Promise<void>;
}

const DEFAULT_RUNTIME: PlanRegistrationRuntime = {
  contains: permissionsContains,
  list: scriptingGetRegisteredContentScripts,
  register: scriptingRegisterContentScript,
  unregister: scriptingUnregisterContentScripts
};

/**
 * Owns the single dynamic content-script registration required by the active
 * plan grant. Managed-site registrations use different IDs and are never read,
 * replaced, or removed by this service.
 */
export class PlanContentRegistrationService {
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly settings = new SettingsRepository(),
    private readonly queue = new PlanQueueRepository(),
    private readonly access = new PlanAccessRepository(),
    private readonly runtime: PlanRegistrationRuntime = DEFAULT_RUNTIME,
    private readonly now: () => number = Date.now
  ) {}

  /** Verifies a direct user-granted origin before START_PLAN_ITEM can persist a grant. */
  async prepareForStart(itemId: string): Promise<void> {
    return this.enqueue(async () => {
      const item = (await this.queue.get()).items.find((candidate) => candidate.id === itemId);
      if (!item) throw new Error("Plan item not found");
      const pattern = originMatchPattern(item.url);
      if (!(await this.runtime.contains([pattern]))) {
        throw new Error("Website permission was not granted for this plan item");
      }
      await this.ensureRegistration(pattern);
    });
  }

  /** Rebuilds or removes only the fixed plan registration from persisted state. */
  async reconcile(): Promise<void> {
    return this.enqueue(async () => {
      const [settings, queue, access] = await Promise.all([
        this.settings.get(),
        this.queue.get(),
        this.access.get()
      ]);
      const grant = access.activeGrant;
      const item = grant
        ? queue.items.find(
            (candidate) => candidate.id === grant.itemId && candidate.url === grant.url
          )
        : undefined;
      const grantCanStillDecide = Boolean(
        grant &&
        (grant.flowContinuationKind === "video-end" ||
          grant.expiresAt > this.now() ||
          (grant.completionMode === "flow" && grant.flowContinuationKind === undefined))
      );
      if (!settings.planMode.enabled || !grant || !item || !grantCanStillDecide) {
        await this.clearRegistration();
        return;
      }

      const pattern = originMatchPattern(grant.url);
      if (!(await this.runtime.contains([pattern]))) {
        await this.deactivateGrant(grant.itemId, grant.url);
        await this.clearRegistration();
        return;
      }
      await this.ensureRegistration(pattern);
    });
  }

  /**
   * Website plan messages are allowed for an explicitly granted origin even
   * when that origin is not part of the focus-site configuration.
   */
  async assertAuthorizedWebsiteUrl(url: string, sender: ExtensionMessageSender): Promise<void> {
    const senderUrl = sender.url ?? sender.tab?.url;
    const requested = normalizePlanUrl(url);
    const actual = normalizePlanUrl(senderUrl);
    if (!sender.tab || !requested || !actual || requested.origin !== actual.origin) {
      throw new Error("Website plan messages cannot cross origins");
    }
    const pattern = `${requested.origin}/*`;
    if (!(await this.runtime.contains([pattern]))) {
      throw new Error("Website permission is missing for this plan item");
    }
  }

  private async ensureRegistration(pattern: string): Promise<void> {
    const current = (await this.runtime.list()).find(
      (registration) => registration.id === PLAN_CONTENT_SCRIPT_REGISTRATION_ID
    );
    if (current?.matches?.length === 1 && current.matches[0] === pattern) {
      return;
    }
    if (current) await this.runtime.unregister([PLAN_CONTENT_SCRIPT_REGISTRATION_ID]);
    await this.runtime.register(PLAN_CONTENT_SCRIPT_REGISTRATION_ID, [pattern]);
  }

  private async clearRegistration(): Promise<void> {
    const current = (await this.runtime.list()).some(
      (registration) => registration.id === PLAN_CONTENT_SCRIPT_REGISTRATION_ID
    );
    if (current) await this.runtime.unregister([PLAN_CONTENT_SCRIPT_REGISTRATION_ID]);
  }

  private async deactivateGrant(itemId: string, url: string): Promise<void> {
    let cleared = false;
    await this.access.update((store) => {
      if (store.activeGrant?.itemId !== itemId || store.activeGrant.url !== url) return;
      delete store.activeGrant;
      cleared = true;
    });
    if (cleared) await this.settings.update({ planMode: { enabled: false } });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }
}

function originMatchPattern(url: string): string {
  const parsed = normalizePlanUrl(url);
  if (!parsed) throw new Error("Invalid plan URL");
  return `${parsed.origin}/*`;
}
