import type { ReactNode } from "react";
import { heroImages } from "@/content/house";
import { PageHero } from "./hero";

/** Shared body of the 404 and error pages. */
export function ErrorScreen({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHero image={heroImages.page} title={title} />
      <section className="section">
        <div className="wrap page-content">
          <p>{body}</p>
          <div className="button-row">{children}</div>
        </div>
      </section>
    </>
  );
}
