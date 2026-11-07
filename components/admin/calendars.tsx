"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition, type ReactNode } from "react";
import {
  ActionButton,
  ActionForm,
  CheckField,
  Field,
  FieldError,
  FormMessage,
  SelectField,
} from "@/components/admin/form";
import { closeDates, reopenDates } from "@/lib/admin/actions/calendar";
import { clearDailyPrices, setDailyPrices } from "@/lib/admin/actions/rates";
import {
  dayNumber,
  leadingBlanks,
  shiftMonth,
  type CalendarBlock,
  type NightState,
} from "@/lib/admin/calendar";
import { idleState } from "@/lib/admin/form-state";
import {
  formatDate,
  formatEuro,
  formatMonth,
  nightsWord,
} from "@/lib/admin/format";
import { t } from "@/lib/admin/strings";
import {
  addDays,
  daysBetween,
  eachNight,
  isValidIsoDate,
} from "@/lib/domain/dates";

const c = t.calendar;
const r = t.rates;

function WeekHeader() {
  return (
    <>
      {c.weekdays.map((day) => (
        <div key={day} className="cal-head" aria-hidden="true">
          {day}
        </div>
      ))}
    </>
  );
}

const Blanks = ({ month }: { month: string }) =>
  Array.from({ length: leadingBlanks(month) }, (_, index) => (
    <div key={index} aria-hidden="true" />
  ));

function dayClass(night: NightState, today: string, picked: boolean): string {
  return [
    "cal-day",
    night.kind !== "free" && `night-${night.kind}`,
    night.date === today && "cal-today",
    night.isConflict && "cal-conflict",
    picked && "cal-picked",
  ]
    .filter(Boolean)
    .join(" ");
}

const describe = (night: NightState) =>
  c.dayLabel(formatDate(night.date), night.label ?? c.legend[night.kind]);

const blockReasons = Object.entries(c.reasons).map(([value, label]) => ({
  value,
  label,
}));

export function MonthNav({
  month,
  hrefFor,
  label,
}: {
  month: string;
  hrefFor: (month: string) => string;
  label: string;
}) {
  return (
    <nav className="month-nav" aria-label={label}>
      <Link
        href={hrefFor(shiftMonth(month, -1))}
        prefetch={false}
        className="month-step"
        aria-label={c.previous}
      >
        {c.previousShort}
      </Link>
      <span className="month-title">{formatMonth(month)}</span>
      <Link
        href={hrefFor(shiftMonth(month, 1))}
        prefetch={false}
        className="month-step"
        aria-label={c.next}
      >
        {c.nextShort}
      </Link>
    </nav>
  );
}

/**
 * Tap a first and last free night to close them, moving between months in
 * between, so a winter closure is one action. The first night travels in the
 * address. Tap anything else to open it.
 */
export function AvailabilityCalendar({
  month,
  nights,
  today,
  blocks,
  firstNight,
}: {
  month: string;
  nights: NightState[];
  today: string;
  blocks: (CalendarBlock & { title: string })[];
  firstNight: string | null;
}) {
  const router = useRouter();
  const [first, setFirst] = useState<string | null>(firstNight);
  const [last, setLast] = useState<string | null>(null);
  const [blockId, setBlockId] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);

  // Only this month is known here. The database has the last word on the rest.
  const isFree = (date: string) => {
    const night = nights.find((row) => row.date === date);
    return !night || night.kind === "free";
  };

  const reset = () => {
    setFirst(null);
    setLast(null);
    setProblem(false);
  };

  const tapFree = (date: string) => {
    setBlockId(null);
    setProblem(false);
    if (!first || last || date < first) {
      setFirst(date);
      setLast(null);
      return;
    }
    if (eachNight(first, addDays(date, 1)).every(isFree)) setLast(date);
    else setProblem(true);
  };

  const isPicked = (date: string) =>
    first !== null && date >= first && date <= (last ?? first);

  const block = blocks.find((row) => row.id === blockId);
  const end = last ?? first;

  const hrefFor = (target: string) =>
    `/admin/calendar?month=${target}${first && !last ? `&from=${first}` : ""}`;

  return (
    <>
      <MonthNav month={month} hrefFor={hrefFor} label={c.title} />
      <p className="muted small" role="status">
        {problem
          ? c.notFree
          : first
            ? c.pickLast(formatDate(first))
            : c.pickFirst}
      </p>
      <div className="cal">
        <WeekHeader />
        <Blanks month={month} />
        {nights.map((night) => {
          const body = (
            <>
              <span>{dayNumber(night.date)}</span>
              {night.kind !== "free" && (
                <span className="cal-tag">{c.tag[night.kind]}</span>
              )}
            </>
          );
          const className = dayClass(night, today, isPicked(night.date));
          if (night.href) {
            return (
              <Link
                key={night.date}
                href={night.href}
                prefetch={false}
                className={className}
                aria-label={describe(night)}
              >
                {body}
              </Link>
            );
          }
          return (
            <button
              key={night.date}
              type="button"
              className={className}
              aria-label={describe(night)}
              aria-pressed={isPicked(night.date)}
              onClick={() => {
                if (night.blockId) {
                  reset();
                  setBlockId(night.blockId);
                } else {
                  tapFree(night.date);
                }
              }}
            >
              {body}
            </button>
          );
        })}
      </div>

      {first && end && (
        <section className="panel narrow">
          <h2>{c.close}</h2>
          <p>
            {c.picked(
              formatDate(first),
              formatDate(end),
              nightsWord(daysBetween(first, end) + 1),
            )}
          </p>
          <ActionForm
            key={`${first}-${end}`}
            action={async (state, data) => {
              const result = await closeDates(state, data);
              if (result.status === "ok") {
                reset();
                router.replace(`/admin/calendar?month=${month}`);
              }
              return result;
            }}
            submitLabel={c.close}
            pendingLabel={c.closing}
          >
            <input type="hidden" name="from" value={first} />
            <input type="hidden" name="lastNight" value={end} />
            <SelectField
              label={c.reason}
              name="reason"
              defaultValue="owner_use"
              options={blockReasons}
            />
            <Field label={c.note} name="note" hint={c.noteHint} />
          </ActionForm>
          <button type="button" className="button button-quiet" onClick={reset}>
            {c.clearPick}
          </button>
        </section>
      )}

      {block && (
        <section className="panel narrow">
          <h2>{c.blockHeading}</h2>
          <p>
            {block.title}:{" "}
            {c.picked(
              formatDate(block.start),
              formatDate(addDays(block.end, -1)),
              nightsWord(daysBetween(block.start, block.end)),
            )}
          </p>
          <ActionButton
            action={reopenDates}
            fields={{ id: block.id }}
            label={c.reopen}
            pendingLabel={c.reopening}
            confirm={c.reopenConfirm}
          />
        </section>
      )}
    </>
  );
}

/** A function cannot pass from a server page, so this one lives here. */
export function RatesMonthNav({ month }: { month: string }) {
  return (
    <MonthNav
      month={month}
      hrefFor={(target) => `/admin/rates?month=${target}`}
      label={r.title}
    />
  );
}

export interface PriceDay {
  date: string;
  cents: number;
  isOverride: boolean;
}

const WEEK = [1, 2, 3, 4, 5, 6, 0];

function WeekdayBoxes({
  name,
  chosen,
  onToggle,
}: {
  name: string;
  chosen: number[];
  onToggle: (day: number) => void;
}) {
  return (
    <div className="weekday-row">
      {WEEK.map((day) => (
        <label key={day} className="choice">
          <input
            type="checkbox"
            name={name}
            value={day}
            checked={chosen.includes(day)}
            onChange={() => onToggle(day)}
          />
          <span>{r.weekdayNames[day]}</span>
        </label>
      ))}
    </div>
  );
}

/** Exact, and short enough for a square on a phone. */
const priceText = (cents: number) =>
  cents % 100 === 0
    ? `€${cents / 100}`
    : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

/** Hidden copies of the choices, so the second button sends the same days. */
function ClearPrices({
  from,
  to,
  weekdays,
}: {
  from: string;
  to: string;
  weekdays: number[];
}) {
  const [state, formAction, pending] = useActionState(
    clearDailyPrices,
    idleState,
  );
  const [, startTransition] = useTransition();
  return (
    <form
      noValidate
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        // Only worth asking once there is a range to name.
        const needsAsking = isValidIsoDate(from) && isValidIsoDate(to);
        if (
          needsAsking &&
          !window.confirm(r.clearConfirm(formatDate(from), formatDate(to)))
        ) {
          return;
        }
        const data = new FormData(event.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      <FormMessage state={state} />
      {Object.entries(state.fieldErrors ?? {}).map(([name, error]) => (
        <p key={name} className="field-error">
          {error}
        </p>
      ))}
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="to" value={to} />
      {weekdays.map((day) => (
        <input key={day} type="hidden" name="weekdays" value={day} />
      ))}
      <button type="submit" className="button button-quiet" disabled={pending}>
        {pending ? t.common.saving : r.clear}
      </button>
    </form>
  );
}

/** The month of prices, and the form it fills in. */
export function RatesCalendar({
  month,
  days,
  today,
  children,
}: {
  month: string;
  days: PriceDay[];
  today: string;
  children?: ReactNode;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>(WEEK);

  const tap = (date: string) => {
    if (!from || to || date < from) {
      setFrom(date);
      setTo("");
    } else {
      setTo(date);
    }
  };

  const isPicked = (date: string) =>
    from !== "" && date >= from && date <= (to || from);

  return (
    <>
      <div className="cal">
        <WeekHeader />
        <Blanks month={month} />
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            className={[
              "cal-day",
              day.date === today && "cal-today",
              isPicked(day.date) && "cal-picked",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={`${formatDate(day.date)}: ${formatEuro(day.cents)}`}
            aria-pressed={isPicked(day.date)}
            onClick={() => tap(day.date)}
          >
            <span className="cal-tag">{dayNumber(day.date)}</span>
            <span className={day.isOverride ? "price-set" : "price-normal"}>
              {priceText(day.cents)}
              {day.isOverride && "•"}
            </span>
          </button>
        ))}
      </div>
      <p className="muted small">{r.legend}</p>
      {children}
      <section className="panel narrow">
        <h2>{r.bulkHeading}</h2>
        <p className="muted small">{r.pickHint}</p>
        <ActionForm
          action={setDailyPrices}
          submitLabel={r.apply}
          pendingLabel={t.common.saving}
        >
          <div className="field-row">
            <Field
              label={r.from}
              name="from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Field
              label={r.to}
              name="to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <fieldset>
            <legend>{r.weekdays}</legend>
            <WeekdayBoxes
              name="weekdays"
              chosen={weekdays}
              onToggle={(day) =>
                setWeekdays(
                  weekdays.includes(day)
                    ? weekdays.filter((row) => row !== day)
                    : [...weekdays, day],
                )
              }
            />
            <FieldError name="weekdays" />
          </fieldset>
          <Field label={r.price} name="price" inputMode="decimal" />
          <CheckField label={r.confirmFree} name="confirmFree" />
        </ActionForm>
        <ClearPrices from={from} to={to} weekdays={weekdays} />
      </section>
    </>
  );
}
