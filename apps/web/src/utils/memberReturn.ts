export function memberReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    /[\\\u0000-\u0020]/.test(value) ||
    value.startsWith("//")
  )
    return "/files";
  const path = value.split("?")[0];
  return /^\/(?:files|recent|favorites|shared|trash|settings\/(?:general|members|ai)|(?:document|preview)\/[a-zA-Z0-9_-]+)$/.test(
    path,
  )
    ? value
    : "/files";
}
export function memberReturnState(value: unknown): {
  path: string;
  spaceId?: string;
} {
  const state = value && typeof value === "object" ? value : {};
  return {
    path: memberReturnPath("returnTo" in state ? state.returnTo : undefined),
    spaceId:
      "returnSpace" in state && typeof state.returnSpace === "string"
        ? state.returnSpace
        : undefined,
  };
}
