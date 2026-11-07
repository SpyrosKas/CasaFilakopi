import Link from "next/link";
import type { ReactNode } from "react";

export function Panel({
  title,
  link,
  children,
}: {
  title?: string;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section className="panel">
      {(title || link) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {link && (
            <Link href={link.href} prefetch={false} className="panel-link">
              {link.label}
            </Link>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

export function MoneyLines({
  lines,
}: {
  lines: {
    label: string;
    value: string;
    note?: string;
    strong?: boolean;
  }[];
}) {
  return (
    <dl className="money-table">
      {lines.map((line) => (
        <div
          key={line.label}
          className={line.strong ? "money-line money-strong" : "money-line"}
        >
          <dt>
            {line.label}
            {line.note && <span className="money-note">{line.note}</span>}
          </dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}
