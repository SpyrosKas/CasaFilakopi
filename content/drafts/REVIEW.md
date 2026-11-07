# Draft texts: what is still missing

These files are drafts in English and Greek. Nothing here is published. Wherever a fact was not known, the text has a visible blank: `[TO FILL IN: ...]` in English and `[ΝΑ ΣΥΜΠΛΗΡΩΘΕΙ: ...]` in Greek. The legal texts (privacy, terms, cancellation, cookies) start with a DRAFT line and must be checked by a lawyer before they go live. Nothing in them states a fixed refund percentage or number of days: they point to the rules shown at booking, which Yorgos edits in Admin.

Files: `faq.json`, `house-rules.json`, `privacy.json`, `terms.json`, `cancellation.json`, `cookies.json`.

## A. Yorgos answers (26)

The house

1. Check-in time (FAQ, house rules, terms).
2. Check-out time (FAQ, house rules, terms).
3. How guests receive the keys or get in (FAQ).
4. Early check-in and late check-out: possible, and on what terms (FAQ).
5. Maximum number of guests (FAQ, house rules, terms).
6. Bed linen and bath towels: provided or not (FAQ).
7. Cleaning: included in the price, and whether there is cleaning during the stay (FAQ).
8. Parking: is there any, and where (FAQ).
9. Children: welcome or not, rules, cot or other equipment (FAQ).
10. Pets: allowed or not, conditions (FAQ, house rules).

House rules 11. Visitors who are not staying: allowed or not. 12. Quiet hours, if any. 13. Smoking: allowed or not, and where. 14. Parties and events: allowed or not. 15. Gas BBQ and fire safety rules, including summer fire restrictions. 16. Any request about water, air conditioning or energy use. 17. Please read the whole house rules and add or remove rules. Only a few general lines about looking after the house and telling you about damage were written from what the site implies; delete them if you do not want them.

Booking and money 18. Damage and security deposit: do you take one, and how is damage handled (terms). 19. Force majeure, or the house cannot be used: what do you offer the guest (terms). 20. If you have to cancel a booking: refund, other dates, something else (cancellation). 21. Early departure and no-show: what happens (cancellation). 22. How long a refund takes to reach the guest (cancellation). 23. What the price includes and what is charged separately, for example cleaning, taxes, extra guests (terms).

The business 24. Legal name, address and tax number of the person or company that rents the house. Appears as `[LEGAL NAME, ADDRESS, TAX NUMBER]` in privacy, terms and cookies. 25. The AMA number (short-term rental registry). Appears as `[AMA NUMBER]` in privacy and terms. Nothing has been stated about it. 26. Whether a data protection officer is appointed, and whether you will ever send marketing emails (privacy). The plan names no marketing at launch, so this is your decision.

## B. Accountant answers (4)

1. Which invoice details must be collected from the guest, for example name, address, tax number (privacy).
2. The name of the accountant or firm that receives invoice data (privacy).
3. How long tax law makes us keep invoices and which guest records, so we can say what is not anonymised after 5 years (privacy). This is question 15 in `docs/accountant-questions.md`.
4. Confirm that anonymising other guest data 5 years after check-out is fine alongside the tax records. The texts say this already as the working default.

## C. Lawyer answers (9)

The lawyer must also read all four legal texts in full, in both languages.

1. Does the right of withdrawal apply to bookings for fixed dates, and what wording to use (terms).
2. What limits on liability are allowed under Greek and EU consumer law (terms).
3. Governing law, which courts, and which consumer complaints body to name (terms).
4. Countries where Supabase, Vercel, Stripe, Resend and Cloudflare process data, and the safeguards for any transfer outside the EU/EEA (privacy). The developer or the providers' settings pages give the regions.
5. How long contact messages that do not become a booking should be kept (privacy).
6. How long cookie-choice records and the short-lived anti-spam records should be kept (privacy and cookies; the cookie text asks only about the consent record).
7. Is the cancellation wording enough, given that the actual rules are shown at booking, and how acceptance is recorded (cancellation).
8. Whether the legal bases listed in the privacy text are right (written from the usual GDPR choices, not checked).
9. The "Last updated" date on each of the four legal texts.

## D. Developer checks (1)

1. Confirm on the live site that the language cookie `NEXT_LOCALE` is set as the cookie text says (first party, session length, set when the language differs from the browser's), and that the Cloudflare Turnstile and Stripe pages set no other cookies that need listing. The cookie text was written from the code: the cookie-choice local storage key `casa-filakopi-cookie-consent`, the server record of the choice (random id, yes or no, policy version, time; no IP or browser details), the language cookie from the next-intl library, and the administrator cookies `cf_admin_activity`, `cf_admin_device` and the Supabase sign-in cookies.

## Facts used, so you can check them

- Whole house only, two bedrooms that can be isolated, interior bathroom, exterior bathroom, exterior kitchen, about 70 sq m courtyard, 2.5 km from Apollonia, amenities as listed on the site.
- Payment: full payment by default, deposit possible; Stripe takes payments; refund rules edited by Yorgos and shown at booking.
- Resend sends email; Supabase stores data; Vercel hosts; Google Maps and Cloudflare Turnstile load only after cookie consent (a visitor who declined can allow Turnstile for the contact form with a button); no analytics.
- The contact form stores a keyed hash of the network address for rate limiting, not the address. Cookie-choice records store no IP or browser details.
- Contact: host@miloscasa.com, phone (+30) 693-470-7765, WhatsApp 00306934707765.
- Greek text uses the site's own words where they exist (for example "ψησταριά υγραερίου", "Ρυθμίσεις cookies").
