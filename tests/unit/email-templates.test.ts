import { describe, expect, it, vi } from "vitest";
import { findTemplate, TEMPLATES } from "@/emails/registry";
import { EMAIL_LOCALES, type EmailLocale } from "@/emails/types";
import { describeCancellation } from "@/lib/email/format";
import { renderCopy, renderEmail } from "@/lib/email/render";
import {
  fillSubject,
  validateCopy,
  validateText,
} from "@/lib/email/template-text";

const shell = { brandName: "Casa Filakopi", footer: ["host@example.com"] };

const render = (key: string, locale: EmailLocale, values = {}) => {
  const def = findTemplate(key)!;
  return renderEmail(def, {
    ...shell,
    locale,
    values: { ...def.sample[locale], ...values },
  });
};

const guestKeys = [
  "booking_confirmation",
  "payment_receipt",
  "invoice_document",
  "balance_request",
  "balance_reminder",
  "pre_arrival",
  "booking_cancellation",
  "refund_confirmation",
  "contact_auto_reply",
  "thank_you",
];
const hostKeys = [
  "host_new_booking",
  "host_booking_modified",
  "host_booking_cancelled",
  "host_payment_failed",
  "host_dispute_opened",
  "host_contact_message",
  "host_guest_message",
  "host_sync_conflict",
  "host_sync_failure",
  "host_invoice_failed",
];

describe("the template list", () => {
  it("covers every email in EML-02 and EML-03", () => {
    const keys = TEMPLATES.map((template) => template.key);
    expect(keys).toEqual(expect.arrayContaining([...guestKeys, ...hostKeys]));
  });

  it("resolves the key other tracks write", () => {
    expect(findTemplate("host_message")?.audience).toBe("guest");
    expect(findTemplate("sync_conflict")?.key).toBe("host_sync_conflict");
  });
});

describe.each(TEMPLATES.map((template) => [template.key, template] as const))(
  "%s",
  (_key, def) => {
    describe.each(EMAIL_LOCALES.map((locale) => [locale] as const))(
      "%s",
      (locale) => {
        it("passes its own validation", () => {
          expect(validateCopy(def, def.copy[locale])).toEqual([]);
        });

        it("has a sample for every placeholder", () => {
          for (const name of def.placeholders) {
            expect(def.sample[locale][name], name).toBeTruthy();
          }
        });

        it("renders html and plain text with nothing left over", () => {
          const email = render(def.key, locale);
          expect(email.subject).not.toBe("");
          expect(email.html).toContain(`<html lang="${locale}">`);
          expect(email.html).not.toMatch(/\{\{|\}\}/);
          expect(email.text).not.toMatch(/\{\{|\}\}|<[a-z]/);
          expect(email.text.length).toBeGreaterThan(10);
        });

        it("escapes every value in the html", () => {
          const attack = `<script>alert("x")</script>&'`;
          const values = Object.fromEntries(
            def.placeholders.map((name) => [name, attack]),
          );
          const { html } = render(def.key, locale, values);
          expect(html).not.toContain("<script>");
          expect(html).not.toContain(`alert("x")`);
        });

        it("drops a line whose value is missing, never showing a gap", () => {
          const empty = Object.fromEntries(
            def.placeholders.map((name) => [name, null]),
          );
          const { html, text } = render(def.key, locale, empty);
          expect(html).not.toContain("null");
          expect(text).not.toMatch(/undefined|null/);
        });
      },
    );
  },
);

describe("Greek text", () => {
  it("is really in Greek for every guest and host email", () => {
    for (const def of TEMPLATES.filter((item) => item.editable)) {
      expect(def.copy.el.body, def.key).toMatch(/[Ͱ-Ͽ]{3}/);
      expect(def.copy.el.body, def.key).not.toBe(def.copy.en.body);
    }
  });
});

describe("what a guest can never be told", () => {
  const owed = /owe|still to pay|left to pay|outstanding|οφείλ|υπόλοιπο/i;

  it.each(["en", "el"] as const)(
    "cancellation mentions no debt once the balance is gone (%s)",
    (locale) => {
      const { text, html } = render("booking_cancellation", locale, {
        balanceAmount: null,
        balanceDueDate: null,
      });
      expect(text).not.toMatch(owed);
      expect(html).not.toMatch(owed);
    },
  );

  it("cancellation text never uses the balance placeholder", () => {
    for (const locale of EMAIL_LOCALES) {
      const { body } = findTemplate("booking_cancellation")!.copy[locale];
      expect(body).not.toContain("balance");
    }
  });
});

describe("the small template language", () => {
  const allowed = ["guestName", "link"];

  it("refuses an unknown placeholder", () => {
    expect(
      validateText({ subject: "Hi", body: "{{gustName}}" }, allowed),
    ).toEqual(["unknown:gustName"]);
  });

  it("refuses broken braces", () => {
    expect(
      validateText({ subject: "Hi {{guestName", body: "x" }, allowed),
    ).toContain("broken_braces");
    expect(
      validateText({ subject: "Hi", body: "{guestName}}" }, allowed),
    ).toContain("broken_braces");
  });

  it("refuses a line break in a subject", () => {
    expect(
      validateText({ subject: "Hi\nBcc: a@b", body: "x" }, allowed),
    ).toContain("subject_line_break");
  });

  it("refuses text without what the email needs", () => {
    const def = findTemplate("balance_request")!;
    expect(validateCopy(def, { subject: "Pay", body: "Please pay." })).toEqual([
      "missing:balanceAmount",
      "missing:bookingLink",
    ]);
  });

  it("keeps a guest's braces and markup as plain text", () => {
    const { html, text } = renderCopy(
      { subject: "New", body: "{{message}}" },
      {
        ...shell,
        locale: "en",
        values: {
          message: "{{guestName}} <b>hi</b>\nline two",
          guestName: "X",
        },
      },
    );
    expect(text).toContain("{{guestName}} <b>hi</b>");
    expect(html).toContain("{{guestName}} &lt;b&gt;hi&lt;/b&gt;<br>line two");
  });

  it("makes a button only from a web link", () => {
    const copy = { subject: "S", body: "[Open]({{link}})" };
    const options = { ...shell, locale: "en" as const };
    const good = renderCopy(copy, {
      ...options,
      values: { link: "https://example.com/a?b=1&c=2" },
    });
    expect(good.html).toContain(`href="https://example.com/a?b=1&amp;c=2"`);
    expect(good.text).toContain("Open: https://example.com/a?b=1&c=2");

    const bad = renderCopy(copy, {
      ...options,
      values: { link: "javascript:alert(1)" },
    });
    expect(bad.html).not.toContain("javascript:");
    expect(bad.html).not.toContain("<a ");
  });

  it("keeps a value in a subject on one line", () => {
    expect(
      fillSubject("New from {{guestName}}", {
        guestName: "Eve\r\nBcc: victim@example.com",
      }),
    ).toBe("New from Eve Bcc: victim@example.com");
  });
});

describe("text saved in Admin", () => {
  const def = findTemplate("thank_you")!;
  const options = {
    ...shell,
    locale: "en" as const,
    values: def.sample.en,
  };

  it("replaces the built-in text", () => {
    const email = renderEmail(def, {
      ...options,
      override: { subject: "Bye {{guestName}}", body: "Come back." },
    });
    expect(email.subject).toBe("Bye Alex Example");
    expect(email.text).toContain("Come back.");
  });

  it("falls back to the built-in text if it no longer validates", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const email = renderEmail(def, {
      ...options,
      override: { subject: "Bye {{oldName}}", body: "x" },
    });
    expect(email.subject).toContain("Thank you");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("cancellation terms come from the snapshot", () => {
  const rules = {
    isNonRefundable: false,
    tiers: [
      { daysBefore: 0, refundPercent: 0 },
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 14, refundPercent: 50 },
    ],
  };

  it("words each tier, furthest from arrival first", () => {
    expect(describeCancellation(rules, "en")).toBe(
      [
        "Cancelling 30 days or more before arrival: 100% of the booking price is refunded.",
        "Cancelling less than 30 days before arrival: 50% of the booking price is refunded.",
        "Cancelling less than 14 days before arrival: no refund.",
      ].join("\n"),
    );
    expect(describeCancellation(rules, "el")).toContain("30 ημέρες");
  });

  it("states a non-refundable booking", () => {
    expect(
      describeCancellation({ isNonRefundable: true, tiers: [] }, "en"),
    ).toBe("This booking cannot be refunded if cancelled.");
  });

  it("guesses nothing when the snapshot has no terms", () => {
    expect(describeCancellation(undefined, "en")).toBeNull();
    expect(
      describeCancellation({ isNonRefundable: false, tiers: [] }, "el"),
    ).toBeNull();
  });
});
