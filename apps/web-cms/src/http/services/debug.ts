import { request } from "@/http";
export interface Schema {
  type?: string;
  format?: string;
  description?: string;
  default?: unknown;
  example?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  items?: Schema;
  required?: string[];
  $ref?: string;
  allOf?: Schema[];
  anyOf?: Schema[];
  oneOf?: Schema[];
}
export interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: Schema;
}
export interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: { content?: Record<string, { schema?: Schema }> };
  responses?: Record<string, unknown>;
  "x-access"?: {
    auth: boolean;
    authScope?: "admin" | "app";
    permissions: string[];
    superAdmin: boolean;
  };
}
export interface ApiDocument {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}
export interface DebugInput {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  auth: "current" | "none" | "custom";
  token?: string;
  confirmWrite?: boolean;
}
export interface DebugResult {
  status: number;
  duration: number;
  headers: Record<string, unknown>;
  body: string;
}
export async function loadDebug() {
  const [document, config] = await Promise.all([
    request.get<never, ApiDocument>("/api/openapi.json"),
    request.get<never, { environment: string; enabled: boolean }>(
      "/api/debug/config",
    ),
  ]);
  return { document, config };
}
export const executeDebug = (input: DebugInput, signal: AbortSignal) =>
  request.post<never, DebugResult>("/api/debug/execute", input, {
    signal,
    timeout: 30000,
  });
