import { useEffect, useState } from "react";
import { useAuth } from "@/store/auth";
import { loadCreatorNames, creatorName } from "@/views/Files/creators";
export function useMemberNames(spaceId: string, enabled: boolean) {
  const user = useAuth((state) => state.user);
  const [result, setResult] = useState<{
    identity: typeof user;
    spaceId: string;
    names: Record<string, string>;
    loaded: boolean;
    failed: boolean;
  }>({ identity: null, spaceId: "", names: {}, loaded: false, failed: false });
  useEffect(() => {
    const controller = new AbortController();
    if (enabled && user)
      void loadCreatorNames(spaceId, controller.signal)
        .then((names) => {
          if (!controller.signal.aborted)
            setResult({
              identity: user,
              spaceId,
              names,
              loaded: true,
              failed: false,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setResult({
              identity: user,
              spaceId,
              names: {},
              loaded: true,
              failed: true,
            });
        });
    return () => controller.abort();
  }, [spaceId, user, enabled]);
  const valid = result.identity === user && result.spaceId === spaceId;
  return (actorId: string | null) =>
    actorId
      ? creatorName(
          actorId,
          valid ? result.names : {},
          valid && result.loaded,
          valid && result.failed,
        )
      : "系统";
}
