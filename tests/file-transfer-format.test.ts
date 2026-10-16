import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { fileTransferConfig } from "../config/file-transfer";
import {
  completeDocument,
  orderTransferEntries,
  packagePath,
  portablePaths,
  parseManifest,
  rewriteDocument,
  transferVersion,
} from "../apps/app_server/src/modules/file-transfer/format";
import {
  hashFile,
  readArchive,
  writeArchive,
} from "../apps/app_server/src/modules/file-transfer/archive";

const limits = fileTransferConfig({});
const fileId = crypto.randomUUID(),
  assetId = crypto.randomUUID();
const entry = (id = fileId) => ({
  id,
  parentId: null,
  kind: "doc",
  name: "文档",
  position: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  schemaVersion: 1 as const,
  contentPath: `contents/${id}.json`,
  assetId: null,
});
const manifest = () => ({
  format: "minmd-transfer",
  version: 1,
  appVersion: transferVersion,
  mode: "complete",
  exportedAt: new Date().toISOString(),
  sourceOrigin: "https://docs.example.com",
  entries: [entry()],
  assets: [],
});

describe("完整包清单与保真", () => {
  test("配置独立限制压缩、解压、条目和深度，越界不能启动", () => {
    expect(limits.FILE_TRANSFER_MAX_BYTES).toBe(200 * 1024 ** 2);
    expect(limits.FILE_TRANSFER_EXPANDED_BYTES).toBe(1024 ** 3);
    for (const env of [
      { FILE_TRANSFER_MAX_BYTES: "Infinity" },
      { FILE_TRANSFER_MAX_FILES: "0" },
      { FILE_TRANSFER_MAX_DEPTH: "65" },
      { FILE_TRANSFER_TIMEOUT_MS: "1" },
    ])
      expect(() => fileTransferConfig(env)).toThrow("Invalid configuration");
  });
  test("拒绝版本、额外授权字段、重复标识、循环、无效父节点与资源超限", () => {
    expect(parseManifest(manifest(), limits).entries[0]!.name).toBe("文档");
    for (const data of [
      { ...manifest(), appVersion: "not-this-version" },
      { ...manifest(), members: [] },
      { ...manifest(), entries: [entry(), entry()] },
      { ...manifest(), entries: [{ ...entry(), parentId: fileId }] },
      {
        ...manifest(),
        entries: [{ ...entry(), parentId: crypto.randomUUID() }],
      },
      {
        ...manifest(),
        entries: [{ ...entry(), kind: "pdf", contentPath: null, assetId }],
      },
    ])
      expect(() => parseManifest(data, limits)).toThrow();
    expect(() =>
      parseManifest(manifest(), { ...limits, FILE_TRANSFER_MAX_ENTRIES: 1 }),
    ).toThrow();
  });
  test("文档字体、背景、字号和图片尺寸对齐保留，未知节点/属性不静默丢弃", () => {
    const input = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "paragraph" },
          content: [
            {
              type: "text",
              text: "样式",
              marks: [
                {
                  type: "textStyle",
                  attrs: {
                    color: "#ff0000",
                    backgroundColor: "#ffff00",
                    fontSize: "24px",
                  },
                },
              ],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            src: `/api/app/assets/${assetId}`,
            assetId,
            width: 320,
            height: 200,
            align: "right",
          },
        },
      ],
    };
    const normalized = completeDocument(input);
    expect(normalized.content![0]!.content![0]!.marks![0]!.attrs).toMatchObject(
      input.content[0]!.content![0]!.marks![0]!.attrs,
    );
    expect(normalized.content![1]!.attrs).toMatchObject(
      input.content[1]!.attrs!,
    );
    expect(() =>
      completeDocument({ type: "doc", content: [{ type: "futureBlock" }] }),
    ).toThrow();
    expect(() =>
      completeDocument({
        type: "doc",
        content: [
          { type: "paragraph", attrs: { unknownStyle: "must-not-drop" } },
        ],
      }),
    ).toThrow("不支持的属性");
  });
  test("只映射包内引用，外链原样，包外引用保留源站，缺失私有图片拒绝", () => {
    const nextFile = crypto.randomUUID(),
      nextAsset = crypto.randomUUID();
    const input = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "documentReference", attrs: { id: fileId, name: "包内" } },
            {
              type: "documentReference",
              attrs: { id: "outside", name: "包外" },
            },
            {
              type: "text",
              text: "链接",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: `https://docs.example.com/#/preview/${fileId}?x=1`,
                  },
                },
              ],
            },
            {
              type: "text",
              text: "外站",
              marks: [
                {
                  type: "link",
                  attrs: {
                    href: `https://other.example.com/#/document/${fileId}`,
                  },
                },
              ],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            src: `/api/app/assets/${assetId}`,
            assetId,
            align: "center",
          },
        },
        {
          type: "image",
          attrs: { src: "https://other.example.com/photo.png" },
        },
      ],
    };
    const output = rewriteDocument(
      input,
      new Map([[fileId, nextFile]]),
      new Map([[assetId, nextAsset]]),
      "https://docs.example.com",
    );
    const body = output.content![0]!.content!;
    expect(body[0]!.attrs!.id).toBe(nextFile);
    expect(body[1]!.marks![0]!.attrs!.href).toBe(
      "https://docs.example.com/#/document/outside",
    );
    expect(body[2]!.marks![0]!.attrs!.href).toBe(`#/preview/${nextFile}?x=1`);
    expect(body[3]!.marks![0]!.attrs!.href).toBe(
      `https://other.example.com/#/document/${fileId}`,
    );
    expect(output.content![1]!.attrs).toMatchObject({
      assetId: nextAsset,
      src: `/api/app/assets/${nextAsset}`,
      align: "center",
    });
    expect(output.content![2]!.attrs!.src).toBe(
      "https://other.example.com/photo.png",
    );
    expect(input.content[1]!.attrs!.assetId).toBe(assetId);
    expect(() =>
      rewriteDocument(input, new Map(), new Map(), "https://docs.example.com"),
    ).toThrow("附件缺失");
  });
  test("导入顺序按同级 position，不被子节点较小位置扰乱", () => {
    const first = {
      ...entry(crypto.randomUUID()),
      kind: "folder" as const,
      position: 1,
    };
    const second = {
      ...entry(crypto.randomUUID()),
      kind: "folder" as const,
      position: 10,
    };
    const child = {
      ...entry(crypto.randomUUID()),
      parentId: second.id,
      kind: "doc" as const,
      position: 0,
    };
    expect(
      orderTransferEntries([second, child, first]).map((row) => row.id),
    ).toEqual([first.id, second.id, child.id]);
  });
  test("通用包避免文件/目录、扩展名和大小写冲突，并为原文件补齐正确扩展名", () => {
    const rows = [
      { id: "doc", parentId: null, name: "foo", kind: "doc" },
      { id: "folder", parentId: null, name: "foo.md", kind: "folder" },
      { id: "child", parentId: "folder", name: "inner", kind: "doc" },
      { id: "pdf", parentId: null, name: "foo.md", kind: "pdf" },
      { id: "case", parentId: null, name: "FOO", kind: "doc" },
    ];
    const result = portablePaths(rows, new Map([["pdf", ".pdf"]]));
    expect(result.get("doc")).toBe("files/foo");
    expect(result.get("folder")).toBe("files/foo.md (1)");
    expect(result.get("child")).toBe("files/foo.md (1)/inner");
    expect(result.get("pdf") + ".pdf").toBe("files/foo.md.pdf");
    expect(result.get("case")).toBe("files/FOO (1)");
  });
  test("包内路径禁止绝对路径、盘符、反斜杠、空段及穿越", () => {
    for (const name of [
      "/etc/passwd",
      "a/../b",
      "a/./b",
      "C:/a",
      "a\\b",
      "a//b",
      "a\u0000b",
      "",
    ])
      expect(() => packagePath(name)).toThrow();
    expect(packagePath("资料/文档.md")).toBe("资料/文档.md");
  });
});

describe("流式压缩包读写", () => {
  test("文件与附件按序往返，磁盘写入不使用包内路径，内容校验和一致", async () => {
    const root = await mkdtemp(join(tmpdir(), "minmd-transfer-test-"));
    try {
      const source = join(root, "source"),
        zip = join(root, "pack.zip");
      await Bun.write(source, Buffer.alloc(2 * 1024 ** 2, 42));
      await writeArchive(
        [{ name: "附件/example.bin", path: source }],
        zip,
        limits,
      );
      const result = await readArchive(zip, join(root, "read"), limits);
      expect(result.get("附件/example.bin")!.size).toBe(2 * 1024 ** 2);
      expect(await hashFile(result.get("附件/example.bin")!.path)).toBe(
        await hashFile(source),
      );
      expect(result.get("附件/example.bin")!.path).not.toContain("附件");
      await expect(
        readArchive(zip, join(root, "limited"), {
          ...limits,
          FILE_TRANSFER_EXPANDED_BYTES: 1024,
        }),
      ).rejects.toThrow();
      await expect(
        writeArchive(
          [{ name: "data", path: source }],
          join(root, "small.zip"),
          { ...limits, FILE_TRANSFER_MAX_BYTES: 1024 },
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  test("路径穿越、符号链接、重复路径、损坏 CRC、嵌套过深和取消均失败并清理暂存", async () => {
    const root = await mkdtemp(join(tmpdir(), "minmd-transfer-invalid-"));
    try {
      const cases: JSZip[] = [];
      cases.push(new JSZip().file("../escape", "bad"));
      cases.push(
        new JSZip().file("link", "/etc/passwd", { unixPermissions: 0o120777 }),
      );
      cases.push(new JSZip().file("a/".repeat(40) + "data", "deep"));
      for (let index = 0; index < cases.length; index++) {
        const path = join(root, `${index}.zip`);
        await Bun.write(
          path,
          await cases[index]!.generateAsync({
            type: "nodebuffer",
            platform: "UNIX",
          }),
        );
        const directory = join(root, `out-${index}`);
        await expect(readArchive(path, directory, limits)).rejects.toThrow();
        expect(await Bun.file(join(directory, "anything")).exists()).toBe(
          false,
        );
      }
      const bytes = await new JSZip()
        .file("one", "payload")
        .file("two", "payload")
        .generateAsync({ type: "nodebuffer", compression: "STORE" });
      // 两个中央目录条目及本地文件头改为同一名称，模拟重复条目。
      const duplicate = Buffer.from(bytes);
      for (let at = 0; at < duplicate.length - 3; at++)
        if (duplicate.toString("ascii", at, at + 3) === "two")
          duplicate.write("one", at, "ascii");
      await Bun.write(join(root, "duplicate.zip"), duplicate);
      await expect(
        readArchive(
          join(root, "duplicate.zip"),
          join(root, "duplicate"),
          limits,
        ),
      ).rejects.toThrow("重复路径");
      const corrupt = Buffer.from(bytes);
      corrupt[33] = corrupt[33]! ^ 1;
      await Bun.write(join(root, "crc.zip"), corrupt);
      await expect(
        readArchive(join(root, "crc.zip"), join(root, "crc"), limits),
      ).rejects.toThrow();
      const encrypted = Buffer.from(bytes);
      for (let at = 0; at < encrypted.length - 12; at++) {
        const signature = encrypted.readUInt32LE(at);
        if (signature === 0x02014b50)
          encrypted.writeUInt16LE(encrypted.readUInt16LE(at + 8) | 1, at + 8);
        if (signature === 0x04034b50)
          encrypted.writeUInt16LE(encrypted.readUInt16LE(at + 6) | 1, at + 6);
      }
      await Bun.write(join(root, "encrypted.zip"), encrypted);
      await expect(
        readArchive(
          join(root, "encrypted.zip"),
          join(root, "encrypted"),
          limits,
        ),
      ).rejects.toThrow();
      const dishonest = Buffer.from(bytes);
      for (let at = 0; at < dishonest.length - 46; at++)
        if (dishonest.readUInt32LE(at) === 0x02014b50) {
          dishonest.writeUInt32LE(1, at + 24);
          break;
        }
      await Bun.write(join(root, "dishonest.zip"), dishonest);
      await expect(
        readArchive(
          join(root, "dishonest.zip"),
          join(root, "dishonest"),
          limits,
        ),
      ).rejects.toThrow();
      await Bun.write(join(root, "valid.zip"), bytes);
      await expect(
        readArchive(
          join(root, "valid.zip"),
          join(root, "cancel"),
          limits,
          AbortSignal.abort(),
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
