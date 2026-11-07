import type { EmailTemplateDef, TemplateCopy } from "./types";

// What guests receive (EML-02). All Greek here is a draft for Yorgos to review.
// Nothing here states a fact about the house or a policy: those come from
// Admin or from the booking's own snapshot, as placeholders.

/** Available in every email about a booking. */
export const BOOKING_PLACEHOLDERS = [
  "guestName",
  "reference",
  "houseName",
  "checkIn",
  "checkOut",
  "checkInTime",
  "checkOutTime",
  "nights",
  "guests",
  "totalAmount",
  "paidAmount",
  "balanceAmount",
  "balanceDueDate",
  "cancellationPolicy",
  "bookingLink",
  "directionsLink",
  "address",
  "hostEmail",
  "hostPhone",
] as const;

type GuestTemplate = Pick<
  EmailTemplateDef,
  "key" | "label" | "labelEl" | "needsGuestLink"
> & {
  extra?: readonly string[];
  required?: readonly string[];
  /** Not about a booking, so the booking values are not on offer. */
  standalone?: true;
  /** Yorgos writes this one himself each time. */
  fixed?: true;
  en: TemplateCopy;
  el: TemplateCopy;
};

export const GUEST_TEMPLATES: GuestTemplate[] = [
  {
    key: "booking_confirmation",
    label: "Booking confirmation",
    labelEl: "Επιβεβαίωση κράτησης",
    needsGuestLink: true,
    required: ["reference"],
    en: {
      subject: "Your stay at {{houseName}} is confirmed: {{reference}}",
      body: `Hello {{guestName}},

Thank you for booking {{houseName}}. Your stay is confirmed.

## Your stay
- Reference: {{reference}}
- Arrival: {{checkIn}}, from {{checkInTime}}
- Departure: {{checkOut}}, by {{checkOutTime}}
- {{nights}}, {{guests}}
- Total: {{totalAmount}}
- Paid so far: {{paidAmount}}
- Left to pay: {{balanceAmount}}, by {{balanceDueDate}}

[View your booking]({{bookingLink}})

## If you need to cancel
{{cancellationPolicy}}

Any questions? Just reply to this email.`,
    },
    el: {
      subject: "Η διαμονή σας στο {{houseName}} επιβεβαιώθηκε: {{reference}}",
      body: `Γεια σας {{guestName}},

Σας ευχαριστούμε για την κράτησή σας στο {{houseName}}. Η διαμονή σας επιβεβαιώθηκε.

## Η διαμονή σας
- Κωδικός κράτησης: {{reference}}
- Άφιξη: {{checkIn}}, από τις {{checkInTime}}
- Αναχώρηση: {{checkOut}}, έως τις {{checkOutTime}}
- {{nights}}, {{guests}}
- Σύνολο: {{totalAmount}}
- Έχετε πληρώσει: {{paidAmount}}
- Υπόλοιπο: {{balanceAmount}}, έως τις {{balanceDueDate}}

[Δείτε την κράτησή σας]({{bookingLink}})

## Αν χρειαστεί να ακυρώσετε
{{cancellationPolicy}}

Έχετε κάποια απορία; Απαντήστε απλώς σε αυτό το email.`,
    },
  },
  {
    key: "payment_receipt",
    label: "Payment received",
    labelEl: "Η πληρωμή ελήφθη",
    extra: ["paymentAmount"],
    required: ["paymentAmount"],
    en: {
      subject: "We received your payment: {{reference}}",
      body: `Hello {{guestName}},

We received your payment of {{paymentAmount}} for booking {{reference}}.

- Total: {{totalAmount}}
- Paid so far: {{paidAmount}}
- Left to pay: {{balanceAmount}}, by {{balanceDueDate}}

[View your booking]({{bookingLink}})

This email confirms your payment. It is not a tax document.`,
    },
    el: {
      subject: "Λάβαμε την πληρωμή σας: {{reference}}",
      body: `Γεια σας {{guestName}},

Λάβαμε την πληρωμή σας ύψους {{paymentAmount}} για την κράτηση {{reference}}.

- Σύνολο: {{totalAmount}}
- Έχετε πληρώσει: {{paidAmount}}
- Υπόλοιπο: {{balanceAmount}}, έως τις {{balanceDueDate}}

[Δείτε την κράτησή σας]({{bookingLink}})

Το email αυτό επιβεβαιώνει την πληρωμή σας. Δεν αποτελεί φορολογικό παραστατικό.`,
    },
  },
  {
    key: "invoice_document",
    label: "Invoice or receipt (off while documents are provisional)",
    labelEl:
      "Τιμολόγιο ή απόδειξη (κλειστό όσο τα παραστατικά είναι προσωρινά)",
    extra: ["documentNumber"],
    required: ["documentNumber"],
    en: {
      subject: "Your document {{documentNumber}} for booking {{reference}}",
      body: `Hello {{guestName}},

Your document {{documentNumber}} for booking {{reference}} is attached to this email.`,
    },
    el: {
      subject:
        "Το παραστατικό σας {{documentNumber}} για την κράτηση {{reference}}",
      body: `Γεια σας {{guestName}},

Το παραστατικό σας {{documentNumber}} για την κράτηση {{reference}} επισυνάπτεται σε αυτό το email.`,
    },
  },
  {
    key: "balance_request",
    label: "Balance payment request",
    labelEl: "Αίτημα πληρωμής υπολοίπου",
    needsGuestLink: true,
    required: ["balanceAmount", "bookingLink"],
    en: {
      subject: "The balance for your stay is now due: {{reference}}",
      body: `Hello {{guestName}},

The balance for your stay at {{houseName}} from {{checkIn}} to {{checkOut}} is now due.

- Amount: {{balanceAmount}}
- Due by: {{balanceDueDate}}

[Pay the balance]({{bookingLink}})

Any questions? Just reply to this email.`,
    },
    el: {
      subject:
        "Το υπόλοιπο της διαμονής σας είναι πλέον πληρωτέο: {{reference}}",
      body: `Γεια σας {{guestName}},

Το υπόλοιπο για τη διαμονή σας στο {{houseName}}, από {{checkIn}} έως {{checkOut}}, είναι πλέον πληρωτέο.

- Ποσό: {{balanceAmount}}
- Έως: {{balanceDueDate}}

[Πληρώστε το υπόλοιπο]({{bookingLink}})

Έχετε κάποια απορία; Απαντήστε απλώς σε αυτό το email.`,
    },
  },
  {
    key: "balance_reminder",
    label: "Balance payment reminder",
    labelEl: "Υπενθύμιση πληρωμής υπολοίπου",
    needsGuestLink: true,
    required: ["balanceAmount", "bookingLink"],
    en: {
      subject: "A reminder about your balance: {{reference}}",
      body: `Hello {{guestName}},

A short reminder that the balance of {{balanceAmount}} for your stay from {{checkIn}} to {{checkOut}} has not been paid yet. If you paid in the last few hours, please ignore this email.

[Pay the balance]({{bookingLink}})

Any questions? Just reply to this email.`,
    },
    el: {
      subject: "Υπενθύμιση για το υπόλοιπο της κράτησής σας: {{reference}}",
      body: `Γεια σας {{guestName}},

Μια σύντομη υπενθύμιση ότι το υπόλοιπο των {{balanceAmount}} για τη διαμονή σας από {{checkIn}} έως {{checkOut}} δεν έχει πληρωθεί ακόμη. Αν πληρώσατε τις τελευταίες ώρες, αγνοήστε αυτό το email.

[Πληρώστε το υπόλοιπο]({{bookingLink}})

Έχετε κάποια απορία; Απαντήστε απλώς σε αυτό το email.`,
    },
  },
  {
    key: "pre_arrival",
    label: "Before arrival",
    labelEl: "Πριν την άφιξη",
    en: {
      subject: "Your stay at {{houseName}} is coming up",
      body: `Hello {{guestName}},

We look forward to welcoming you to {{houseName}}.

- Arrival: {{checkIn}}, from {{checkInTime}}
- Departure: {{checkOut}}, by {{checkOutTime}}
- Address: {{address}}
- Phone: {{hostPhone}}

[How to get here]({{directionsLink}})

Please reply to this email with your arrival time, if you have not told us yet.

[View your booking]({{bookingLink}})`,
    },
    el: {
      subject: "Η διαμονή σας στο {{houseName}} πλησιάζει",
      body: `Γεια σας {{guestName}},

Ανυπομονούμε να σας υποδεχτούμε στο {{houseName}}.

- Άφιξη: {{checkIn}}, από τις {{checkInTime}}
- Αναχώρηση: {{checkOut}}, έως τις {{checkOutTime}}
- Διεύθυνση: {{address}}
- Τηλέφωνο: {{hostPhone}}

[Πώς θα έρθετε]({{directionsLink}})

Παρακαλούμε απαντήστε σε αυτό το email με την ώρα άφιξής σας, αν δεν μας την έχετε ήδη πει.

[Δείτε την κράτησή σας]({{bookingLink}})`,
    },
  },
  {
    key: "booking_cancellation",
    label: "Cancellation confirmation",
    labelEl: "Επιβεβαίωση ακύρωσης",
    extra: ["refundAmount"],
    required: ["reference"],
    en: {
      subject: "Your booking has been cancelled: {{reference}}",
      body: `Hello {{guestName}},

Your booking {{reference}} at {{houseName}}, from {{checkIn}} to {{checkOut}}, has been cancelled.

Refund: {{refundAmount}}

## The terms of your booking
{{cancellationPolicy}}

If you have any questions, please reply to this email.`,
    },
    el: {
      subject: "Η κράτησή σας ακυρώθηκε: {{reference}}",
      body: `Γεια σας {{guestName}},

Η κράτησή σας {{reference}} στο {{houseName}}, από {{checkIn}} έως {{checkOut}}, ακυρώθηκε.

Επιστροφή χρημάτων: {{refundAmount}}

## Οι όροι της κράτησής σας
{{cancellationPolicy}}

Για οποιαδήποτε απορία, απαντήστε σε αυτό το email.`,
    },
  },
  {
    key: "refund_confirmation",
    label: "Refund confirmation",
    labelEl: "Επιβεβαίωση επιστροφής χρημάτων",
    extra: ["refundAmount"],
    required: ["refundAmount"],
    en: {
      subject: "Your refund for booking {{reference}}",
      body: `Hello {{guestName}},

We have refunded {{refundAmount}} for booking {{reference}}.

If you have any questions, please reply to this email.`,
    },
    el: {
      subject: "Η επιστροφή χρημάτων για την κράτηση {{reference}}",
      body: `Γεια σας {{guestName}},

Σας επιστρέψαμε {{refundAmount}} για την κράτηση {{reference}}.

Για οποιαδήποτε απορία, απαντήστε σε αυτό το email.`,
    },
  },
  {
    key: "contact_auto_reply",
    label: "Contact form: automatic reply",
    labelEl: "Φόρμα επικοινωνίας: αυτόματη απάντηση",
    standalone: true,
    // No guest-typed value here: anyone can type someone else's address, so
    // this email must not be able to carry their words.
    extra: ["houseName", "hostPhone", "siteLink"],
    en: {
      subject: "We received your message: {{houseName}}",
      body: `Hello,

Thank you for writing to {{houseName}}. We received your message and will answer as soon as we can.

For anything urgent, please call {{hostPhone}}.`,
    },
    el: {
      subject: "Λάβαμε το μήνυμά σας: {{houseName}}",
      body: `Γεια σας,

Σας ευχαριστούμε που επικοινωνήσατε με το {{houseName}}. Λάβαμε το μήνυμά σας και θα σας απαντήσουμε το συντομότερο δυνατό.

Για κάτι επείγον, καλέστε μας στο {{hostPhone}}.`,
    },
  },
  {
    key: "thank_you",
    label: "Thank you after the stay (off by default)",
    labelEl: "Ευχαριστώ μετά τη διαμονή (κλειστό αρχικά)",
    en: {
      subject: "Thank you for staying at {{houseName}}",
      body: `Hello {{guestName}},

Thank you for staying at {{houseName}}. We hope you enjoyed your time on Milos.

We would love to welcome you back.`,
    },
    el: {
      subject: "Σας ευχαριστούμε για τη διαμονή σας στο {{houseName}}",
      body: `Γεια σας {{guestName}},

Σας ευχαριστούμε για τη διαμονή σας στο {{houseName}}. Ελπίζουμε να περάσατε όμορφα στη Μήλο.

Θα χαρούμε να σας υποδεχτούμε ξανά.`,
    },
  },
  {
    key: "host_message",
    label: "Message written by the host",
    labelEl: "Μήνυμα που γράφει ο οικοδεσπότης",
    standalone: true,
    fixed: true,
    extra: ["messageSubject", "message"],
    required: ["messageSubject", "message"],
    en: { subject: "{{messageSubject}}", body: "{{message}}" },
    el: { subject: "{{messageSubject}}", body: "{{message}}" },
  },
];
