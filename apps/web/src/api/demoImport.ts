import { request } from "@/http";
import type { FileKind } from "@/store/workspace";
export type DemoImportEntry = {
  oldId: string;
  kind: FileKind;
  name: string;
  parentOldId: string | null;
  projection?: object;
  missingAssets?: boolean;
};
export type DemoImportResult = {
  jobId: string;
  status: "completed" | "partial";
  mapping: Record<string, string>;
  items: {
    oldId: string;
    fileId: string;
    status: "success" | "failed";
    message?: string;
  }[];
};
export const demoImportApi = {
  run: async (
    spaceId: string,
    idempotencyKey: string,
    entries: DemoImportEntry[],
    signal?: AbortSignal,
  ) =>
    (
      await request.post<DemoImportResult>(
        `/app/spaces/${spaceId}/demo-imports`,
        { idempotencyKey, entries },
        { timeout: 120000, signal },
      )
    ).data,
  result: async (spaceId: string, jobId: string, signal?: AbortSignal) =>
    (
      await request.get<DemoImportResult>(
        `/app/spaces/${spaceId}/demo-imports/${jobId}`,
        { signal },
      )
    ).data,
};
