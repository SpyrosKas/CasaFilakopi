"use client";

import { useLocale } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  pickDate,
  type CalendarRules,
  type Selection,
} from "@/lib/payments/calendar";
import type { AvailabilityView, QuoteView } from "@/lib/payments/quote";

export interface StayChoice extends Selection {
  adults: number;
  children: number;
}

type Load<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; value: T };

/** Loads the free dates when `enabled` turns on, and once only. */
export function useAvailability(enabled: boolean) {
  const [load, setLoad] = useState<Load<AvailabilityView>>({ state: "idle" });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch("/api/checkout/availability")
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const value = (await response.json()) as AvailabilityView;
        if (live) setLoad({ state: "ready", value });
      })
      .catch(() => {
        if (live) setLoad({ state: "failed" });
      });
    return () => {
      live = false;
    };
  }, [enabled]);

  const rules = useMemo<CalendarRules | null>(
    () =>
      load.state === "ready"
        ? {
            firstCheckIn: load.value.firstCheckIn,
            lastNight: load.value.lastNight,
            taken: new Set(load.value.taken),
          }
        : null,
    [load],
  );
  return {
    availability: load.state === "ready" ? load.value : null,
    failed: load.state === "failed",
    rules,
  };
}

type Quote =
  | { state: "none" }
  | { state: "working" }
  | { state: "failed" }
  | { state: "ready"; quote: QuoteView };

/** The live price. The server works it out on every change (BKG-06). */
export function useQuote(choice: StayChoice, promoCode: string): Quote {
  const locale = useLocale();
  const { checkIn, checkOut, adults, children } = choice;
  const [result, setResult] = useState<{ key: string; quote: Quote }>({
    key: "",
    quote: { state: "none" },
  });
  const key =
    checkIn && checkOut
      ? JSON.stringify([checkIn, checkOut, adults, children, promoCode])
      : "";

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/checkout/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          checkIn,
          checkOut,
          adults,
          children,
          locale,
          ...(promoCode ? { promoCode } : {}),
        }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const quote = (await response.json()) as QuoteView;
          setResult({ key, quote: { state: "ready", quote } });
        })
        .catch((error: unknown) => {
          if ((error as Error).name === "AbortError") return;
          setResult({ key, quote: { state: "failed" } });
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, checkIn, checkOut, adults, children, promoCode, locale]);

  if (!key) return { state: "none" };
  return result.key === key ? result.quote : { state: "working" };
}

export function useStayChoice(initial?: Partial<StayChoice>) {
  const [choice, setChoice] = useState<StayChoice>({
    checkIn: initial?.checkIn ?? null,
    checkOut: initial?.checkOut ?? null,
    adults: initial?.adults ?? 2,
    children: initial?.children ?? 0,
  });
  return {
    choice,
    setGuests: (guests: Partial<Pick<StayChoice, "adults" | "children">>) =>
      setChoice((value) => ({ ...value, ...guests })),
    pick: (date: string, rules: CalendarRules) =>
      setChoice((value) => ({ ...value, ...pickDate(value, date, rules) })),
    clear: () =>
      setChoice((value) => ({ ...value, checkIn: null, checkOut: null })),
  };
}

export function stayQuery(choice: StayChoice): string {
  const query = new URLSearchParams();
  if (choice.checkIn) query.set("checkIn", choice.checkIn);
  if (choice.checkOut) query.set("checkOut", choice.checkOut);
  query.set("adults", String(choice.adults));
  query.set("children", String(choice.children));
  return query.toString();
}
