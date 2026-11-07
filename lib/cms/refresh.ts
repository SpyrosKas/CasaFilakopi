import "server-only";
import { revalidatePath } from "next/cache";
import { routesForPages } from "@/lib/cms/registry";

/** Refreshes only the public pages that show the changed content (WEB-08). */
export function refreshPublicPages(slugs: string[]) {
  for (const { path, type } of routesForPages(slugs)) {
    revalidatePath(path, type);
  }
}
