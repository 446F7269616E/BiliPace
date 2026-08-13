import {
  getSessionStorageArea,
  storageGet,
  storageSet,
  type StorageAreaLike
} from "../shared/browser";

const STORAGE_KEY = "hourleaf.visit-confirmation.v1";
const SCHEMA_VERSION = 1 as const;

interface VisitGrant {
  siteId: string;
  origin: string;
  policyVersion: number;
  requiredAt: number;
  confirmedAt?: number;
}

interface VisitGrantStore {
  schemaVersion: typeof SCHEMA_VERSION;
  byTab: Record<string, VisitGrant>;
}

/**
 * Keeps a confirmation valid only for one tab's continuous stay on one origin.
 * `storage.session` makes the grant resilient to MV3 worker suspension without
 * carrying it into another browser session. Browsers without that API use the
 * background page's in-memory store.
 */
export class VisitConfirmationService {
  private readonly area: StorageAreaLike | null;
  private readonly memory: VisitGrantStore = { schemaVersion: SCHEMA_VERSION, byTab: {} };
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(area: StorageAreaLike | null = getSessionStorageArea()) {
    this.area = area;
  }

  async isGranted(
    tabId: number,
    siteId: string,
    origin: string,
    policyVersion: number
  ): Promise<boolean> {
    const grant = (await this.read()).byTab[String(tabId)];
    return (
      grant?.siteId === siteId &&
      grant.origin === normalizeOrigin(origin) &&
      grant.policyVersion === policyVersion &&
      grant.confirmedAt !== undefined
    );
  }

  async requireConfirmation(
    tabId: number,
    siteId: string,
    origin: string,
    policyVersion: number,
    waitSeconds: number,
    now = Date.now()
  ): Promise<number> {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) throw new Error("Invalid confirmation origin");
    let requiredAt = now;
    await this.update((store) => {
      const current = store.byTab[String(tabId)];
      if (
        current?.siteId === siteId &&
        current.origin === normalizedOrigin &&
        current.policyVersion === policyVersion &&
        current.confirmedAt === undefined
      ) {
        requiredAt = current.requiredAt;
        return;
      }
      store.byTab[String(tabId)] = {
        siteId,
        origin: normalizedOrigin,
        policyVersion,
        requiredAt: now
      };
    });
    return Math.max(0, Math.ceil((requiredAt + waitSeconds * 1_000 - now) / 1_000));
  }

  async grant(
    tabId: number,
    siteId: string,
    origin: string,
    policyVersion: number,
    waitSeconds: number,
    now = Date.now()
  ): Promise<void> {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) throw new Error("Invalid confirmation origin");
    await this.update((store) => {
      const current = store.byTab[String(tabId)];
      if (
        current?.siteId !== siteId ||
        current.origin !== normalizedOrigin ||
        current.policyVersion !== policyVersion
      ) {
        throw new Error("This visit confirmation is no longer available");
      }
      if (now < current.requiredAt + waitSeconds * 1_000) {
        throw new Error("The visit confirmation wait has not finished");
      }
      current.confirmedAt = now;
    });
  }

  async revokeTab(tabId: number): Promise<void> {
    await this.update((store) => {
      delete store.byTab[String(tabId)];
    });
  }

  async revokeIfOriginChanged(
    tabId: number,
    nextUrl: string,
    extensionRoot: string
  ): Promise<void> {
    if (extensionRoot && nextUrl.startsWith(extensionRoot)) return;
    const nextOrigin = normalizeOrigin(nextUrl);
    const grant = (await this.read()).byTab[String(tabId)];
    if (grant && grant.origin !== nextOrigin) await this.revokeTab(tabId);
  }

  private async read(): Promise<VisitGrantStore> {
    if (!this.area) return cloneStore(this.memory);
    const result = await storageGet(this.area, STORAGE_KEY);
    return normalizeStore(result[STORAGE_KEY]);
  }

  private async update(mutator: (store: VisitGrantStore) => void): Promise<void> {
    const operation = async () => {
      const store = await this.read();
      mutator(store);
      if (this.area) await storageSet(this.area, { [STORAGE_KEY]: store });
      else {
        this.memory.schemaVersion = SCHEMA_VERSION;
        this.memory.byTab = cloneStore(store).byTab;
      }
    };
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    await result;
  }
}

function normalizeStore(value: unknown): VisitGrantStore {
  const store: VisitGrantStore = { schemaVersion: SCHEMA_VERSION, byTab: {} };
  if (!isRecord(value) || !isRecord(value.byTab)) return store;
  for (const [tabId, raw] of Object.entries(value.byTab).slice(0, 512)) {
    if (!/^\d{1,10}$/u.test(tabId) || !isRecord(raw)) continue;
    const origin = normalizeOrigin(raw.origin);
    if (
      !origin ||
      typeof raw.siteId !== "string" ||
      raw.siteId.length < 1 ||
      raw.siteId.length > 128 ||
      typeof raw.requiredAt !== "number" ||
      !Number.isSafeInteger(raw.requiredAt) ||
      raw.requiredAt < 0 ||
      typeof raw.policyVersion !== "number" ||
      !Number.isSafeInteger(raw.policyVersion) ||
      raw.policyVersion < 0 ||
      (raw.confirmedAt !== undefined &&
        (typeof raw.confirmedAt !== "number" ||
          !Number.isSafeInteger(raw.confirmedAt) ||
          raw.confirmedAt < raw.requiredAt))
    ) {
      continue;
    }
    store.byTab[tabId] = {
      siteId: raw.siteId,
      origin,
      policyVersion: raw.policyVersion,
      requiredAt: raw.requiredAt,
      ...(typeof raw.confirmedAt === "number" ? { confirmedAt: raw.confirmedAt } : {})
    };
  }
  return store;
}

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function cloneStore(store: VisitGrantStore): VisitGrantStore {
  return {
    schemaVersion: SCHEMA_VERSION,
    byTab: Object.fromEntries(
      Object.entries(store.byTab).map(([tabId, grant]) => [tabId, { ...grant }])
    )
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
