import type { ReactNode } from "react";
import { PageHero } from "./hero";

/** Shared body of the 404 and error pages. */
export function ErrorScreen({
  image,
  title,
  body,
  children,
}: {
  image?: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageHero image={image} title={title} />
      <section className="section">
        <div className="wrap page-content">
          <p>{body}</p>
          <div className="button-row">{children}</div>
        </div>
      </section>
    </>
  );
}
