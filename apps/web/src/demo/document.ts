import { useMemo, useState } from "react";
import * as Y from "yjs";
import type {
  useDocumentCollaboration as ServerHook,
  DocumentSession,
} from "@/views/Document/collaboration";
import type { Entry } from "@/store/workspace";
import { documents } from "./data";
export type {
  DocumentSession,
  CollaborationView,
} from "@/views/Document/collaboration";
export function useDocumentCollaboration(
  file: Entry,
): ReturnType<typeof ServerHook> {
  const [attempt, setAttempt] = useState(0);
  const session = useMemo<DocumentSession>(
    () => ({
      document: new Y.Doc(),
      provider: null,
      projection: structuredClone(documents.get(file.id)),
      epoch: attempt + 1,
      revision: 1,
      loaded: true,
      pending: false,
      userName: "体验者",
      scope: {
        userId: "demo-user",
        spaceId: file.space,
        fileId: file.id,
        sessionId: "demo",
        epoch: 1,
      },
    }),
    [file.id, file.space, attempt],
  );
  return {
    session,
    view: {
      ready: true,
      connected: true,
      synced: true,
      saved: true,
      notice: "",
      count: 1,
      limit: 1,
      revision: 1,
      epoch: session.epoch,
    },
    restart: () => setAttempt((value) => value + 1),
    recordDraft: (projection) => {
      documents.set(file.id, structuredClone(projection));
    },
    checkpoint: async () => ({
      fileId: file.id,
      epoch: session.epoch,
      revision: 1,
      savedAt: new Date().toISOString(),
    }),
    drafts: [],
    dismissDraft: async () => {},
  };
}
