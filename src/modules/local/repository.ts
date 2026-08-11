import {
  getLocalStorageArea,
  storageGet,
  storageSet,
  type StorageAreaLike
} from "../../shared/browser";
import { STORAGE_KEYS } from "../../shared/storage-keys";
import type { LocalModuleDefinition, LocalModuleStore } from "./types";
import { normalizeLocalModuleDefinition, normalizeLocalModuleStore } from "./validation";

export class LocalModuleRepository {
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: StorageAreaLike = getLocalStorageArea()) {}

  async get(): Promise<LocalModuleStore> {
    const result = await storageGet(this.area, STORAGE_KEYS.localModules);
    return normalizeLocalModuleStore(result[STORAGE_KEYS.localModules]);
  }

  async import(definition: LocalModuleDefinition, now = Date.now()): Promise<LocalModuleStore> {
    const normalized = normalizeLocalModuleDefinition(definition);
    if (!normalized) throw new Error("本地模块未通过安全校验");
    return this.update((store) => {
      const previous = store.installations[normalized.id];
      if (!previous && Object.keys(store.installations).length >= 32) {
        throw new Error("最多只能安装 32 个本地模块");
      }
      store.installations[normalized.id] = {
        definition: normalized,
        source: "local-file",
        enabled: previous?.enabled ?? false,
        importedAt: previous?.importedAt ?? now,
        updatedAt: now
      };
    });
  }

  async setEnabled(id: string, enabled: boolean, now = Date.now()): Promise<LocalModuleStore> {
    return this.update((store) => {
      const installation = store.installations[id];
      if (!installation) throw new Error("本地模块不存在");
      installation.enabled = enabled;
      installation.updatedAt = now;
    });
  }

  async remove(id: string): Promise<LocalModuleStore> {
    return this.update((store) => {
      if (!store.installations[id]) throw new Error("本地模块不存在");
      delete store.installations[id];
    });
  }

  private update(mutator: (store: LocalModuleStore) => void): Promise<LocalModuleStore> {
    const operation = async () => {
      const store = await this.get();
      mutator(store);
      const normalized = normalizeLocalModuleStore(store);
      await storageSet(this.area, { [STORAGE_KEYS.localModules]: normalized });
      return normalized;
    };
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }
}
