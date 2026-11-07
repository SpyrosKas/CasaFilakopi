import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import type { ReactNode } from "react";
import { mailHref, telHref, whatsappHref } from "@/lib/admin/contact";
import type { AdminI18n } from "@/lib/admin/i18n";
import type { MoneyState, Stay, StayStatus } from "@/lib/admin/stays";

// The shared pieces of every admin screen. Plain markup and the classes in
// app/admin/admin.css, with no library behind them. Panel and MoneyLines have
// their own file, because client components use them and this file reads the
// language cookie.

export { MoneyLines, Panel } from "@/components/admin/panel";

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

export async function Tabs({
  items,
}: {
  items: { href: string; label: string; count?: number; active: boolean }[];
}) {
  const { t } = await adminI18n();

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

export async function StayBadges({ stay }: { stay: Stay }) {
  const { t } = await adminI18n();

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

export const stayName = (stay: Stay, { t }: AdminI18n): string =>
  stay.name ?? stay.summary ?? t.stay.noName;

/** One stay in any list. Links to its page. */
export async function StayRow({ stay, side }: { stay: Stay; side?: string }) {
  const i18n = await adminI18n();
  const { formatStay, nightsWord } = i18n;

  return (
    <li>
      <Link href={stay.href} prefetch={false} className="row">
        <span className="row-main">
          <span className="row-title">{stayName(stay, i18n)}</span>
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

export const balanceText = (
  stay: Stay,
  { t, formatEuro }: AdminI18n,
): string | undefined =>
  stay.balanceCents > 0
    ? t.stay.balanceDue(formatEuro(stay.balanceCents))
    : undefined;

/** Tap to call, email or WhatsApp. Shows only what can really be used. */
export async function ContactButtons({
  phone,
  email,
}: {
  phone: string | null;
  email: string | null;
}) {
  const { t } = await adminI18n();

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
