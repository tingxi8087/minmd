import {
  AxiosError,
  type AxiosAdapter,
  type InternalAxiosRequestConfig,
} from "axios";
import { configureAssetUrl } from "@/utils/assetUrl";
import { request } from "@/http";
import {
  addFile,
  assets,
  demoSpace,
  demoUser,
  documents,
  files,
  media,
  workbooks,
} from "./data";
const page = <T>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
});
function body(config: InternalAxiosRequestConfig): Record<string, unknown> {
  const value: unknown =
    typeof config.data === "string" ? JSON.parse(config.data) : config.data;
  return value && typeof value === "object" && !(value instanceof FormData)
    ? (value as Record<string, unknown>)
    : {};
}
function descendants(id: string): string[] {
  return [
    id,
    ...[...files.values()]
      .filter((f) => f.parentId === id)
      .flatMap((f) => descendants(f.id)),
  ];
}
async function respond(config: InternalAxiosRequestConfig): Promise<unknown> {
  const path = config.url ?? "";
  const method = config.method ?? "get";
  const input = body(config);
  if (path === "/app/auth/me")
    return { user: demoUser, permissions: [], csrfToken: "demo-memory" };
  if (path === "/app/auth/setup") return { needsSetup: false };
  if (path === "/app/spaces") return page([demoSpace]);
  if (path.endsWith("/members"))
    return page([
      { ...demoUser, role: "owner", joinedAt: demoSpace.createdAt },
    ]);
  if (path.endsWith("/tree"))
    return { items: [...files.values()].filter((f) => !f.deletedAt) };
  if (path === `/app/spaces/${demoSpace.id}/files`) {
    if (method === "post")
      return addFile(
        String(input.name),
        input.kind as import("@/api/files").RemoteFile["kind"],
        typeof input.parentId === "string" ? input.parentId : null,
      );
    return page(
      [...files.values()].filter((f) =>
        config.params?.scope === "trash" ? !!f.deletedAt : !f.deletedAt,
      ),
    );
  }
  const assetDownload = path.match(/^\/app\/assets\/([^/]+)$/);
  if (assetDownload) {
    const asset = assets.get(assetDownload[1]);
    if (!asset) throw Error("文件不存在");
    return asset.blob ?? (await (await fetch(asset.url)).blob());
  }
  if (config.data instanceof FormData) {
    const file = config.data.get("file");
    if (!(file instanceof File)) throw Error("请选择文件");
    const id = crypto.randomUUID();
    const asset = {
      id,
      filename: file.name,
      mime: file.type,
      size: file.size,
      slides: 0,
      url: URL.createObjectURL(file),
      blob: file,
    };
    if (file.name.toLowerCase().endsWith(".pptx")) {
      const { validatePresentation } =
        await import("@/utils/presentationFiles");
      asset.slides = await validatePresentation(file);
    }
    assets.set(id, asset);
    if (path.endsWith("/media")) {
      const kind = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : "pdf";
      const created = addFile(
        config.params?.name ?? file.name,
        kind,
        config.params?.parentId ?? null,
      );
      media.set(created.id, { assetId: id, name: file.name, size: file.size });
      return created;
    }
    return asset;
  }
  const match = path.match(/^\/app\/files\/([^/]+)(.*)$/);
  if (match) {
    const [, id, action] = match;
    const file = files.get(id);
    if (!file) throw Error("文件不存在，刷新可以恢复演示示例");
    if (!action && method === "get") return structuredClone(file);
    if (action === "/access")
      return { permission: "manage", member: true, request: null };
    if (action === "/content")
      return {
        fileId: id,
        projection:
          file.kind === "doc"
            ? documents.get(id)
            : file.kind === "sheet"
              ? { sheets: workbooks.get(id) }
              : (media.get(id) ?? {}),
        revision: 1,
        epoch: 1,
        schemaVersion: 1,
        savedAt: file.updatedAt,
      };
    if (action === "/content-import") {
      if (file.kind === "doc")
        documents.set(
          id,
          input.projection as import("@tiptap/core").JSONContent,
        );
      else
        workbooks.set(
          id,
          (
            input.projection as {
              sheets: import("@fortune-sheet/core").Sheet[];
            }
          ).sheets,
        );
      return {
        fileId: id,
        revision: 1,
        epoch: 1,
        savedAt: new Date().toISOString(),
      };
    }
    if (action === "/presentation") {
      const asset = assets.get(String(input.assetId));
      if (!asset) throw Error("文件不存在");
      const projection = {
        assetId: asset.id,
        name: asset.filename,
        size: asset.size,
        slides: asset.slides,
      };
      media.set(id, projection);
      return { fileId: id, projection, revision: 1, epoch: 1 };
    }
    if (action === "/favorite") file.favorite = method === "put";
    if (action === "/visit") file.accessedAt = new Date().toISOString();
    if (action === "/move") {
      const parentId =
        typeof input.parentId === "string" ? input.parentId : null;
      if (
        parentId &&
        (descendants(id).includes(parentId) ||
          files.get(parentId)?.kind !== "folder")
      )
        throw Error("无法移动到此文件夹");
      file.parentId = parentId;
      const siblings = [...files.values()]
        .filter((f) => f.parentId === parentId && f.id !== id)
        .sort((a, b) => a.position - b.position);
      const before = siblings.findIndex((f) => f.id === input.beforeId);
      siblings.splice(before < 0 ? siblings.length : before, 0, file);
      siblings.forEach((f, index) => (f.position = index));
    }
    if (!action && method === "patch") {
      file.name = String(input.name);
      file.metadataRevision++;
    }
    if (!action && method === "delete")
      for (const target of descendants(id)) {
        const f = files.get(target)!;
        f.deletedAt = new Date().toISOString();
        f.deletedBatch = id;
      }
    if (action === "/restore") {
      const batch = file.deletedBatch;
      for (const target of descendants(id)) {
        const restored = files.get(target)!;
        if (restored.deletedBatch === batch) {
          restored.deletedAt = null;
          restored.deletedBatch = null;
        }
      }
      if (input.parentId !== undefined)
        file.parentId = input.parentId as string | null;
    }
    if (action === "/purge")
      for (const target of descendants(id)) {
        files.delete(target);
        documents.delete(target);
        workbooks.delete(target);
        media.delete(target);
      }
    file.updatedAt = new Date().toISOString();
    if (
      !action ||
      ["/favorite", "/visit", "/move", "/restore", "/purge"].includes(action)
    )
      return structuredClone(file);
  }
  // 演示缺失的能力在本地明确失败，绝不回退真实网络请求。
  throw Error("此功能需要完整部署版本，演示模式不提供");
}
export const demoAdapter: AxiosAdapter = async (config) => {
  try {
    return {
      data: await respond(config),
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    };
  } catch (error) {
    throw new AxiosError(
      error instanceof Error ? error.message : "演示操作失败",
      "DEMO_UNAVAILABLE",
      config,
    );
  }
};
export async function installDemo() {
  document.documentElement.dataset.demo = "true";
  request.defaults.adapter = demoAdapter;
  configureAssetUrl((id) => assets.get(id)?.url ?? "");
}
