import type { TemplateCopy } from "./types";

// What Yorgos receives (EML-03). Greek is a draft for him to review.

const BOOKING_FACTS = [
  "guestName",
  "guestEmail",
  "guestPhone",
  "reference",
  "houseName",
  "checkIn",
  "checkOut",
  "nights",
  "guests",
  "totalAmount",
  "paidAmount",
  "arrivalTime",
  "specialRequests",
  "adminLink",
] as const;

export interface HostTemplate {
  key: string;
  label: string;
  placeholders: readonly string[];
  required?: readonly string[];
  en: TemplateCopy;
  el: TemplateCopy;
}

const factsEn = `- Guest: {{guestName}}
- Email: {{guestEmail}}
- Phone: {{guestPhone}}
- Reference: {{reference}}
- Dates: {{checkIn}} to {{checkOut}}, {{nights}}
- {{guests}}
- Total: {{totalAmount}}
- Paid: {{paidAmount}}`;

const factsEl = `- Επισκέπτης: {{guestName}}
- Email: {{guestEmail}}
- Τηλέφωνο: {{guestPhone}}
- Κωδικός: {{reference}}
- Ημερομηνίες: {{checkIn}} έως {{checkOut}}, {{nights}}
- {{guests}}
- Σύνολο: {{totalAmount}}
- Πληρωμένα: {{paidAmount}}`;

const openEn = "[Open in Admin]({{adminLink}})";
const openEl = "[Άνοιγμα στη διαχείριση]({{adminLink}})";

export const HOST_TEMPLATES: HostTemplate[] = [
  {
    key: "host_new_booking",
    label: "Host: new booking",
    placeholders: BOOKING_FACTS,
    en: {
      subject: "New booking: {{checkIn}} to {{checkOut}}, {{guestName}}",
      body: `A new booking has been confirmed.

${factsEn}
- Arrival time: {{arrivalTime}}
- Requests: {{specialRequests}}

${openEn}`,
    },
    el: {
      subject: "Νέα κράτηση: {{checkIn}} έως {{checkOut}}, {{guestName}}",
      body: `Επιβεβαιώθηκε νέα κράτηση.

${factsEl}
- Ώρα άφιξης: {{arrivalTime}}
- Αιτήματα: {{specialRequests}}

${openEl}`,
    },
  },
  {
    key: "host_booking_modified",
    label: "Host: booking changed",
    placeholders: [...BOOKING_FACTS, "changes"],
    en: {
      subject: "Booking changed: {{reference}}",
      body: `Booking {{reference}} has changed.

{{changes}}

${factsEn}

${openEn}`,
    },
    el: {
      subject: "Αλλαγή κράτησης: {{reference}}",
      body: `Η κράτηση {{reference}} άλλαξε.

{{changes}}

${factsEl}

${openEl}`,
    },
  },
  {
    key: "host_booking_cancelled",
    label: "Host: booking cancelled",
    placeholders: [...BOOKING_FACTS, "refundAmount"],
    en: {
      subject: "Booking cancelled: {{reference}}",
      body: `Booking {{reference}} has been cancelled. The dates are free again.

${factsEn}
- Refund: {{refundAmount}}

${openEn}`,
    },
    el: {
      subject: "Ακύρωση κράτησης: {{reference}}",
      body: `Η κράτηση {{reference}} ακυρώθηκε. Οι ημερομηνίες είναι ξανά διαθέσιμες.

${factsEl}
- Επιστροφή: {{refundAmount}}

${openEl}`,
    },
  },
  {
    key: "host_payment_failed",
    label: "Host: payment failed",
    placeholders: [...BOOKING_FACTS, "paymentAmount", "reason"],
    en: {
      subject: "A payment failed: {{reference}}",
      body: `A payment did not go through.

- Amount: {{paymentAmount}}
- Reason: {{reason}}
- Guest: {{guestName}}
- Email: {{guestEmail}}
- Reference: {{reference}}
- Dates: {{checkIn}} to {{checkOut}}

${openEn}`,
    },
    el: {
      subject: "Αποτυχία πληρωμής: {{reference}}",
      body: `Μια πληρωμή δεν ολοκληρώθηκε.

- Ποσό: {{paymentAmount}}
- Αιτία: {{reason}}
- Επισκέπτης: {{guestName}}
- Email: {{guestEmail}}
- Κωδικός: {{reference}}
- Ημερομηνίες: {{checkIn}} έως {{checkOut}}

${openEl}`,
    },
  },
  {
    key: "host_dispute_opened",
    label: "Host: payment dispute",
    placeholders: [...BOOKING_FACTS, "paymentAmount", "reason"],
    en: {
      subject: "A payment dispute was opened: {{reference}}",
      body: `A guest's bank has opened a dispute over a payment. Please check it in Stripe.

- Amount: {{paymentAmount}}
- Reason: {{reason}}
- Guest: {{guestName}}
- Reference: {{reference}}
- Dates: {{checkIn}} to {{checkOut}}

${openEn}`,
    },
    el: {
      subject: "Άνοιξε αμφισβήτηση πληρωμής: {{reference}}",
      body: `Η τράπεζα ενός επισκέπτη άνοιξε αμφισβήτηση για μια πληρωμή. Ελέγξτε τη στο Stripe.

- Ποσό: {{paymentAmount}}
- Αιτία: {{reason}}
- Επισκέπτης: {{guestName}}
- Κωδικός: {{reference}}
- Ημερομηνίες: {{checkIn}} έως {{checkOut}}

${openEl}`,
    },
  },
  {
    key: "host_contact_message",
    label: "Host: new contact message",
    placeholders: [
      "guestName",
      "guestEmail",
      "guestPhone",
      "datesOfInterest",
      "language",
      "message",
      "adminLink",
    ],
    required: ["message"],
    en: {
      subject: "New message from {{guestName}}",
      body: `A message arrived through the contact form. Reply to this email to answer the guest directly.

- Name: {{guestName}}
- Email: {{guestEmail}}
- Phone: {{guestPhone}}
- Dates of interest: {{datesOfInterest}}
- Language: {{language}}

{{message}}

${openEn}`,
    },
    el: {
      subject: "Νέο μήνυμα από {{guestName}}",
      body: `Ήρθε μήνυμα από τη φόρμα επικοινωνίας. Απαντήστε σε αυτό το email για να απαντήσετε απευθείας στον επισκέπτη.

- Όνομα: {{guestName}}
- Email: {{guestEmail}}
- Τηλέφωνο: {{guestPhone}}
- Ημερομηνίες ενδιαφέροντος: {{datesOfInterest}}
- Γλώσσα: {{language}}

{{message}}

${openEl}`,
    },
  },
  {
    key: "host_guest_message",
    label: "Host: message from a booked guest",
    placeholders: [...BOOKING_FACTS, "message"],
    required: ["message"],
    en: {
      subject: "Message from {{guestName}}: {{reference}}",
      body: `{{guestName}} sent a message about booking {{reference}}, {{checkIn}} to {{checkOut}}. Reply to this email to answer directly.

{{message}}

${openEn}`,
    },
    el: {
      subject: "Μήνυμα από {{guestName}}: {{reference}}",
      body: `Ο/Η {{guestName}} έστειλε μήνυμα για την κράτηση {{reference}}, {{checkIn}} έως {{checkOut}}. Απαντήστε σε αυτό το email για να απαντήσετε απευθείας.

{{message}}

${openEl}`,
    },
  },
  {
    key: "host_sync_conflict",
    label: "Host: calendar conflict",
    placeholders: ["channel", "checkIn", "checkOut", "summary", "adminLink"],
    en: {
      subject: "Calendar conflict: {{channel}}, {{checkIn}} to {{checkOut}}",
      body: `An imported booking overlaps dates that are already taken. Please check it now, because the same dates may have been sold twice.

- Channel: {{channel}}
- Dates: {{checkIn}} to {{checkOut}}
- Calendar entry: {{summary}}

${openEn}`,
    },
    el: {
      subject:
        "Σύγκρουση ημερολογίου: {{channel}}, {{checkIn}} έως {{checkOut}}",
      body: `Μια εισαγόμενη κράτηση επικαλύπτει ημερομηνίες που είναι ήδη κρατημένες. Ελέγξτε τη τώρα, γιατί οι ίδιες ημερομηνίες μπορεί να πουλήθηκαν δύο φορές.

- Κανάλι: {{channel}}
- Ημερομηνίες: {{checkIn}} έως {{checkOut}}
- Καταχώριση ημερολογίου: {{summary}}

${openEl}`,
    },
  },
  {
    key: "host_sync_failure",
    label: "Host: calendar sync failing",
    placeholders: ["channel", "failures", "errorDetail", "adminLink"],
    en: {
      subject: "Calendar sync is failing: {{channel}}",
      body: `The calendar sync with {{channel}} has failed {{failures}} times in a row. New bookings there may not reach this site until it works again.

- Last error: {{errorDetail}}

${openEn}`,
    },
    el: {
      subject: "Πρόβλημα συγχρονισμού ημερολογίου: {{channel}}",
      body: `Ο συγχρονισμός ημερολογίου με το {{channel}} απέτυχε {{failures}} φορές στη σειρά. Νέες κρατήσεις εκεί μπορεί να μην φτάνουν σε αυτή την ιστοσελίδα μέχρι να λειτουργήσει ξανά.

- Τελευταίο σφάλμα: {{errorDetail}}

${openEl}`,
    },
  },
  {
    key: "host_invoice_failed",
    label: "Host: invoice transmission failed",
    placeholders: ["documentNumber", "errorDetail", "adminLink"],
    en: {
      subject: "A document could not be transmitted: {{documentNumber}}",
      body: `Document {{documentNumber}} could not be transmitted.

- Error: {{errorDetail}}

${openEn}`,
    },
    el: {
      subject: "Αποτυχία διαβίβασης παραστατικού: {{documentNumber}}",
      body: `Το παραστατικό {{documentNumber}} δεν διαβιβάστηκε.

- Σφάλμα: {{errorDetail}}

${openEl}`,
    },
  },
  {
    key: "host_job_failure",
    label: "Host: scheduled task failing",
    placeholders: ["jobName", "failures", "errorDetail"],
    en: {
      subject: "A scheduled task keeps failing: {{jobName}}",
      body: `The scheduled task "{{jobName}}" has failed {{failures}} times in a row. Emails to guests may be late. Please tell the person who looks after the site.

- Last error: {{errorDetail}}`,
    },
    el: {
      subject: "Μια προγραμματισμένη εργασία αποτυγχάνει: {{jobName}}",
      body: `Η προγραμματισμένη εργασία «{{jobName}}» απέτυχε {{failures}} φορές στη σειρά. Τα email προς τους επισκέπτες μπορεί να καθυστερήσουν. Ενημερώστε το άτομο που φροντίζει την ιστοσελίδα.

- Τελευταίο σφάλμα: {{errorDetail}}`,
    },
  },
];
