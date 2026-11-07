import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { BookingMessages } from "@/components/site/booking/booking-messages";
import {
  CancelBooking,
  MessageHost,
  PayBalance,
  RequestCancellation,
} from "@/components/site/booking/guest-actions";
import { PriceLines } from "@/components/site/booking/price-summary";
import "@/components/site/booking/booking.css";
import { PageHero } from "@/components/site/hero";
import { heroImages } from "@/content/house";
import type { EmailLocale } from "@/emails/types";
import { describeCancellation, formatDate, formatMoney } from "@/lib/email/format";
import { snapshotRules } from "@/lib/admin/stays";
import { loadGuestView } from "@/lib/payments/guest";
import { priceLines } from "@/lib/payments/quote";
import { paymentDeps } from "@/lib/payments/server";

// The guest's private page (SUP-15). The address is the key, so it is rendered
// for each request and never cached (next.config.ts also sets the headers), it
// asks search engines to stay away and sends no referrer, and a wrong or expired
// token gets the site's plain 404, with no hint of which it was.

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Book.guest" });
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false, nocache: true },
    referrer: "no-referrer",
  };
}

const CAN_PAY = ["confirmed", "checked_in"];

export default async function GuestBookingPage({ params }: Props) {
  const { locale, token } = await params;
  setRequestLocale(locale);

  const view = await loadGuestView(paymentDeps(), token);
  if (!view) notFound();

  const t = await getTranslations("Book.guest");
  const tSummary = await getTranslations("Book.summary");
  const { booking, cancel } = view;
  const emailLocale = locale as EmailLocale;
  const money = (cents: number) => formatMoney(cents, emailLocale);
  const date = (value: string) => formatDate(value, emailLocale);
  const rulesText = describeCancellation(
    snapshotRules(booking.rules_snapshot),
    emailLocale,
  );
  const dueOn = booking.price_breakdown?.balanceDueOn;
  const lines = booking.price_breakdown?.lines
    ? priceLines(booking.price_breakdown, emailLocale)
    : [];
  const statusKey = t.has(`status.${booking.status}`)
    ? t(`status.${booking.status}`)
    : booking.status;

  return (
    <>
      <PageHero image={heroImages.page} title={t("title")} />
      <section className="section">
        <div className="wrap">
          <BookingMessages>
            <div className="guest-booking">
              {booking.guest_name && (
                <p className="book-intro">
                  {t("hello", { name: booking.guest_name })}
                </p>
              )}

              <div className="guest-panel">
              <dl className="guest-facts">
                <div>
                  <dt>{t("state")}</dt>
                  <dd data-testid="guest-status">{statusKey}</dd>
                </div>
                <div>
                  <dt>{t("reference")}</dt>
                  <dd>{booking.reference ?? t("noReference")}</dd>
                </div>
                <div>
                  <dt>{t("arrive")}</dt>
                  <dd>{date(booking.check_in)}</dd>
                </div>
                <div>
                  <dt>{t("leave")}</dt>
                  <dd>{date(booking.check_out)}</dd>
                </div>
                <div>
                  <dt>{t("guests")}</dt>
                  <dd>
                    {t("guestCount", {
                      adults: booking.adults,
                      children: booking.children,
                    })}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="guest-panel">
              <h2>{t("priceTitle")}</h2>
              <dl className="price-lines">
                <PriceLines lines={lines} />
                <div className="price-line price-line--total">
                  <dt>{tSummary("total")}</dt>
                  <dd>{money(booking.total_cents)}</dd>
                </div>
                <div className="price-line">
                  <dt>{t("paid")}</dt>
                  <dd data-testid="guest-paid">{money(view.paidCents)}</dd>
                </div>
                {view.refundedCents > 0 && (
                  <div className="price-line">
                    <dt>{t("refunded")}</dt>
                    <dd>{money(view.refundedCents)}</dd>
                  </div>
                )}
                {view.balanceCents > 0 && (
                  <div className="price-line price-line--now">
                    <dt>{t("balance")}</dt>
                    <dd data-testid="guest-balance">
                      {money(view.balanceCents)}
                    </dd>
                  </div>
                )}
              </dl>
              {view.balanceCents > 0 && dueOn && (
                <p>
                    {dueOn === booking.check_in
                      ? tSummary("onArrival")
                      : t("dueOn", { date: date(dueOn) })}
                  </p>
              )}
              {view.balanceCents > 0 && CAN_PAY.includes(booking.status) && (
                <PayBalance token={token} />
              )}
            </div>

            {rulesText && cancel.route !== "closed" && (
              <div className="guest-panel">
                <h2>{t("rulesTitle")}</h2>
                {rulesText.split("\n").map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            )}

            {cancel.route !== "closed" && (
              <div className="guest-panel">
                <h2>{t("cancelTitle")}</h2>
                {cancel.route === "direct" ? (
                  <CancelBooking
                    token={token}
                    refundCents={cancel.outcome?.refundCents ?? 0}
                  />
                ) : (
                  <RequestCancellation token={token} />
                )}
              </div>
            )}

            <div className="guest-panel">
              <h2>{t("messageTitle")}</h2>
              <MessageHost token={token} />
              </div>
            </div>
          </BookingMessages>
        </div>
      </section>
    </>
  );
}
