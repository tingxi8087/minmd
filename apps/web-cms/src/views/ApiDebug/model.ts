import type {
  ApiDocument,
  DebugInput,
  Operation,
  Schema,
} from "@/http/services/debug";
export interface Endpoint extends Operation {
  id: string;
  method: string;
  path: string;
}
export interface Pair {
  name: string;
  value: string;
  enabled: boolean;
  required?: boolean;
  description?: string;
  type?: string;
}
export function endpoints(doc: ApiDocument): Endpoint[] {
  return Object.entries(doc.paths).flatMap(([path, ops]) =>
    Object.entries(ops)
      .filter(([method]) =>
        ["get", "post", "put", "patch", "delete", "head", "options"].includes(
          method,
        ),
      )
      .map(([method, op]) => ({
        ...op,
        path,
        method: method.toUpperCase(),
        id: method + path,
      })),
  );
}
export function resolveSchema(schema: Schema, doc: ApiDocument): Schema {
  return schema.$ref
    ? (doc.components?.schemas?.[schema.$ref.split("/").pop() ?? ""] ?? {})
    : schema;
}
export function example(
  schema: Schema = {},
  doc: ApiDocument,
  key = "",
  depth = 0,
): unknown {
  if (depth > 8) return null;
  if (/password|token|secret|cookie|authorization|api[-_]?key/i.test(key))
    return "";
  schema = resolveSchema(schema, doc);
  if (schema.example !== undefined) return redact(schema.example, key, "");
  if (schema.allOf)
    return Object.assign(
      {},
      ...schema.allOf.map((s) => example(s, doc, key, depth + 1)),
    );
  if (schema.anyOf || schema.oneOf)
    return example(
      (schema.anyOf ?? schema.oneOf ?? [])[0],
      doc,
      key,
      depth + 1,
    );
  if (schema.type === "object" || schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, value]) => [
        name,
        example(value, doc, name, depth + 1),
      ]),
    );
  if (schema.type === "array")
    return [example(schema.items, doc, key, depth + 1)];
  if (schema.default !== undefined) return schema.default;
  if (schema.enum) return schema.enum[0];
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number") return 0;
  return "";
}
export function makeUrl(path: string, paths: Pair[], query: Pair[]) {
  for (const item of paths) {
    if (!item.value.trim()) throw Error(`请填写路径参数 ${item.name}`);
    path = path.replace(`{${item.name}}`, encodeURIComponent(item.value));
  }
  const params = new URLSearchParams();
  for (const item of query.filter((p) => p.enabled)) {
    if (item.required && !item.value.trim())
      throw Error(`请填写参数 ${item.name}`);
    params.append(item.name, item.value);
  }
  return path + (params.size ? `?${params}` : "");
}
export function redact(
  value: unknown,
  key = "",
  replacement = "<已隐藏>",
): unknown {
  if (/password|token|secret|cookie|authorization|api[-_]?key/i.test(key))
    return replacement;
  if (Array.isArray(value)) return value.map((v) => redact(v, "", replacement));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redact(v, k, replacement)]),
    );
  return value;
}
export function curl(
  input: DebugInput,
  origin: string,
  transport: "bearer" | "cookie" = "bearer",
) {
  const quote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";
  const url = new URL(input.url, origin);
  url.searchParams.forEach((v, k) => {
    if (redact(v, k) !== v) url.searchParams.set(k, "<已隐藏>");
  });
  const parts = [`curl -X ${input.method} ${quote(url.href)}`];
  for (const [key, value] of Object.entries(input.headers))
    parts.push(`-H ${quote(`${key}: ${redact(value, key)}`)}`);
  if (input.auth === "current" && transport === "cookie") {
    parts.push(
      `-H 'Cookie: mas_session=<已隐藏>'`,
      `-H 'X-CSRF-Token: <已隐藏>'`,
      `-H ${quote(`Origin: ${origin}`)}`,
    );
  } else if (input.auth !== "none")
    parts.push(`-H 'Authorization: Bearer <已隐藏>'`);
  if (input.body)
    parts.push(
      `--data-raw ${quote(JSON.stringify(redact(JSON.parse(input.body))))}`,
    );
  return parts.join(" \\\n  ");
}
