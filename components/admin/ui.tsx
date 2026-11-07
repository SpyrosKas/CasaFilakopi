import Link from "next/link";
import type { ReactNode } from "react";
import { mailHref, telHref, whatsappHref } from "@/lib/admin/contact";
import { formatEuro, formatStay, nightsWord } from "@/lib/admin/format";
import type { MoneyState, Stay, StayStatus } from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";

// The shared pieces of every admin screen. Plain markup and the classes in
// app/admin/admin.css, with no library behind them.

type Tone = "plain" | "ok" | "bad" | "warn" | "info";

export function Badge({
  tone = "plain",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  return (
    <span className={tone === "plain" ? "badge" : `badge badge-${tone}`}>
      {children}
    </span>
  );
}

export function PageHead({
  title,
  intro,
  action,
}: {
  title: string;
  intro?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {intro && <p className="page-intro">{intro}</p>}
      </div>
      {action}
    </header>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} prefetch={false} className="back-link">
      {label}
    </Link>
  );
}

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

export function Stat({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </>
  );
  return href ? (
    <Link href={href} prefetch={false} className="stat">
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Tabs({
  items,
}: {
  items: { href: string; label: string; count?: number; active: boolean }[];
}) {
  return (
    <nav className="tabs" aria-label={t.common.sections}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          prefetch={false}
          className="tab-link"
          aria-current={item.active ? "page" : undefined}
        >
          {item.label}
          {item.count !== undefined && (
            <span className="tab-count">{item.count}</span>
          )}
        </Link>
      ))}
    </nav>
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

const STATUS_TONE: Record<StayStatus, Tone> = {
  pending_payment: "warn",
  confirmed: "info",
  checked_in: "ok",
  completed: "plain",
  cancelled: "bad",
  refunded: "bad",
  expired: "plain",
  no_show: "bad",
  imported: "plain",
};

const MONEY_TONE: Record<MoneyState, Tone> = {
  unpaid: "warn",
  part_paid: "warn",
  paid: "ok",
  refunded: "plain",
  disputed: "bad",
  dates_only: "plain",
};

/** A booking that ended owes nothing, so it gets no money warning (D9). */
const OPEN_MONEY: StayStatus[] = ["confirmed", "checked_in", "completed"];

export function StayBadges({ stay }: { stay: Stay }) {
  return (
    <span className="row-badges">
      <Badge tone={STATUS_TONE[stay.status]}>
        {t.stay.status[stay.status]}
      </Badge>
      <Badge>{t.stay.source[stay.source]}</Badge>
      {stay.kind === "external" ? (
        <Badge>{t.stay.datesOnly}</Badge>
      ) : (
        (OPEN_MONEY.includes(stay.status) ||
          stay.moneyState === "disputed") && (
          <Badge tone={MONEY_TONE[stay.moneyState]}>
            {t.stay.money[stay.moneyState]}
          </Badge>
        )
      )}
      {stay.isConflicted && <Badge tone="bad">{t.stay.conflict}</Badge>}
    </span>
  );
}

export const stayName = (stay: Stay): string =>
  stay.name ?? stay.summary ?? t.stay.noName;

/** One stay in any list. Links to its page. */
export function StayRow({ stay, side }: { stay: Stay; side?: string }) {
  return (
    <li>
      <Link href={stay.href} prefetch={false} className="row">
        <span className="row-main">
          <span className="row-title">{stayName(stay)}</span>
          <span className="row-sub">
            {formatStay(stay.checkIn, stay.checkOut)}, {nightsWord(stay.nights)}
          </span>
          <StayBadges stay={stay} />
        </span>
        {side && <span className="row-side">{side}</span>}
      </Link>
    </li>
  );
}

export const balanceText = (stay: Stay): string | undefined =>
  stay.balanceCents > 0
    ? t.stay.balanceDue(formatEuro(stay.balanceCents))
    : undefined;

/** Tap to call, email or WhatsApp. Shows only what can really be used. */
export function ContactButtons({
  phone,
  email,
}: {
  phone: string | null;
  email: string | null;
}) {
  const candidates: { href: string | null; label: string }[] = [
    { href: telHref(phone), label: t.contact.call },
    { href: whatsappHref(phone), label: t.contact.whatsapp },
    { href: mailHref(email), label: t.contact.email },
  ];
  const links = candidates.flatMap(({ href, label }) =>
    href ? [{ href, label }] : [],
  );

  if (links.length === 0) {
    return <p className="muted small">{t.contact.none}</p>;
  }
  return (
    <div className="contact-actions">
      {links.map((link) => (
        <a
          key={link.label}
          href={link.href}
          className="button button-quiet"
          rel="noreferrer"
          target={link.href.startsWith("https:") ? "_blank" : undefined}
        >
          {link.label}
        </a>
      ))}
    </div>
  );
}
