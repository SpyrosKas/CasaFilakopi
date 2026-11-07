import type { ReactNode } from "react";
import "./invoices.css";

/** Styles only. Each page and action makes its own Owner check. */
export default function InvoicesLayout({ children }: { children: ReactNode }) {
  return children;
}
