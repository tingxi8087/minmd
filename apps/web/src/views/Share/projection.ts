import type { JSONContent } from "@tiptap/core";
import { sharesApi } from "@/api/shares";
/** 访客图片只经过分享授权端点，保留原projection不可变。 */
export function publicDocument(
  projection: JSONContent,
  token: string,
): JSONContent {
  const next = structuredClone(projection);
  const rewrite = (node: JSONContent) => {
    if (node.type === "image" && node.attrs) {
      const id =
        typeof node.attrs.assetId === "string"
          ? node.attrs.assetId
          : typeof node.attrs.src === "string"
            ? node.attrs.src.match(/^\/api\/app\/assets\/([^/?]+)$/)?.[1]
            : undefined;
      node.attrs.src = id ? sharesApi.assetUrl(token, id) : "";
    }
    node.content?.forEach(rewrite);
  };
  rewrite(next);
  return next;
}
