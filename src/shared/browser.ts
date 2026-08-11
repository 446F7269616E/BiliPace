/**
 * Minimal WebExtensions compatibility layer. It deliberately uses the common
 * browser/chrome API subset and hides Firefox Promise vs Chromium callback APIs.
 */

export interface ExtensionEvent<Listener extends (...args: never[]) => unknown> {
  addListener(listener: Listener): void;
  removeListener?(listener: Listener): void;
}

export interface StorageAreaLike {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void
  ): unknown;
  set(items: Record<string, unknown>, callback?: () => void): unknown;
  remove?(keys: string | string[], callback?: () => void): unknown;
}

export interface StorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface ExtensionTab {
  id?: number;
  active?: boolean;
  windowId?: number;
  url?: string;
}

export interface ExtensionMessageSender {
  id?: string;
  url?: string;
  tab?: ExtensionTab;
}

export interface ExtensionApi {
  runtime: {
    id?: string;
    lastError?: { message?: string };
    sendMessage(message: unknown, callback?: (response: unknown) => void): unknown;
    getURL?(path: string): string;
    openOptionsPage?(callback?: () => void): unknown;
    onMessage: ExtensionEvent<
      (
        message: unknown,
        sender: ExtensionMessageSender,
        sendResponse: (response: unknown) => void
      ) => boolean | void | Promise<unknown>
    >;
  };
  storage: {
    local: StorageAreaLike;
    sync?: StorageAreaLike;
    onChanged?: ExtensionEvent<
      (changes: Record<string, StorageChangeLike>, areaName: string) => void
    >;
  };
  tabs?: {
    query(queryInfo: Record<string, unknown>, callback?: (tabs: ExtensionTab[]) => void): unknown;
    get?(tabId: number, callback?: (tab: ExtensionTab) => void): unknown;
    onActivated?: ExtensionEvent<(activeInfo: { tabId: number; windowId: number }) => void>;
    onUpdated?: ExtensionEvent<
      (tabId: number, changeInfo: { url?: string; status?: string }, tab: ExtensionTab) => void
    >;
    onRemoved?: ExtensionEvent<(tabId: number) => void>;
  };
  windows?: {
    WINDOW_ID_NONE?: number;
    onFocusChanged?: ExtensionEvent<(windowId: number) => void>;
  };
  idle?: {
    setDetectionInterval?(seconds: number): void;
    queryState?(seconds: number, callback?: (state: "active" | "idle" | "locked") => void): unknown;
    onStateChanged?: ExtensionEvent<(state: "active" | "idle" | "locked") => void>;
  };
  permissions?: {
    contains?(
      permissions: { origins?: string[]; permissions?: string[] },
      callback?: (result: boolean) => void
    ): unknown;
    request?(
      permissions: { origins?: string[]; permissions?: string[] },
      callback?: (granted: boolean) => void
    ): unknown;
    remove?(
      permissions: { origins?: string[]; permissions?: string[] },
      callback?: (removed: boolean) => void
    ): unknown;
  };
  scripting?: {
    registerContentScripts?(
      scripts: Array<{
        id: string;
        matches: string[];
        js: string[];
        runAt?: "document_start" | "document_end" | "document_idle";
        persistAcrossSessions?: boolean;
      }>,
      callback?: () => void
    ): unknown;
    unregisterContentScripts?(filter?: { ids?: string[] }, callback?: () => void): unknown;
    getRegisteredContentScripts?(
      filter?: { ids?: string[] },
      callback?: (scripts: Array<{ id: string; matches?: string[] }>) => void
    ): unknown;
  };
  userScripts?: {
    register(
      scripts: Array<{
        id: string;
        matches: string[];
        js: Array<{ code: string }>;
        runAt?: "document_start" | "document_end" | "document_idle";
        world?: "USER_SCRIPT" | "MAIN";
        allFrames?: boolean;
      }>,
      callback?: () => void
    ): unknown;
    unregister(filter?: { ids?: string[] }, callback?: () => void): unknown;
    getScripts?(
      filter?: { ids?: string[] },
      callback?: (scripts: Array<{ id: string }>) => void
    ): unknown;
  };
  declarativeNetRequest?: {
    getDynamicRules(
      filter?: { ruleIds?: number[] },
      callback?: (rules: Array<{ id: number }>) => void
    ): unknown;
    updateDynamicRules(
      update: {
        removeRuleIds?: number[];
        addRules?: Array<{
          id: number;
          priority: number;
          action: { type: "block" | "allow" | "upgradeScheme" };
          condition: {
            urlFilter: string;
            initiatorDomains: string[];
            resourceTypes: string[];
          };
        }>;
      },
      callback?: () => void
    ): unknown;
  };
}

type ApiMode = "promise" | "callback";

interface ApiContext {
  api: ExtensionApi;
  mode: ApiMode;
}

export function getExtensionApi(): ExtensionApi | null {
  return getApiContext()?.api ?? null;
}

export function getSettingsStorageArea(): StorageAreaLike {
  return requireApi().storage.local;
}

export function getLocalStorageArea(): StorageAreaLike {
  return requireApi().storage.local;
}

export async function storageGet(
  area: StorageAreaLike,
  keys?: string | string[] | Record<string, unknown> | null
): Promise<Record<string, unknown>> {
  const context = requireContext();
  if (context.mode === "promise") {
    return (await area.get(keys)) as Record<string, unknown>;
  }
  return callbackResult<Record<string, unknown>>((resolve) => area.get(keys, resolve));
}

export async function storageSet(
  area: StorageAreaLike,
  items: Record<string, unknown>
): Promise<void> {
  const context = requireContext();
  if (context.mode === "promise") {
    await area.set(items);
    return;
  }
  await callbackVoid((resolve) => area.set(items, resolve));
}

export async function storageRemove(area: StorageAreaLike, keys: string | string[]): Promise<void> {
  if (!area.remove) return;
  const context = requireContext();
  if (context.mode === "promise") {
    await area.remove(keys);
    return;
  }
  await callbackVoid((resolve) => area.remove?.(keys, resolve));
}

export function storageAddChangeListener(
  listener: (changes: Record<string, StorageChangeLike>, areaName: string) => void
): () => void {
  const event = requireContext().api.storage.onChanged;
  if (!event) return () => undefined;
  event.addListener(listener);
  return () => event.removeListener?.(listener);
}

export async function runtimeSendMessage<T>(message: unknown): Promise<T> {
  const context = requireContext();
  if (context.mode === "promise") return (await context.api.runtime.sendMessage(message)) as T;
  return callbackResult<T>((resolve) =>
    context.api.runtime.sendMessage(message, (response) => resolve(response as T))
  );
}

/**
 * Registers one async handler using the native contract of each WebExtensions
 * implementation. Firefox and Safari consume the returned Promise; Chromium
 * requires the callback channel to remain open synchronously.
 */
export function runtimeAddMessageListener(
  handler: (message: unknown, sender: ExtensionMessageSender) => Promise<unknown>
): void {
  const context = requireContext();
  if (context.mode === "promise") {
    context.api.runtime.onMessage.addListener((message, sender) => handler(message, sender));
    return;
  }
  context.api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    void handler(message, sender).then(sendResponse, () => sendResponse(undefined));
    return true;
  });
}

export function runtimeGetURL(path: string): string {
  const runtime = requireContext().api.runtime;
  if (!runtime.getURL) return path;
  return runtime.getURL(path);
}

export async function runtimeOpenOptionsPage(): Promise<void> {
  const context = requireContext();
  const runtime = context.api.runtime;
  if (!runtime.openOptionsPage) {
    throw new Error("This browser does not expose an extension options page API");
  }
  if (context.mode === "promise") {
    await runtime.openOptionsPage();
    return;
  }
  await callbackVoid((resolve) => runtime.openOptionsPage?.(resolve));
}

export async function tabsQuery(queryInfo: Record<string, unknown>): Promise<ExtensionTab[]> {
  const context = requireContext();
  if (!context.api.tabs) return [];
  if (context.mode === "promise")
    return (await context.api.tabs.query(queryInfo)) as ExtensionTab[];
  return callbackResult<ExtensionTab[]>((resolve) => context.api.tabs?.query(queryInfo, resolve));
}

export async function tabsGet(tabId: number): Promise<ExtensionTab | null> {
  const context = requireContext();
  const tabs = context.api.tabs;
  if (!tabs?.get) return null;
  if (context.mode === "promise") return (await tabs.get(tabId)) as ExtensionTab;
  return callbackResult<ExtensionTab>((resolve) => tabs.get?.(tabId, resolve));
}

export async function idleQueryState(
  detectionIntervalSeconds: number
): Promise<"active" | "idle" | "locked" | "unsupported"> {
  const context = requireContext();
  const idle = context.api.idle;
  if (!idle?.queryState) return "unsupported";
  if (context.mode === "promise") {
    return (await idle.queryState(detectionIntervalSeconds)) as "active" | "idle" | "locked";
  }
  return callbackResult<"active" | "idle" | "locked">((resolve) =>
    idle.queryState?.(detectionIntervalSeconds, resolve)
  );
}

export async function permissionsContains(origins: string[]): Promise<boolean> {
  const context = requireContext();
  const permissions = context.api.permissions;
  if (!permissions?.contains) return false;
  if (context.mode === "promise") {
    return Boolean(await permissions.contains({ origins }));
  }
  return callbackResult<boolean>((resolve) => permissions.contains?.({ origins }, resolve));
}

/** Must be called directly from an extension-page user gesture. */
export async function permissionsRequest(origins: string[]): Promise<boolean> {
  const context = requireContext();
  const permissions = context.api.permissions;
  if (!permissions?.request) return false;
  if (context.mode === "promise") {
    return Boolean(await permissions.request({ origins }));
  }
  return callbackResult<boolean>((resolve) => permissions.request?.({ origins }, resolve));
}

export async function permissionsRemove(origins: string[]): Promise<boolean> {
  const context = requireContext();
  const permissions = context.api.permissions;
  if (!permissions?.remove) return false;
  if (context.mode === "promise") {
    return Boolean(await permissions.remove({ origins }));
  }
  return callbackResult<boolean>((resolve) => permissions.remove?.({ origins }, resolve));
}

export async function scriptingRegisterContentScript(
  id: string,
  matches: string[],
  js = "content.js"
): Promise<void> {
  const context = requireContext();
  const scripting = context.api.scripting;
  if (!scripting?.registerContentScripts) {
    throw new Error("Dynamic content script registration is unavailable");
  }
  const scripts = [
    {
      id,
      matches,
      js: [js],
      runAt: "document_start" as const,
      persistAcrossSessions: true
    }
  ];
  if (context.mode === "promise") {
    await scripting.registerContentScripts(scripts);
    return;
  }
  await callbackVoid((resolve) => scripting.registerContentScripts?.(scripts, resolve));
}

export async function scriptingUnregisterContentScripts(ids?: string[]): Promise<void> {
  const context = requireContext();
  const scripting = context.api.scripting;
  if (!scripting?.unregisterContentScripts) return;
  const filter = ids ? { ids } : undefined;
  if (context.mode === "promise") {
    await scripting.unregisterContentScripts(filter);
    return;
  }
  await callbackVoid((resolve) => scripting.unregisterContentScripts?.(filter, resolve));
}

export async function scriptingGetRegisteredContentScripts(): Promise<
  Array<{ id: string; matches?: string[] }>
> {
  const context = requireContext();
  const scripting = context.api.scripting;
  if (!scripting?.getRegisteredContentScripts) return [];
  if (context.mode === "promise") {
    return (await scripting.getRegisteredContentScripts({})) as Array<{
      id: string;
      matches?: string[];
    }>;
  }
  return callbackResult((resolve) => scripting.getRegisteredContentScripts?.({}, resolve));
}

export function hasUserScriptsApi(): boolean {
  return Boolean(getApiContext()?.api.userScripts);
}

export async function userScriptsGetRegistered(): Promise<Array<{ id: string }>> {
  const context = requireContext();
  const userScripts = context.api.userScripts;
  if (!userScripts?.getScripts) return [];
  if (context.mode === "promise") {
    return (await userScripts.getScripts({})) as Array<{ id: string }>;
  }
  return callbackResult((resolve) => userScripts.getScripts?.({}, resolve));
}

export async function userScriptsRegister(
  scripts: Array<{
    id: string;
    matches: string[];
    js: Array<{ code: string }>;
    runAt: "document_idle";
    world: "USER_SCRIPT";
    allFrames: false;
  }>
): Promise<void> {
  const context = requireContext();
  const userScripts = context.api.userScripts;
  if (!userScripts) throw new Error("User Scripts API is unavailable");
  if (context.mode === "promise") {
    await userScripts.register(scripts);
    return;
  }
  await callbackVoid((resolve) => userScripts.register(scripts, resolve));
}

export async function userScriptsUnregister(ids?: string[]): Promise<void> {
  const context = requireContext();
  const userScripts = context.api.userScripts;
  if (!userScripts) return;
  const filter = ids ? { ids } : undefined;
  if (context.mode === "promise") {
    await userScripts.unregister(filter);
    return;
  }
  await callbackVoid((resolve) => userScripts.unregister(filter, resolve));
}

export function hasDeclarativeNetRequestApi(): boolean {
  return Boolean(getApiContext()?.api.declarativeNetRequest);
}

export async function declarativeNetRequestGetDynamicRules(): Promise<Array<{ id: number }>> {
  const context = requireContext();
  const dnr = context.api.declarativeNetRequest;
  if (!dnr) return [];
  if (context.mode === "promise") {
    return (await dnr.getDynamicRules()) as Array<{ id: number }>;
  }
  return callbackResult((resolve) => dnr.getDynamicRules(undefined, resolve));
}

export async function declarativeNetRequestUpdateDynamicRules(update: {
  removeRuleIds?: number[];
  addRules?: Array<{
    id: number;
    priority: number;
    action: { type: "block" | "allow" | "upgradeScheme" };
    condition: { urlFilter: string; initiatorDomains: string[]; resourceTypes: string[] };
  }>;
}): Promise<void> {
  const context = requireContext();
  const dnr = context.api.declarativeNetRequest;
  if (!dnr) throw new Error("Declarative Net Request API is unavailable");
  if (context.mode === "promise") {
    await dnr.updateDynamicRules(update);
    return;
  }
  await callbackVoid((resolve) => dnr.updateDynamicRules(update, resolve));
}

function requireApi(): ExtensionApi {
  return requireContext().api;
}

function requireContext(): ApiContext {
  const context = getApiContext();
  if (!context) throw new Error("WebExtensions API is unavailable in this context");
  return context;
}

function getApiContext(): ApiContext | null {
  const globals = globalThis as typeof globalThis & {
    browser?: ExtensionApi;
    chrome?: ExtensionApi;
  };
  if (globals.browser?.runtime && globals.browser.storage) {
    return { api: globals.browser, mode: "promise" };
  }
  if (globals.chrome?.runtime && globals.chrome.storage) {
    return { api: globals.chrome, mode: "callback" };
  }
  return null;
}

function callbackResult<T>(register: (resolve: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    register((value) => {
      const error = getExtensionApi()?.runtime.lastError;
      if (error) reject(new Error(error.message || "WebExtensions API request failed"));
      else resolve(value);
    });
  });
}

function callbackVoid(register: (resolve: () => void) => void): Promise<void> {
  return callbackResult<void>((resolve) => register(() => resolve()));
}
