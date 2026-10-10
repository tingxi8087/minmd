import type { JSONContent } from "@tiptap/core";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { canMove, siblings } from "@/utils/fileTree";
import { deletePresentation } from "@/utils/presentationFiles";
import { deleteSpreadsheet } from "@/utils/spreadsheetStorage";
export type FileKind = "doc" | "sheet" | "slide" | "folder";
export type Entry = {
  id: string;
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
  theme: "light" | "dark";
  space: string;
  files: Entry[];
  keys: DemoKey[];
  loggedIn: boolean;
  setTheme: (theme: State["theme"]) => void;
  setSpace: (space: string) => void;
  setLoggedIn: (value: boolean) => void;
  add: (
    name: string,
    kind: FileKind,
    parent: string | null,
    content?: string,
  ) => string;
  patch: (id: string, patch: Partial<Entry>) => void;
  relocate: (id: string, parent: string | null, index?: number) => boolean;
  purge: (id: string) => void;
  addKey: (key: DemoKey) => void;
  removeKey: (id: string) => void;
  reset: () => void;
  visit: (id: string) => void;
};
export const useWorkspace = create<State>()(
  persist(
    (set, get) => ({
      theme: "light",
      space: "team",
      files: initialFiles,
      keys: [],
      loggedIn: true,
      setTheme: (theme) => set({ theme }),
      setSpace: (space) => set({ space }),
      setLoggedIn: (loggedIn) => set({ loggedIn }),
      add: (name, kind, parent, content) => {
        const id = crypto.randomUUID();
        set({
          files: [
            {
              ...entry(id, name, kind),
              parent,
              content,
              space: get().space,
              order:
                Math.max(
                  -1,
                  ...siblings(get().files, get().space, parent).map(
                    (f) => f.order ?? get().files.indexOf(f),
                  ),
                ) + 1,
              updated: new Date().toISOString(),
            },
            ...get().files,
          ],
        });
        return id;
      },
      patch: (id, patch) =>
        set({
          files: get().files.map((file) =>
            file.id === id
              ? { ...file, ...patch, updated: new Date().toISOString() }
              : file,
          ),
        }),
      purge: (id) => {
        const key = get().files.find((file) => file.id === id)?.presentation
          ?.key;
        set({ files: get().files.filter((file) => file.id !== id) });
        if (key) void deletePresentation(key).catch(() => {});
        void deleteSpreadsheet(id).catch(() => {});
      },
      relocate: (id, parent, index) => {
        const files = get().files;
        if (!canMove(files, id, parent)) return false;
        const file = files.find((f) => f.id === id)!;
        const destination = siblings(files, file.space, parent).filter(
          (f) => f.id !== id,
        );
        destination.splice(
          Math.max(
            0,
            Math.min(index ?? destination.length, destination.length),
          ),
          0,
          file,
        );
        const orders = new Map(destination.map((f, i) => [f.id, i]));
        set({
          files: files.map((f) =>
            f.id === id
              ? {
                  ...f,
                  parent,
                  order: orders.get(id),
                  updated: new Date().toISOString(),
                }
              : orders.has(f.id)
                ? { ...f, order: orders.get(f.id) }
                : f,
          ),
        });
        return true;
      },
      addKey: (key) => set({ keys: [key, ...get().keys] }),
      removeKey: (id) =>
        set({ keys: get().keys.filter((key) => key.id !== id) }),
      visit: (id) =>
        set({
          files: get().files.map((file) =>
            file.id === id
              ? { ...file, accessed: new Date().toISOString() }
              : file,
          ),
        }),
      reset: () => {
        const sheets = get()
          .files.filter((file) => file.kind === "sheet")
          .map((file) => file.id);
        const keys = get().files.flatMap((file) =>
          file.presentation ? [file.presentation.key] : [],
        );
        set({ files: initialFiles, keys: [], space: "team" });
        keys.forEach((key) => void deletePresentation(key).catch(() => {}));
        sheets.forEach((id) => void deleteSpreadsheet(id).catch(() => {}));
      },
    }),
    { name: "minmd-static-demo-v1" },
  ),
);
