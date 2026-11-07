import type { ReactNode } from "react";
import "./email.css";

/** Styles only. Each page and action makes its own Owner check. */
export default function EmailLayout({ children }: { children: ReactNode }) {
  return children;
}
