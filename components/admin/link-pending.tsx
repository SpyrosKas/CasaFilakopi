"use client";

import { useLinkStatus } from "next/link";

/**
 * Put inside a <Link>. While that link's page is on its way, shows a thin bar
 * across the top of the screen, so a tap answers at once even on a slow line.
 * Hidden from screen readers: the page's own heading announces the arrival.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={pending ? "link-pending is-pending" : "link-pending"}
    />
  );
}
