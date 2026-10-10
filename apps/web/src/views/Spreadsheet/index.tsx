import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  Upload,
  Share2,
  AlertCircle,
  LoaderCircle,
} from "lucide-react";
import {
  createUniver,
  defaultTheme,
  LocaleType,
  mergeLocales,
  type FUniver,
} from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import zhCN from "@univerjs/preset-sheets-core/locales/zh-CN";
import "@univerjs/preset-sheets-core/lib/index.css";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import filterZhCN from "@univerjs/preset-sheets-filter/locales/zh-CN";
import "@univerjs/preset-sheets-filter/lib/index.css";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import sortZhCN from "@univerjs/preset-sheets-sort/locales/zh-CN";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import validationZhCN from "@univerjs/preset-sheets-data-validation/locales/zh-CN";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import TooltipButton from "@/components/TooltipButton";
import FileIcon from "@/components/FileIcon";
import FileHeader from "@/components/FileHeader";
import FileDialogs, { type FileAction } from "@/components/FileDialogs";
import { type Entry, useWorkspace } from "@/store/workspace";
import { getSpreadsheet, saveSpreadsheet } from "@/utils/spreadsheetStorage";
import { createWorkbook } from "./workbook";
import { importXlsx, exportXlsx } from "./exchange";
import { configureRibbon, ribbonLocale } from "./ribbon";
import styles from "./index.module.less";

export default function Spreadsheet({ file }: { file: Entry }) {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const theme = useWorkspace((s) => s.theme);
  const container = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const api = useRef<FUniver | null>(null);
  const flush = useRef<() => Promise<void>>(async () => {});
  const replacing = useRef(false);
  const latestFile = useRef(file);
  latestFile.current = file;
  const [state, setState] = useState<"loading" | "saved" | "saving" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<FileAction | null>(null);
  useEffect(() => {
    let cancelled = false,
      dirty = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let instance: ReturnType<typeof createUniver> | undefined;
    let subscription: { dispose: () => void } | undefined;
    let pending = Promise.resolve();
    setState("loading");
    setError("");
    const save = async () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      const book = instance?.univerAPI.getActiveWorkbook();
      if (!book) return;
      const snapshot = book.save();
      snapshot.name = latestFile.current.name;
      dirty = false;
      if (!cancelled) setState("saving");
      pending = pending
        .catch(() => {})
        .then(() => saveSpreadsheet(file.id, snapshot))
        .then(() => {
          useWorkspace.getState().patch(file.id, {
            spreadsheet: { savedAt: new Date().toISOString() },
          });
          if (!cancelled && !dirty) setState("saved");
        })
        .catch((e) => {
          if (!cancelled) {
            setState("error");
            message.error("表格保存失败，请导出备份后检查浏览器存储空间");
          }
          throw e;
        });
      return pending;
    };
    flush.current = save;
    const open = async () => {
      try {
        const snapshot =
          (await getSpreadsheet(file.id)) ||
          createWorkbook(
            file.id,
            latestFile.current.name,
            file.id === "sheet-budget",
          );
        if (cancelled) return;
        const css = getComputedStyle(document.documentElement),
          accent = css.getPropertyValue("--accent").trim(),
          soft = css.getPropertyValue("--accent-soft").trim();
        instance = createUniver({
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: mergeLocales(
              zhCN,
              filterZhCN,
              sortZhCN,
              validationZhCN,
              ribbonLocale,
            ),
          },
          darkMode: useWorkspace.getState().theme === "dark",
          theme: {
            ...defaultTheme,
            primary: {
              ...defaultTheme.primary,
              50: soft,
              100: soft,
              200: soft,
              300: accent,
              400: accent,
              500: accent,
              600: accent,
              700: accent,
              800: accent,
              900: accent,
            },
          },
          presets: [
            UniverSheetsCorePreset({
              container: container.current!,
              header: true,
              ribbonType: "grid",
              menu: {
                "data-validation.command.insert-quick-rule": {
                  title: "sheets-data-validation-ui.checkbox.title",
                  gridLayout: {
                    row: 1,
                    column: 1,
                    showLabel: true,
                    width: 104,
                  },
                },
                "sheet.menu.quick-dropdown": {
                  title: "minmd.sheetRibbon.dropdown",
                  gridLayout: {
                    row: 2,
                    column: 1,
                    showLabel: true,
                    width: 104,
                  },
                },
                "sheet.menu.quick-date": {
                  title: "minmd.sheetRibbon.date",
                  gridLayout: {
                    row: 1,
                    column: 2,
                    showLabel: true,
                    width: 104,
                  },
                },
                "sheet.command.smart-toggle-filter": {
                  title: "sheets-filter-ui.toolbar.smart-toggle-filter-tooltip",
                  gridLayout: {
                    row: 1,
                    column: 1,
                    rowSpan: 2,
                    showLabel: true,
                    width: 64,
                  },
                },
                "sheet.menu.sheets-sort": {
                  title: "sheets-sort-ui.general.sort",
                  gridLayout: {
                    row: 1,
                    column: 2,
                    rowSpan: 2,
                    showLabel: true,
                    width: 64,
                  },
                },
              },
            }),
            UniverSheetsFilterPreset(),
            UniverSheetsSortPreset(),
            UniverSheetsDataValidationPreset(),
          ],
        });
        api.current = instance.univerAPI;
        instance.univerAPI.createWorkbook(snapshot);
        configureRibbon(instance.univerAPI, (text) => message.error(text));
        replacing.current = false;
        subscription = instance.univerAPI.addEvent(
          instance.univerAPI.Event.CommandExecuted,
          (command) => {
            if (command.type !== 2 || replacing.current) return;
            dirty = true;
            setState("saving");
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => void save().catch(() => {}), 400);
          },
        );
        await save().catch(() => {});
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "表格打开失败");
          setState("error");
        }
      }
    };
    void open();
    const pagehide = () => {
      if (dirty) void save().catch(() => {});
    };
    window.addEventListener("pagehide", pagehide);
    return () => {
      if (dirty) void save().catch(() => {});
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("pagehide", pagehide);
      subscription?.dispose();
      instance?.univer.dispose();
      if (api.current === instance?.univerAPI) api.current = null;
    };
  }, [file.id, revision]);
  useEffect(() => {
    const saveShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || busy || state === "loading") return;
      const book = api.current?.getActiveWorkbook();
      if (!book) return;
      void (async () => {
        if (book.isCellEditing() && !(await book.endEditingAsync(true))) return;
        await flush.current();
      })().catch(() => {});
    };
    window.addEventListener("keydown", saveShortcut, true);
    return () => window.removeEventListener("keydown", saveShortcut, true);
  }, [busy, state]);
  useEffect(() => {
    api.current?.toggleDarkMode(theme === "dark");
  }, [theme]);
  const download = async () => {
    if (busy || !api.current) return;
    setBusy(true);
    try {
      await flush.current().catch(() => {});
      const snapshot = api.current.getActiveWorkbook()!.save();
      snapshot.name = file.name;
      const blob = await exportXlsx(snapshot),
        url = URL.createObjectURL(blob),
        anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${file.name.replace(/\.xlsx$/i, "")}.xlsx`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Excel 导出失败");
    } finally {
      setBusy(false);
    }
  };
  const imported = async (binary?: File) => {
    if (!binary || busy) return;
    setBusy(true);
    try {
      const snapshot = await importXlsx(binary, file.id, file.name);
      replacing.current = true;
      await flush.current();
      await saveSpreadsheet(file.id, snapshot);
      setRevision((r) => r + 1);
      message.success("已导入 Excel，图表等高级对象暂不支持转换");
    } catch (e) {
      replacing.current = false;
      message.error(e instanceof Error ? e.message : "Excel 导入失败");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <main className={styles.page}>
      <FileHeader className={styles.header}>
        <TooltipButton
          className="icon-button"
          aria-label="返回空间"
          onClick={() => navigate("/files")}
        >
          <ArrowLeft size={17} />
        </TooltipButton>
        <FileIcon kind="sheet" small />
        <strong>{file.name}</strong>
        <div className={styles.actions}>
          <TooltipButton
            className="icon-button"
            aria-label={
              state === "saved"
                ? "已保存到本机，点击保存"
                : state === "error"
                  ? "保存失败，点击重试"
                  : "正在保存表格"
            }
            disabled={state === "loading"}
            onClick={() => void flush.current().catch(() => {})}
          >
            {state === "saved" ? (
              <Check size={16} />
            ) : state === "error" ? (
              <AlertCircle size={16} />
            ) : (
              <LoaderCircle size={16} />
            )}
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="导入 XLSX 到当前表格"
            tooltip="导入 XLSX（替换当前表格，支持基础数据和样式）"
            disabled={busy || state === "loading"}
            onClick={() => input.current?.click()}
          >
            <Upload size={16} />
          </TooltipButton>
          <TooltipButton
            className="icon-button"
            aria-label="导出 XLSX"
            tooltip="导出 XLSX（基础数据、公式和样式）"
            disabled={busy || state === "loading" || !!error}
            onClick={() => void download()}
          >
            <Download size={16} />
          </TooltipButton>
          <button
            className="secondary-button"
            onClick={() => setAction({ type: "share", file })}
          >
            <Share2 size={15} />
            分享
          </button>
        </div>
      </FileHeader>
      <input
        ref={input}
        type="file"
        accept=".xlsx"
        hidden
        onChange={(e) => void imported(e.target.files?.[0])}
      />
      <div ref={container} className={styles.editor} aria-label="表格编辑器" />
      {(state === "loading" || error || busy) && (
        <div className={styles.status}>
          {error || (busy ? "正在处理 Excel…" : "正在打开表格…")}
          {error && (
            <button
              className="secondary-button"
              onClick={() => setRevision((r) => r + 1)}
            >
              重试
            </button>
          )}
        </div>
      )}
      <FileDialogs action={action} close={() => setAction(null)} />
    </main>
  );
}
