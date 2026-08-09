import { getLocalStorageArea, storageAddChangeListener, storageGet } from "../../shared/browser";
import { STORAGE_KEYS } from "../../shared/storage-keys";
import { registerSiteModule } from "../registry";
import { BILIBILI_SITE_MODULE } from "./site-module";

const manifest = BILIBILI_SITE_MODULE.descriptor.manifest;
let unregister: (() => void) | null = null;
let storageRevision = 0;

storageAddChangeListener((changes, areaName) => {
  if (areaName !== "local" || !(STORAGE_KEYS.modules in changes)) return;
  storageRevision += 1;
  reconcileRegistration(changes[STORAGE_KEYS.modules]?.newValue);
});

void bootstrap();

async function bootstrap(): Promise<void> {
  const revisionBeforeRead = storageRevision;
  try {
    const stored = await storageGet(getLocalStorageArea(), STORAGE_KEYS.modules);
    if (storageRevision === revisionBeforeRead) {
      reconcileRegistration(stored[STORAGE_KEYS.modules]);
    }
  } catch {
    reconcileRegistration(undefined);
  }
}

function reconcileRegistration(value: unknown): void {
  const shouldRegister = isCurrentModuleEnabled(value);
  if (shouldRegister && !unregister) {
    unregister = registerSiteModule(BILIBILI_SITE_MODULE);
  } else if (!shouldRegister && unregister) {
    unregister();
    unregister = null;
  }
}

function isCurrentModuleEnabled(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.installations)) return false;
  const installation = value.installations[manifest.id];
  if (
    !isRecord(installation) ||
    installation.enabled !== true ||
    !isRecord(installation.manifest)
  ) {
    return false;
  }
  return (
    installation.manifest.id === manifest.id && installation.manifest.version === manifest.version
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
