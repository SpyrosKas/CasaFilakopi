import type { ReactNode } from "react";
import "./integrations.css";

/** Styles only. The page and each action make their own Owner check. */
export default function IntegrationsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
