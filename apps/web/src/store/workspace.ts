import { isDemo } from "@/runtime";
import type { JSONContent } from "@tiptap/core";
import { filesApi, type RemoteFile } from "@/api/files";
import { errorMessage } from "@/http";
import { spaceApi, type Space } from "@/api/spaces";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { canMove, siblings } from "@/utils/fileTree";
import { deletePresentation } from "@/utils/presentationFiles";
import { deleteSpreadsheet } from "@/utils/spreadsheetStorage";
export type FileKind =
  "doc" | "sheet" | "slide" | "folder" | "pdf" | "video" | "image";
export type Entry = {
  permission?: "read" | "edit" | "manage";
  id: string;
  metadataRevision?: number;
  deletedBatch?: string | null;
  name: string;
  kind: FileKind;
  space: string;
  parent: string | null;
  order?: number;
  favorite: boolean;
  public: boolean;
  deleted: boolean;
  updated: string;
  owner: string;
  accessed?: string;
  password?: string;
  expires?: string;
  content?: string;
  document?: JSONContent;
  contentVersion?: number;
  presentation?: { key: string; name: string; size: number; slides: number };
  spreadsheet?: { savedAt: string };
};
export const kindNames: Record<FileKind, string> = {
  doc: "文档",
  sheet: "表格",
  slide: "幻灯片",
  folder: "文件夹",
  pdf: "PDF",
  video: "视频",
  image: "图片",
};
export const spaces = [
  {
    id: "team",
    name: "设计与产品",
    caption: "团队空间",
    initials: "D",
    members: 4,
  },
  {
    id: "personal",
    name: "我的空间",
    caption: "个人空间",
    initials: "T",
    members: 1,
  },
];
const entry = (
  id: string,
  name: string,
  kind: FileKind,
  favorite = false,
  shared = false,
  parent: string | null = null,
): Entry => ({
  id,
  name,
  kind,
  favorite,
  public: shared,
  parent,
  deleted: false,
  space: "team",
  updated: "2026-10-10T08:00:00.000Z",
  owner: "Tingxi",
});
export const initialFiles: Entry[] = [
  entry("folder-brand", "品牌与设计", "folder"),
  entry("folder-product", "产品规划", "folder"),
  entry("doc-start", "从这里开始，认识 MinMD", "doc", true, true),
  entry("doc-plan", "产品想法与路线图", "doc", true),
  entry("sheet-budget", "第四季度项目预算", "sheet", true),
  entry("slide-review", "让好想法发生 · 产品分享", "slide", false, true),
  entry("doc-meeting", "每周产品讨论 / 10.10", "doc"),
  entry("doc-brand", "品牌视觉与设计原则", "doc", false, false, "folder-brand"),
  {
    ...entry("personal-note", "留给自己的灵感笔记", "doc", true),
    space: "personal",
  },
];
type DemoKey = {
  id: string;
  name: string;
  prefix: string;
  space: string;
  access: "read" | "write";
  created: string;
};
type State = {
  spaces: Space[];
  loadSpaces: () => Promise<void>;
  loadFiles: () => Promise<void>;
  clearSession: () => void;
  filesLoading: boolean;
  filesError: string;
  theme: "light" | "dark";
  space: string;
  files: Entry[];
  keys: DemoKey[];
  loggedIn: boolean;
  setTheme: (theme: State["theme"]) => void;
  setSpace: (space: string) => Promise<void>;
  setLoggedIn: (value: boolean) => void;
  add: (
    name: string,
    kind: FileKind,
    parent: string | null,
    content?: string,
  ) => Promise<string>;
  patch: (id: string, patch: Partial<Entry>) => Promise<void>;
  relocate: (
    id: string,
    parent: string | null,
    index?: number,
  ) => Promise<boolean>;
  purge: (id: string) => Promise<void>;
  addKey: (key: DemoKey) => void;
  removeKey: (id: string) => void;
  reset: () => void;
  visit: (id: string) => Promise<void>;
};
let sessionGeneration = 0;
let fileRequest = 0;
export const fromRemoteFile = (file: RemoteFile): Entry => ({
  ...(file.permission ? { permission: file.permission } : {}),
  id: file.id,
  space: file.spaceId,
  name: file.name,
  kind: file.kind,
  parent: file.parentId,
  order: file.position,
  owner: file.createdBy,
  favorite: file.favorite ?? false,
  public: file.visibility === "public",
  deleted: file.deletedAt !== null,
  deletedBatch: file.deletedBatch,
  metadataRevision: file.metadataRevision,
  updated: file.updatedAt,
  accessed: file.accessedAt ?? undefined,
});
export const useWorkspace = create<State>()(
  persist(
    (set, get) => ({
      theme: "light",
      space: "",
      spaces: [],
      files: [],
      keys: [],
      loggedIn: false,
      filesLoading: false,
      filesError: "",
      clearSession: () => {
        sessionGeneration++;
        fileRequest++;
        set({
          loggedIn: false,
          spaces: [],
          files: [],
          keys: [],
          space: "",
          filesLoading: false,
          filesError: "",
        });
      },
      loadSpaces: async () => {
        const generation = sessionGeneration;
        const spaces = await spaceApi.list();
        if (generation !== sessionGeneration) return;
        const space = spaces.some((item) => item.id === get().space)
          ? get().space
          : (spaces[0]?.id ?? "");
        const changed = space !== get().space;
        set({
          spaces,
          space,
          loggedIn: true,
          ...(changed ? { files: [] } : {}),
        });
        await get().loadFiles();
      },
      loadFiles: async () => {
        const space = get().space;
        if (!space) {
          set({ files: [], filesLoading: false });
          return;
        }
        const generation = sessionGeneration;
        const currentRequest = ++fileRequest;
        set({ filesLoading: true, filesError: "" });
        try {
          const [live, trash] = await Promise.all([
            filesApi.tree(space),
            filesApi.trash(space),
          ]);
          if (
            generation !== sessionGeneration ||
            currentRequest !== fileRequest ||
            space !== get().space
          )
            return;
          const previous = new Map(get().files.map((file) => [file.id, file]));
          set({
            files: [...live, ...trash].map((remote) => ({
              ...previous.get(remote.id),
              ...fromRemoteFile(remote),
            })),
            filesLoading: false,
          });
        } catch (error) {
          if (
            generation === sessionGeneration &&
            currentRequest === fileRequest &&
            space === get().space
          )
            set({
              files: [],
              filesLoading: false,
              filesError: errorMessage(error),
            });
        }
      },
      setTheme: (theme) => set({ theme }),
      setSpace: async (space) => {
        if (!get().spaces.some((item) => item.id === space))
          throw new Error("无权访问此空间");
        fileRequest++;
        set({ space, files: [], filesError: "" });
        await get().loadFiles();
      },
      setLoggedIn: (loggedIn) => set({ loggedIn }),
      add: async (name, kind, parent, content) => {
        const space = get().space;
        if (!space) throw new Error("请先选择空间");
        const generation = sessionGeneration;
        const remote = await filesApi.create(space, {
          name,
          kind,
          parentId: parent,
        });
        if (space === get().space && generation === sessionGeneration)
          set({
            files: [{ ...fromRemoteFile(remote), content }, ...get().files],
          });
        return remote.id;
      },
      patch: async (id, patch) => {
        const file = get().files.find((item) => item.id === id);
        if (!file || file.space !== get().space)
          throw new Error("文件不存在或空间已切换");
        const space = file.space;
        const generation = sessionGeneration;
        if (patch.name !== undefined)
          await filesApi.rename(
            space,
            id,
            patch.name,
            file.metadataRevision ?? 0,
          );
        if (patch.favorite !== undefined)
          await filesApi.favorite(space, id, patch.favorite);
        if (patch.deleted === true) await filesApi.remove(space, id);
        if (patch.deleted === false)
          await filesApi.restore(space, id, patch.parent);
        if (
          patch.public !== undefined ||
          patch.password !== undefined ||
          patch.expires !== undefined
        )
          throw new Error("分享接口正在接入");
        if (generation !== sessionGeneration || space !== get().space) return;
        set({
          files: get().files.map((item) =>
            item.id === id
              ? { ...item, ...patch, updated: new Date().toISOString() }
              : item,
          ),
        });
        if (patch.name !== undefined || patch.deleted !== undefined)
          await get().loadFiles();
      },
      relocate: async (id, parent, index) => {
        const files = get().files;
        if (!canMove(files, id, parent)) return false;
        const file = files.find((item) => item.id === id);
        if (!file) return false;
        const destination = siblings(files, file.space, parent).filter(
          (item) => item.id !== id,
        );
        const beforeId =
          index === undefined ? undefined : destination[Math.max(0, index)]?.id;
        await filesApi.move(
          file.space,
          id,
          parent,
          beforeId,
          file.metadataRevision ?? 0,
        );
        await get().loadFiles();
        return true;
      },
      purge: async (id) => {
        const file = get().files.find((item) => item.id === id);
        if (!file) throw new Error("文件不存在");
        await filesApi.purge(file.space, id);
        if (!isDemo) {
          if (file.presentation)
            await deletePresentation(file.presentation.key);
          await deleteSpreadsheet(id);
        }
        await get().loadFiles();
      },
      addKey: (key) => set({ keys: [key, ...get().keys] }),
      removeKey: (id) =>
        set({ keys: get().keys.filter((key) => key.id !== id) }),
      visit: async (id) => {
        const file = get().files.find((item) => item.id === id);
        if (!file) return;
        await filesApi.visit(file.space, id);
        if (file.space === get().space)
          set({
            files: get().files.map((item) =>
              item.id === id
                ? { ...item, accessed: new Date().toISOString() }
                : item,
            ),
          });
      },
      reset: () => {
        throw new Error("真实工作区不支持重置演示数据");
      },
    }),
    {
      name: isDemo ? "minmd-demo-preferences" : "minmd-preferences-v2",
      partialize: (state) => ({
        theme: state.theme,
        ...(!isDemo ? { space: state.space } : {}),
      }),
    },
  ),
);
