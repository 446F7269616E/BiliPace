/**
 * A deliberately small boundary between the plan queue and optional Bilibili
 * imports. Account identifiers and authorization material must never cross it.
 */
export interface ImportedBilibiliVideo {
  bvid: string;
  title: string;
  url: string;
}

export interface BilibiliFavoriteFolder {
  /** Opaque provider identifier. Callers must not interpret or persist it. */
  id: string;
  title: string;
}

export interface ImportPageRequest {
  cursor?: string;
  limit?: number;
}

export interface ImportPage<T> {
  items: T[];
  nextCursor: string | null;
}

export const BILIBILI_IMPORT_CAPABILITIES = [
  "watch-later",
  "favorite-folders",
  "favorite-media"
] as const;

export type BilibiliImportCapability = (typeof BILIBILI_IMPORT_CAPABILITIES)[number];

export type BilibiliImportFailureCode =
  | "not-configured"
  | "authorization-required"
  | "unsupported-capability"
  | "temporarily-unavailable";

export interface BilibiliImportFailure {
  code: BilibiliImportFailureCode;
  message: string;
  /** A safe, first-party page the user may choose to open themselves. */
  actionUrl?: string;
  retryable: boolean;
}

export type BilibiliImportResult<T> =
  { ok: true; value: T } | { ok: false; error: BilibiliImportFailure };

export type BilibiliProviderStatus =
  | {
      state: "not-configured";
      availableCapabilities: readonly [];
      requestedCapabilities: readonly BilibiliImportCapability[];
      manualImportAvailable: true;
      message: string;
      setupUrl: string;
      loginUrl: string;
    }
  | {
      state: "authorization-required";
      availableCapabilities: readonly BilibiliImportCapability[];
      manualImportAvailable: true;
      message: string;
      authorizationUrl: string;
    }
  | {
      state: "ready";
      availableCapabilities: readonly BilibiliImportCapability[];
      manualImportAvailable: true;
    };

/**
 * Future official integrations implement this port. Implementations must use
 * documented Bilibili Open Platform authorization, keep client secrets and
 * token exchange on a trusted service, and return only the minimal fields above.
 */
export interface BilibiliImportProvider {
  readonly id: string;
  getStatus(): Promise<BilibiliProviderStatus>;
  listWatchLater(
    request?: ImportPageRequest
  ): Promise<BilibiliImportResult<ImportPage<ImportedBilibiliVideo>>>;
  listFavoriteFolders(
    request?: ImportPageRequest
  ): Promise<BilibiliImportResult<ImportPage<BilibiliFavoriteFolder>>>;
  listFavoriteMedia(
    folderId: string,
    request?: ImportPageRequest
  ): Promise<BilibiliImportResult<ImportPage<ImportedBilibiliVideo>>>;
}
