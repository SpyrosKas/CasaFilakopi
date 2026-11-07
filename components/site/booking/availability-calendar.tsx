"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { IsoDate } from "@/lib/domain/contracts";
import { addDays, dayOfWeek } from "@/lib/domain/dates";
import {
  canCheckIn,
  isDateEnabled,
  monthKey,
  nightsAllowed,
  stayLengthProblem,
  monthWeeks,
  shiftMonth,
  type CalendarRules,
  type LengthProblem,
  type Selection,
} from "@/lib/payments/calendar";

const intlLocale = (locale: string) => (locale === "el" ? "el-GR" : "en-GB");

/** Short enough for a phone-width day: €120 or 120€, no decimals. */
const nightPrice = (cents: number, locale: string) => {
  const euros = Math.round(cents / 100);
  return locale === "el" ? `${euros}€` : `€${euros}`;
};

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

const longDate = (date: IsoDate, locale: string) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(date));

const monthName = (month: string, locale: string) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(utc(`${month}-01`));

/** Monday first. 2024-01-01 was a Monday. */
const weekdays = (locale: string) =>
  Array.from({ length: 7 }, (_, index) => {
    const date = addDays("2024-01-01", index);
    const format = (weekday: "short" | "long") =>
      new Intl.DateTimeFormat(intlLocale(locale), {
        weekday,
        timeZone: "UTC",
      }).format(utc(date));
    return { short: format("short"), long: format("long") };
  });

function useMonthsShown() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 900px)");
    const update = () => setCount(wide.matches ? 2 : 1);
    update();
    wide.addEventListener("change", update);
    return () => wide.removeEventListener("change", update);
  }, []);
  return count;
}

interface Props {
  rules: CalendarRules;
  /** Price per night in cents, for free nights only. */
  prices?: Readonly<Record<IsoDate, number>>;
  selection: Selection;
  onPick: (date: IsoDate) => void;
  onClear: () => void;
}

/**
 * Keyboard: arrows move a day or a week, Home and End go to the ends of the
 * week, Page Up and Down change month, Enter or Space picks. One day holds the
 * tab stop, so the whole grid is a single stop in the page.
 */
export function AvailabilityCalendar({
  rules,
  prices = {},
  selection,
  onPick,
  onClear,
}: Props) {
  const t = useTranslations("Book.calendar");
  const locale = useLocale();
  const monthsShown = useMonthsShown();
  const start = selection.checkIn ?? rules.firstCheckIn;

  const [month, setMonth] = useState(monthKey(start));
  const [cursor, setCursor] = useState<IsoDate>(start);
  const moved = useRef(false);
  const [notice, setNotice] = useState<{
    checkIn: IsoDate | null;
    problem: LengthProblem;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const firstMonth = monthKey(rules.firstCheckIn);
  const lastMonth = monthKey(rules.lastNight);
  const months = Array.from({ length: monthsShown }, (_, index) =>
    shiftMonth(month, index),
  ).filter((value) => value <= shiftMonth(lastMonth, 1));
  const atStart = month <= firstMonth;
  const atEnd = month >= lastMonth;

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    root.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${cursor}"]`)
      ?.focus();
  }, [cursor, month]);

  function moveTo(date: IsoDate) {
    const lowest = `${firstMonth}-01`;
    const target = date < lowest ? lowest : date;
    const targetMonth = monthKey(target);
    if (targetMonth > shiftMonth(lastMonth, 1)) return;
    moved.current = true;
    setCursor(target);
    if (targetMonth < month) setMonth(targetMonth);
    else if (targetMonth > months[months.length - 1]) {
      setMonth(shiftMonth(targetMonth, 1 - months.length));
    }
  }

  function changeMonth(by: number) {
    const next = shiftMonth(month, by);
    setMonth(next);
    setCursor(`${next}-01`);
  }

  function onKeyDown(event: KeyboardEvent, date: IsoDate) {
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
      Home: -((dayOfWeek(date) + 6) % 7),
      End: 6 - ((dayOfWeek(date) + 6) % 7),
      PageUp: -30,
      PageDown: 30,
    };
    if (event.key in step) {
      event.preventDefault();
      moveTo(addDays(date, step[event.key]));
    }
  }

  const { checkIn, checkOut } = selection;
  // A notice belongs to the arrival it was about, and goes once that changes.
  const shownNotice =
    notice && notice.checkIn === checkIn && !checkOut ? notice.problem : null;
  const allowed = checkIn && !checkOut ? nightsAllowed(checkIn, rules) : null;
  const generalMin = rules.minNights ?? 1;

  function dayLabel(date: IsoDate) {
    const when = longDate(date, locale);
    if (date === checkIn) return t("dayCheckIn", { date: when });
    if (date === checkOut) return t("dayCheckOut", { date: when });
    if (checkIn && checkOut && date > checkIn && date < checkOut) {
      return t("dayInStay", { date: when });
    }
    if (isDateEnabled(date, selection, rules)) {
      const price = prices[date];
      if (canCheckIn(date, rules) && price !== undefined) {
        return t("dayFreePrice", {
          date: when,
          price: nightPrice(price, locale),
        });
      }
      return canCheckIn(date, rules)
        ? t("dayFree", { date: when })
        : t("dayDepartureOnly", { date: when });
    }
    return t("dayTaken", { date: when });
  }

  function dayClass(date: IsoDate) {
    const classes = ["cal-day"];
    if (date < rules.firstCheckIn && date !== checkIn && date !== checkOut) {
      classes.push("cal-day--past");
    }
    if (
      checkIn &&
      !checkOut &&
      allowed &&
      date > checkIn &&
      date < addDays(checkIn, allowed.min)
    ) {
      classes.push("cal-day--short");
    }
    if (rules.taken.has(date)) classes.push("cal-day--taken");
    if (date === checkIn) classes.push("cal-day--start");
    if (date === checkOut) classes.push("cal-day--end");
    if (checkIn && checkOut && date > checkIn && date < checkOut) {
      classes.push("cal-day--range");
    }
    return classes.join(" ");
  }

  // The tab stop must sit on a day that is on screen.
  const tabStop =
    months.some((value) => monthKey(cursor) === value) || !months[0]
      ? cursor
      : `${months[0]}-01`;

  return (
    <div className="calendar" ref={root} role="group" aria-label={t("label")}>
      <div className="calendar__nav">
        <button
          type="button"
          className="calendar__arrow"
          aria-label={t("previous")}
          disabled={atStart}
          onClick={() => changeMonth(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <button
          type="button"
          className="calendar__arrow"
          aria-label={t("next")}
          disabled={atEnd}
          onClick={() => changeMonth(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="calendar__months">
        {months.map((value) => (
          <table key={value} className="calendar__month">
            <caption aria-live="polite">{monthName(value, locale)}</caption>
            <thead>
              <tr>
                {weekdays(locale).map((day) => (
                  <th key={day.long} scope="col" abbr={day.long}>
                    {day.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthWeeks(value).map((week, index) => (
                <tr key={index}>
                  {week.map((date, day) => (
                    <td
                      key={date ?? `gap-${day}`}
                      className={
                        date &&
                        prices[date] !== undefined &&
                        date >= rules.firstCheckIn
                          ? "cal-cell--priced"
                          : undefined
                      }
                    >
                      {date && (
                        <button
                          type="button"
                          data-date={date}
                          className={dayClass(date)}
                          aria-label={dayLabel(date)}
                          aria-disabled={!isDateEnabled(date, selection, rules)}
                          aria-pressed={date === checkIn || date === checkOut}
                          tabIndex={date === tabStop ? 0 : -1}
                          onClick={() => {
                            setCursor(date);
                            const problem = stayLengthProblem(
                              date,
                              selection,
                              rules,
                            );
                            setNotice(problem && { checkIn, problem });
                            if (isDateEnabled(date, selection, rules)) {
                              onPick(date);
                            }
                          }}
                          onKeyDown={(event) => onKeyDown(event, date)}
                        >
                          <span className="cal-day__num">
                            {Number(date.slice(8))}
                          </span>
                        </button>
                      )}
                      {/* Outside the button, so its visible text matches its
                          spoken name. The name already says the price. */}
                      {date &&
                        prices[date] !== undefined &&
                        date >= rules.firstCheckIn && (
                          <span
                            className="cal-day__price"
                            aria-hidden="true"
                            // A tap on the price is a tap on its day. Keyboard
                            // and screen readers reach the button itself.
                            onClick={(event) =>
                              (
                                event.currentTarget
                                  .previousElementSibling as HTMLButtonElement | null
                              )?.click()
                            }
                          >
                            {nightPrice(prices[date], locale)}
                          </span>
                        )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>

      <p className="calendar__notice" role="status" aria-live="polite">
        {shownNotice?.kind === "short"
          ? t("tooShort", { count: shownNotice.nights })
          : shownNotice?.kind === "long"
            ? t("tooLong", { count: shownNotice.nights })
            : allowed && allowed.min > 1
              ? t("minFromArrival", { count: allowed.min })
              : !checkIn && generalMin > 1
                ? t("minGeneral", { count: generalMin })
                : null}
      </p>

      <div className="calendar__foot">
        <ul className="calendar__legend">
          <li>
            <span className="swatch swatch--free" aria-hidden="true" />
            {t("free")}
          </li>
          <li>
            <span className="swatch swatch--taken" aria-hidden="true" />
            {t("taken")}
          </li>
          <li>
            <span className="swatch swatch--selected" aria-hidden="true" />
            {t("selected")}
          </li>
          <li>
            <span className="swatch swatch--past" aria-hidden="true" />
            {t("past")}
          </li>
        </ul>
        {Object.keys(prices).length > 0 && (
          <p className="calendar__price-note">{t("priceNote")}</p>
        )}
        {checkIn && (
          <button type="button" className="link-button" onClick={onClear}>
            {t("clear")}
          </button>
        )}
      </div>
    </div>
  );
}
