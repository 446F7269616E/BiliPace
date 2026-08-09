import type {
  BilibiliImportFailure,
  BilibiliImportProvider,
  BilibiliImportResult,
  BilibiliProviderStatus,
  ImportPage,
  ImportedBilibiliVideo,
  BilibiliFavoriteFolder,
  ImportPageRequest
} from "./types";

export const BILIBILI_OPEN_PLATFORM_URL = "https://open.bilibili.com/";
export const BILIBILI_OPEN_PLATFORM_DOCS_URL = "https://openhome.bilibili.com/doc";
export const BILIBILI_LOGIN_URL = "https://passport.bilibili.com/login";

const NOT_CONFIGURED_MESSAGE =
  "稍后再看和收藏夹同步需要经哔哩哔哩开放平台审核的应用与服务端授权；当前版本请使用批量粘贴链接。";

const NOT_CONFIGURED_FAILURE: Readonly<BilibiliImportFailure> = Object.freeze({
  code: "not-configured",
  message: NOT_CONFIGURED_MESSAGE,
  actionUrl: BILIBILI_OPEN_PLATFORM_URL,
  retryable: false
});

/**
 * Safe placeholder for a future, reviewed Open Platform integration.
 *
 * It intentionally performs no fetch, reads no cookies, accepts no password,
 * stores no account identity, and never embeds an application secret. Merely
 * supplying a client id is insufficient: the official scopes and server-side
 * token exchange must be approved before a real provider replaces this one.
 */
export class BilibiliOpenPlatformProvider implements BilibiliImportProvider {
  readonly id = "bilibili-open-platform";

  async getStatus(): Promise<BilibiliProviderStatus> {
    return Promise.resolve({
      state: "not-configured",
      availableCapabilities: [],
      requestedCapabilities: ["watch-later", "favorite-folders", "favorite-media"],
      manualImportAvailable: true,
      message: NOT_CONFIGURED_MESSAGE,
      setupUrl: BILIBILI_OPEN_PLATFORM_URL,
      loginUrl: BILIBILI_LOGIN_URL
    });
  }

  async listWatchLater(
    request?: ImportPageRequest
  ): Promise<BilibiliImportResult<ImportPage<ImportedBilibiliVideo>>> {
    void request;
    return Promise.resolve(notConfigured());
  }

  async listFavoriteFolders(
    request?: ImportPageRequest
  ): Promise<BilibiliImportResult<ImportPage<BilibiliFavoriteFolder>>> {
    void request;
    return Promise.resolve(notConfigured());
  }

  async listFavoriteMedia(
    folderId: string,
    request?: ImportPageRequest
  ): Promise<BilibiliImportResult<ImportPage<ImportedBilibiliVideo>>> {
    void folderId;
    void request;
    return Promise.resolve(notConfigured());
  }
}

function notConfigured<T>(): BilibiliImportResult<T> {
  return { ok: false, error: { ...NOT_CONFIGURED_FAILURE } };
}
