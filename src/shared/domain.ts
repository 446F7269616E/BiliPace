const COMMON_MULTI_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "com.cn",
  "net.cn",
  "org.cn",
  "gov.cn",
  "com.au",
  "net.au",
  "org.au",
  "co.jp",
  "co.kr",
  "co.nz",
  "com.hk",
  "com.sg",
  "com.tw"
]);

/**
 * Returns a stable, human-readable parent domain for local UI grouping.
 *
 * Hourleaf deliberately does not ship or fetch a public-suffix database. The
 * small allowlist covers common multi-label suffixes while preserving local and
 * IP hosts exactly. This is display grouping only and must not be used for
 * permission, cookie, origin, or other security decisions.
 */
export function getPrimaryDomain(hostname: string): string {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized === "localhost" || isIpAddress(normalized)) return normalized;
  const labels = normalized.split(".").filter(Boolean);
  if (labels.length <= 2) return normalized;
  const twoLabelSuffix = labels.slice(-2).join(".");
  return labels.slice(COMMON_MULTI_LABEL_SUFFIXES.has(twoLabelSuffix) ? -3 : -2).join(".");
}

function isIpAddress(hostname: string): boolean {
  if (hostname.includes(":")) return true;
  const segments = hostname.split(".");
  return (
    segments.length === 4 &&
    segments.every((segment) => /^\d{1,3}$/.test(segment) && Number(segment) <= 255)
  );
}
