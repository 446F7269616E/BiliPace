import type { SectionId } from "./types";

const BILIBILI_HOST = /(^|\.)bilibili\.com$/i;

/** Classifies only the intentionally managed Bilibili discovery sections. */
export function classifyBilibiliUrl(input: string | URL): SectionId | null {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    return null;
  }

  if (!BILIBILI_HOST.test(url.hostname)) return null;
  const host = url.hostname.toLowerCase();
  const path = normalizePath(url.pathname);

  if (host === "live.bilibili.com") return "live";
  if (host === "t.bilibili.com") return "dynamic";
  if (host === "search.bilibili.com") return "search";
  if (host !== "www.bilibili.com") return null;

  const bewlyPage = url.searchParams.get("page")?.toLowerCase();
  if (bewlyPage === "search") return "search";
  if (bewlyPage === "anime") return "bangumi";
  if (bewlyPage === "moments") return "dynamic";
  if (bewlyPage === "history" || bewlyPage === "favorites" || bewlyPage === "watchlater") {
    return "video";
  }
  if (bewlyPage === "home") return "home";

  if (path === "/" || path === "/index.html") return "home";
  if (path === "/v/dynamic" || path.startsWith("/v/dynamic/") || path === "/dynamic") {
    return "dynamic";
  }
  if (path === "/v/popular" || path.startsWith("/v/popular/")) return "popular";
  if (
    path === "/video" ||
    path.startsWith("/video/") ||
    path === "/list" ||
    path.startsWith("/list/") ||
    path === "/medialist/play" ||
    path.startsWith("/medialist/play/")
  ) {
    return "video";
  }
  if (
    path === "/bangumi" ||
    path.startsWith("/bangumi/") ||
    path === "/guochuang" ||
    path.startsWith("/guochuang/") ||
    path === "/cinema" ||
    path.startsWith("/cinema/") ||
    path === "/movie" ||
    path.startsWith("/movie/") ||
    path === "/tv" ||
    path.startsWith("/tv/") ||
    path === "/documentary" ||
    path.startsWith("/documentary/")
  ) {
    return "bangumi";
  }
  return null;
}

function normalizePath(path: string): string {
  if (path === "/") return path;
  return path.replace(/\/+$/, "");
}
