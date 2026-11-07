import type { ReactNode } from "react";
import "@/components/admin/cms/cms.css";

/** Styles only. Each page and action makes its own Owner check. */
export default function PhotosLayout({ children }: { children: ReactNode }) {
  return children;
}
