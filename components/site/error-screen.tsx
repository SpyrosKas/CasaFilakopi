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
      <section className="section bg-pattern">
        <div className="container">
          <div className="page-content text-center">
            <p className="mb-4">{body}</p>
            {children}
          </div>
        </div>
      </section>
    </>
  );
}
