"use client";

import { useEffect } from "react";

/** Asks before leaving a page with changes that are not saved. */
export function useUnsavedWarning(unsaved: boolean) {
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
}
