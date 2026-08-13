import {
  LOCAL_MODULE_FORMAT,
  LOCAL_MODULE_IMPORT_RISK_CODE,
  LOCAL_MODULE_SCHEMA_VERSION,
  type LocalModuleDefinition,
  type LocalModuleFile,
  type LocalModuleImportErrorCode,
  type LocalModuleImportPreview
} from "./types";
import { getLocalModuleContentSafetyIssue, normalizeLocalModuleDefinition } from "./validation";

interface ExternalModuleManifest {
  schemaVersion?: unknown;
  format?: unknown;
  id?: unknown;
  name?: unknown;
  author?: unknown;
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
const SUPPORTED_FILE_NAME = /(?:\.json|\.css|\.user\.js)$/iu;

export class LocalModuleImportError extends Error {
  readonly recoverable = true;

  constructor(
    readonly code: LocalModuleImportErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LocalModuleImportError";
  }
}

/** Parses only bytes supplied by the local file picker; it never follows URLs. */
export function parseLocalModuleFiles(files: readonly LocalModuleFile[]): LocalModuleDefinition {
  if (files.length < 1) fail("selection-required", "请选择模块文件。");
  if (files.length > MAX_FILES) fail("file-limit-exceeded", "一次最多导入 16 个文件。");
  const byName = new Map<string, string>();
  const normalizedFiles: LocalModuleFile[] = [];
  const comparableNames = new Set<string>();
  for (const file of files) {
    const name = file.name.trim();
    if (!name || name.length > 180 || file.text.length > MAX_FILE_SIZE) {
      fail("invalid-file", "文件名无效或文件过大。");
    }
    if (!SUPPORTED_FILE_NAME.test(name)) {
      fail("unsupported-file-type", "仅支持 .json、.css 和 .user.js 文件。");
    }
    const comparableName = name.toLocaleLowerCase();
    if (comparableNames.has(comparableName)) fail("duplicate-file", "请移除同名的模块文件。");
    comparableNames.add(comparableName);
    byName.set(name, file.text);
    normalizedFiles.push({ name, text: file.text });
  }

  const jsonFiles = normalizedFiles.filter((file) =>
    file.name.toLocaleLowerCase().endsWith(".json")
  );
  if (jsonFiles.length > 1) fail("multiple-manifests", "一次只能导入一个 JSON 清单。");
  if (jsonFiles[0]) return parseManifest(jsonFiles[0].text, byName);
  return parseHeaderBasedModule(normalizedFiles);
}

export function createLocalModuleImportPreview(
  definition: LocalModuleDefinition
): LocalModuleImportPreview {
  return {
    id: definition.id,
    name: definition.name,
    author: definition.author,
    format: definition.format,
    version: definition.version,
    matches: [...definition.matches],
    capabilities: [...definition.capabilities],
    hasUserScript: Boolean(definition.userScript.trim()),
    riskDisclosure: {
      code: LOCAL_MODULE_IMPORT_RISK_CODE,
      acknowledgementRequired: true
    }
  };
}

function parseManifest(text: string, byName: ReadonlyMap<string, string>): LocalModuleDefinition {
  let manifest: ExternalModuleManifest;
  try {
    manifest = JSON.parse(text) as ExternalModuleManifest;
  } catch {
    fail("invalid-json", "JSON 清单格式无效。");
  }
  if (!isRecord(manifest)) fail("invalid-manifest", "模块清单必须是 JSON 对象。");
  assertAuthorAndFormat(manifest.author, manifest.format);
  if (Array.isArray(manifest.dnrRules) && manifest.dnrRules.length > 0) {
    fail("unsupported-dnr", "精确来源模块不支持声明式网络规则。");
  }
  const css = joinSources(manifest.css, manifest.cssFiles, byName, ".css");
  const userScript = joinSources(manifest.userScript, manifest.userScriptFiles, byName, ".user.js");
  assertContentSafety(css, userScript);
  const normalized = normalizeLocalModuleDefinition({
    ...manifest,
    css,
    userScript
  });
  if (!normalized) fail("invalid-manifest", "模块清单字段无效或超出限制。");
  return normalized;
}

function parseHeaderBasedModule(files: readonly LocalModuleFile[]): LocalModuleDefinition {
  const metadata = files.map((file) => parseMetadata(file.text));
  if (
    metadata.some((item) => !item.name || !item.id || !item.version || item.matches.length === 0)
  ) {
    fail("metadata-required", "每个独立文件都需要完整的模块元数据。");
  }
  const first = metadata[0];
  if (!first) fail("metadata-required", "独立文件需要模块元数据。");
  for (const item of metadata) {
    assertAuthorAndFormat(item.author, item.format);
    if (
      item.id !== first.id ||
      item.name !== first.name ||
      item.version !== first.version ||
      item.author !== first.author ||
      item.format !== first.format
    ) {
      fail("metadata-conflict", "所选文件的模块元数据必须一致。");
    }
  }
  const matches = [...new Set(metadata.flatMap((item) => item.matches))];
  const css = files
    .filter((file) => file.name.toLocaleLowerCase().endsWith(".css"))
    .map((file) => file.text)
    .join("\n\n");
  const userScript = files
    .filter((file) => file.name.toLocaleLowerCase().endsWith(".user.js"))
    .map((file) => file.text)
    .join("\n\n");
  assertContentSafety(css, userScript);
  const normalized = normalizeLocalModuleDefinition({
    schemaVersion: LOCAL_MODULE_SCHEMA_VERSION,
    format: first.format,
    id: first.id,
    name: first.name,
    author: first.author,
    version: first.version,
    description: first.description,
    matches,
    domainPolicy: "timed",
    hideSelectors: [],
    css,
    dnrRules: [],
    userScript,
    capabilities: []
  });
  if (!normalized) fail("invalid-manifest", "CSS/脚本元数据无效或超出限制。");
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
    if (typeof inline !== "string") fail("invalid-reference", "模块内联内容必须是文本。");
    sources.push(inline);
  }
  if (fileNames !== undefined) {
    if (!Array.isArray(fileNames) || fileNames.length > MAX_FILES) {
      fail("invalid-reference", "模块文件引用无效。");
    }
    for (const fileName of fileNames) {
      if (typeof fileName !== "string" || !fileName.toLocaleLowerCase().endsWith(suffix)) {
        fail("invalid-reference", "模块文件类型与清单不一致。");
      }
      const source = byName.get(fileName);
      if (source === undefined) fail("missing-reference", `请同时选择文件：${fileName}`);
      sources.push(source);
    }
  }
  return sources.join("\n\n");
}

function parseMetadata(source: string): {
  id: string;
  name: string;
  author: string;
  format: string;
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
    author: values.get("author")?.[0] ?? "",
    format: values.get("format")?.[0] ?? "",
    version: values.get("version")?.[0] ?? "",
    description: values.get("description")?.[0] ?? "",
    matches: values.get("match") ?? []
  };
}

function assertAuthorAndFormat(author: unknown, format: unknown): void {
  const cleanAuthor =
    typeof author === "string"
      ? [...author]
          .map((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
          })
          .join("")
          .trim()
      : "";
  if (typeof author !== "string" || !cleanAuthor || author.length > 100) {
    fail("author-required", "请填写有效的模块作者名称。");
  }
  if (format === undefined || format === null || format === "") {
    fail("format-required", `请声明内容格式 ${LOCAL_MODULE_FORMAT}。`);
  }
  if (format !== LOCAL_MODULE_FORMAT) {
    fail("unsupported-format", `仅支持内容格式 ${LOCAL_MODULE_FORMAT}。`);
  }
}

function assertContentSafety(css: string, userScript: string): void {
  const issue = getLocalModuleContentSafetyIssue(css, userScript);
  if (issue === "css-external-resource") {
    fail("unsafe-css", "CSS 必须自包含，请移除外部资源引用。");
  }
  if (issue) {
    fail("unsafe-user-script", "脚本含不支持的高风险功能，请移除后重试。");
  }
}

function fail(code: LocalModuleImportErrorCode, message: string): never {
  throw new LocalModuleImportError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
