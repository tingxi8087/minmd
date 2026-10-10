import { useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export default function FileHeader({
  children,
  className,
  fullscreen = false,
}: {
  children: ReactNode;
  className: string;
  fullscreen?: boolean;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.getElementById("document-header"));
  }, []);
  const inline = !!host && !fullscreen;
  const header = (
    <header className={className} data-inline={inline || undefined}>
      {children}
    </header>
  );
  return inline ? createPortal(header, host) : header;
}
