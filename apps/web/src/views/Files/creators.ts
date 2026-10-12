import { spaceApi } from "@/api/spaces";
export async function loadCreatorNames(spaceId: string, signal: AbortSignal) {
  const names: Record<string, string> = {};
  let count = 0;
  for (let page = 1; ; page++) {
    signal.throwIfAborted();
    const result = await spaceApi.members(spaceId, page, signal);
    signal.throwIfAborted();
    for (const member of result.items)
      names[member.id] = member.nickname.trim() || member.account;
    count += result.items.length;
    if (count >= result.total || !result.items.length) return names;
  }
}
export function creatorName(
  id: string,
  names: Record<string, string>,
  loaded: boolean,
  failed: boolean,
) {
  return (
    names[id] ??
    (failed ? "成员信息不可用" : loaded ? "已离开空间的成员" : "成员")
  );
}
