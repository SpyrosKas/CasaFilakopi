"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import type { EmailLocale } from "@/emails/types";
import { formatDate, formatMoney } from "@/lib/email/format";
import type { PriceLineView, QuoteView } from "@/lib/payments/quote";

type ReadyQuote = Extract<QuoteView, { ok: true }>;

export function useMoney() {
  const locale = useLocale() as EmailLocale;
  return {
    money: (cents: number) => formatMoney(cents, locale),
    date: (value: string) => formatDate(value, locale),
  };
}

export function PriceLines({ lines }: { lines: PriceLineView[] }) {
  const t = useTranslations("Book.summary");
  const { money } = useMoney();
  return (
    <>
      {lines.map((line, index) => (
        <div className="price-line" key={index}>
          <dt>
            {line.kind === "accommodation"
              ? t("lineNights", {
                  label: line.label,
                  quantity: line.quantity,
                  price: money(line.unitCents),
                })
              : line.label}
          </dt>
          <dd>{money(line.totalCents)}</dd>
        </div>
      ))}
    </>
  );
}

/** BKG-05: every line, then what is paid now and what is left for later. */
export function PriceBreakdownView({ quote }: { quote: ReadyQuote }) {
  const t = useTranslations("Book.summary");
  const { money, date } = useMoney();
  return (
    <>
      <p className="price-nights">{t("nights", { count: quote.nights })}</p>
      <dl className="price-lines">
        <PriceLines lines={quote.lines} />
        <div className="price-line price-line--total">
          <dt>{t("total")}</dt>
          <dd data-testid="price-total">{money(quote.totalCents)}</dd>
        </div>
        <div className="price-line price-line--now">
          <dt>{t("dueNow")}</dt>
          <dd data-testid="price-now">{money(quote.dueNowCents)}</dd>
        </div>
        {quote.balanceCents > 0 && (
          <div className="price-line">
            <dt>
              {quote.balanceDueOn && !quote.balanceOnArrival
                ? t("dueOn", { date: date(quote.balanceDueOn) })
                : t("onArrival")}
            </dt>
            <dd>{money(quote.balanceCents)}</dd>
          </div>
        )}
      </dl>
      {quote.dueNowCents === 0 && <p>{t("noCharge")}</p>}
    </>
  );
}
