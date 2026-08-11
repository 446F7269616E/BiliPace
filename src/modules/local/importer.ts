import {
  LOCAL_MODULE_SCHEMA_VERSION,
  type LocalModuleDefinition,
  type LocalModuleFile
} from "./types";
import { normalizeLocalModuleDefinition } from "./validation";

interface ExternalModuleManifest {
  schemaVersion?: unknown;
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  matches?: unknown;
  domainPolicy?: unknown;
  hideSelectors?: unknown;
  css?: unknown;
  cssFiles?: unknown;
  dnrRules?: unknown;
  userScript?: unknown;
  userScriptFiles?: unknown;
  capabilities?: unknown;
}

const MAX_FILES = 16;
const MAX_FILE_SIZE = 160_000;

/** Parses only bytes supplied by the local file picker; it never follows URLs. */
export function parseLocalModuleFiles(files: readonly LocalModuleFile[]): LocalModuleDefinition {
  if (files.length < 1 || files.length > MAX_FILES) throw new Error("请选择 1 到 16 个模块文件");
  const byName = new Map<string, string>();
  for (const file of files) {
    const name = file.name.trim();
    if (!name || name.length > 180 || file.text.length > MAX_FILE_SIZE || byName.has(name)) {
      throw new Error("模块文件名称重复、过长或内容过大");
    }
    byName.set(name, file.text);
  }

  const jsonFiles = files.filter((file) => file.name.toLocaleLowerCase().endsWith(".json"));
  if (jsonFiles.length > 1) throw new Error("一次只能导入一个模块清单 JSON");
  if (jsonFiles[0]) return parseManifest(jsonFiles[0].text, byName);
  return parseHeaderBasedModule(files);
}

function parseManifest(text: string, byName: ReadonlyMap<string, string>): LocalModuleDefinition {
  let manifest: ExternalModuleManifest;
  try {
    manifest = JSON.parse(text) as ExternalModuleManifest;
  } catch {
    throw new Error("模块清单不是有效的 JSON");
  }
  if (!isRecord(manifest)) throw new Error("模块清单必须是 JSON 对象");
  const css = joinSources(manifest.css, manifest.cssFiles, byName, ".css");
  const userScript = joinSources(manifest.userScript, manifest.userScriptFiles, byName, ".js");
  const normalized = normalizeLocalModuleDefinition({
    ...manifest,
    schemaVersion: LOCAL_MODULE_SCHEMA_VERSION,
    css,
    userScript
  });
  if (!normalized) throw new Error("模块清单字段无效或超出安全限制");
  return normalized;
}

function parseHeaderBasedModule(files: readonly LocalModuleFile[]): LocalModuleDefinition {
  const supported = files.filter((file) => /\.(?:css|(?:user\.)?js)$/iu.test(file.name));
  if (supported.length !== files.length) throw new Error("仅支持 .json、.css 和 .user.js 文件");
  const metadata = supported.map((file) => parseMetadata(file.text));
  const first = metadata.find((item) => item.name && item.id && item.matches.length > 0);
  if (!first) throw new Error("独立 CSS/脚本需要 @id、@name、@version 和 @match 元数据");
  const matches = [...new Set(metadata.flatMap((item) => item.matches))];
  const css = supported
    .filter((file) => file.name.toLocaleLowerCase().endsWith(".css"))
    .map((file) => file.text)
    .join("\n\n");
  const userScript = supported
    .filter((file) => file.name.toLocaleLowerCase().endsWith(".js"))
    .map((file) => file.text)
    .join("\n\n");
  const normalized = normalizeLocalModuleDefinition({
    schemaVersion: LOCAL_MODULE_SCHEMA_VERSION,
    id: first.id,
    name: first.name,
    version: first.version || "1.0.0",
    description: first.description,
    matches,
    domainPolicy: "timed",
    hideSelectors: [],
    css,
    dnrRules: [],
    userScript,
    capabilities: []
  });
  if (!normalized) throw new Error("CSS/脚本元数据无效或超出安全限制");
  return normalized;
}

function joinSources(
  inline: unknown,
  fileNames: unknown,
  byName: ReadonlyMap<string, string>,
  suffix: string
): string {
  const sources: string[] = [];
  if (inline !== undefined) {
    if (typeof inline !== "string") throw new Error("模块内联内容必须是文本");
    sources.push(inline);
  }
  if (fileNames !== undefined) {
    if (!Array.isArray(fileNames) || fileNames.length > MAX_FILES) {
      throw new Error("模块文件引用无效");
    }
    for (const fileName of fileNames) {
      if (typeof fileName !== "string" || !fileName.toLocaleLowerCase().endsWith(suffix)) {
        throw new Error("模块文件类型与清单不一致");
      }
      const source = byName.get(fileName);
      if (source === undefined) throw new Error(`缺少清单引用的文件：${fileName}`);
      sources.push(source);
    }
  }
  return sources.join("\n\n");
}

function parseMetadata(source: string): {
  id: string;
  name: string;
  version: string;
  description: string;
  matches: string[];
} {
  const values = new Map<string, string[]>();
  for (const line of source.slice(0, 12_000).split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:\/\/|\/\*+|\*)?\s*@([A-Za-z]+)\s+(.+?)\s*(?:\*\/)?$/u);
    if (!match?.[1] || !match[2]) continue;
    const key = match[1].toLocaleLowerCase();
    values.set(key, [...(values.get(key) ?? []), match[2].trim()]);
  }
  return {
    id: values.get("id")?.[0] ?? "",
    name: values.get("name")?.[0] ?? "",
    version: values.get("version")?.[0] ?? "1.0.0",
    description: values.get("description")?.[0] ?? "",
    matches: values.get("match") ?? []
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
