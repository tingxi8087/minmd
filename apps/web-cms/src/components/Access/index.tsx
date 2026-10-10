import { cloneElement, isValidElement } from "react";
import type { ReactNode } from "react";
import type { AccessCode } from "@/.utils/access";
import { useAccess } from "@/hooks/useAccess";

export type AccessMode = "hidden" | "disabled";

export interface AccessProps {
  code?: AccessCode;
  mode?: AccessMode;
  fallback?: ReactNode;
  children: ReactNode;
}

export default function Access({
  code,
  mode = "hidden",
  fallback = null,
  children,
}: AccessProps) {
  const allow = useAccess(code);

  if (allow) return <>{children}</>;
  if (mode === "hidden") return <>{fallback}</>;

  if (isValidElement(children)) {
    return cloneElement(children, {
      disabled: true,
    } as Record<string, unknown>);
  }

  return <>{fallback}</>;
}
