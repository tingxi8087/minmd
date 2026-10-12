import type { JSONContent } from "@tiptap/core";
import type { DemoImportEntry } from "@/api/demoImport";
import { getPresentation } from "@/utils/presentationFiles";
import { getSpreadsheet } from "@/utils/spreadsheetStorage";
import { assetsApi, type Asset } from "@/api/assets";
import { samples } from "@/views/Document/content";
import { parseMarkdownDocument } from "@/views/Document/utils/markdownImport";
import { importXlsx } from "@/views/Spreadsheet/exchange";
export type LocalEntry = {
  id: string;
  name: string;
  kind: DemoImportEntry["kind"];
  space: string;
  parent: string | null;
  document?: JSONContent;
  content?: string;
  presentation?: { key: string };
};
export type MissingAsset = {
  key: string;
  oldId: string;
  label: string;
  kind: "image" | "slide" | "sheet";
};
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));
/** 只读取文件白名单，不读取旧分享密码、API密钥或账号身份。 */
export function readDemoSource(raw: string | null): LocalEntry[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  const state = record(parsed) && record(parsed.state) ? parsed.state : parsed;
  if (!record(state) || !Array.isArray(state.files))
    throw new Error("旧演示备份格式无效");
  return state.files
    .filter(
      (value): value is Record<string, unknown> =>
        record(value) && !value.deleted,
    )
    .map((value) => {
      if (
        typeof value.id !== "string" ||
        typeof value.name !== "string" ||
        typeof value.space !== "string" ||
        !["doc", "sheet", "slide", "folder"].includes(String(value.kind))
      )
        throw new Error("旧文件元数据不完整");
      return {
        id: value.id,
        name: value.name,
        kind: value.kind as LocalEntry["kind"],
        space: value.space,
        parent: typeof value.parent === "string" ? value.parent : null,
        ...(record(value.document)
          ? { document: value.document as JSONContent }
          : {}),
        ...(typeof value.content === "string"
          ? { content: value.content }
          : {}),
        ...(record(value.presentation) &&
        typeof value.presentation.key === "string"
          ? { presentation: { key: value.presentation.key } }
          : {}),
      };
    });
}
export type ImportTask = {
  key: string;
  userId: string;
  target: string;
  sourceHash: string;
  source: string;
  assets: Record<string, Asset>;
  jobId?: string;
};
export async function sourceHash(entries: LocalEntry[]) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(entries)),
  );
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
export function dataImage(src: string, name: string): File | undefined {
  const match = src.match(
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-zA-Z0-9+/=\s]+)$/,
  );
  if (!match) return;
  const decoded = atob(match[2]);
  if (decoded.length > 1024 * 1024)
    throw new Error("旧图片超过1MB，需要替换为较小图片");
  return new File(
    [Uint8Array.from(decoded, (value) => value.charCodeAt(0))],
    name,
    { type: match[1] },
  );
}
type Dependencies = {
  presentation: typeof getPresentation;
  sheet: typeof getSpreadsheet;
  upload: typeof assetsApi.upload;
  parse: typeof parseMarkdownDocument;
  xlsx: typeof importXlsx;
};
export type ImportBoundary = { signal: AbortSignal; assertActive: () => void };
export async function awaitImport<T>(
  boundary: ImportBoundary,
  operation: () => Promise<T>,
): Promise<T> {
  boundary.assertActive();
  const result = await operation();
  boundary.assertActive();
  return result;
}
export function createImportBoundary(
  readScope: () => { userId?: string; spaceId: string },
) {
  const scope = readScope();
  const controller = new AbortController();
  return {
    controller,
    signal: controller.signal,
    assertActive() {
      const current = readScope();
      if (current.userId !== scope.userId || current.spaceId !== scope.spaceId)
        controller.abort();
      controller.signal.throwIfAborted();
    },
  };
}
export async function prepareDemoEntries(
  entries: LocalEntry[],
  task: ImportTask,
  replacements: Map<string, File>,
  saveTask: (task: ImportTask) => void,
  progress: (name: string) => void,
  dependencies: Dependencies = {
    presentation: getPresentation,
    sheet: getSpreadsheet,
    upload: assetsApi.upload,
    parse: parseMarkdownDocument,
    xlsx: importXlsx,
  },
  boundary?: ImportBoundary,
) {
  const active = () => boundary?.assertActive();
  const awaited = async <T>(operation: () => Promise<T>): Promise<T> => {
    active();
    const result = await operation();
    active();
    return result;
  };
  active();
  const missing: MissingAsset[] = [];
  const output: DemoImportEntry[] = [];
  const ids = new Set(entries.map((entry) => entry.id));
  const upload = async (key: string, file: File) => {
    active();
    if (task.assets[key]) return task.assets[key];
    const asset = await awaited(() =>
      dependencies.upload(task.target, file, boundary?.signal),
    );
    task.assets[key] = asset;
    saveTask(task);
    return asset;
  };
  for (const entry of entries) {
    active();
    progress(entry.name);
    const next: DemoImportEntry = {
      oldId: entry.id,
      name: entry.name,
      kind: entry.kind,
      parentOldId: entry.parent && ids.has(entry.parent) ? entry.parent : null,
    };
    const fail = (key: string, kind: MissingAsset["kind"], label: string) => {
      next.missingAssets = true;
      missing.push({ key, kind, label, oldId: entry.id });
    };
    if (entry.kind === "doc") {
      const projection = structuredClone(
        entry.document ??
          dependencies.parse(entry.content ?? samples[entry.id] ?? ""),
      );
      let index = 0;
      const images: JSONContent[] = [];
      const walk = (node: JSONContent) => {
        if (node.type === "image") images.push(node);
        node.content?.forEach(walk);
      };
      walk(projection);
      for (const image of images) {
        const key = `${entry.id}:image:${index++}`;
        try {
          const file =
            replacements.get(key) ??
            dataImage(
              String(image.attrs?.src ?? ""),
              `${entry.name}-${index}.png`,
            );
          const asset =
            task.assets[key] ?? (file ? await upload(key, file) : undefined);
          if (!asset) {
            fail(key, "image", `${entry.name} · 图片 ${index}（原附件缺失）`);
            continue;
          }
          image.attrs = { ...image.attrs, assetId: asset.id, src: asset.url };
        } catch (error) {
          active();
          fail(
            key,
            "image",
            `${entry.name} · 图片 ${index}：${error instanceof Error ? error.message : "上传失败"}`,
          );
        }
      }
      next.projection = projection;
    } else if (entry.kind === "slide") {
      const key = `${entry.id}:slide`;
      try {
        const file =
          replacements.get(key) ??
          (await awaited(() =>
            dependencies.presentation(entry.presentation?.key ?? entry.id),
          ));
        const asset =
          task.assets[key] ?? (file ? await upload(key, file) : undefined);
        if (!asset) fail(key, "slide", `${entry.name} · 原 PPTX 缺失`);
        else
          next.projection = {
            assetId: asset.id,
            name: asset.filename,
            size: asset.size,
            slides: asset.slides,
          };
      } catch (error) {
        active();
        fail(
          key,
          "slide",
          `${entry.name}：${error instanceof Error ? error.message : "附件读取失败"}`,
        );
      }
    } else if (entry.kind === "sheet") {
      const key = `${entry.id}:sheet`;
      try {
        const file = replacements.get(key);
        const sheets = file
          ? await awaited(() => dependencies.xlsx(file, entry.id, entry.name))
          : await awaited(() => dependencies.sheet(entry.id));
        if (!sheets)
          fail(key, "sheet", `${entry.name} · 表格快照缺失，请补充 XLSX`);
        else next.projection = { sheets };
      } catch (error) {
        active();
        fail(
          key,
          "sheet",
          `${entry.name}：${error instanceof Error ? error.message : "快照读取失败"}`,
        );
      }
    }
    active();
    output.push(next);
  }
  return { entries: output, missing };
}
