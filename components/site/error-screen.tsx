import type { ReactNode } from "react";
import { PageHero } from "./hero";

/** Part of the code, so this screen needs neither the database nor Storage. */
const ERROR_PHOTO = "/error-hero.webp";

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
      <PageHero image={ERROR_PHOTO} title={title} />
      <section className="section">
        <div className="wrap page-content">
          <p>{body}</p>
          <div className="button-row">{children}</div>
        </div>
      </section>
    </>
  );
}
