// What the host is told when a payment needs attention. These go into an email
// from a webhook or cron, with no admin screen open, so they are written in the
// host's language when sent: see alertHost. The Greek is in alert-strings.el.ts.

export const paymentAlertsEn = {
  stuckEvent: (type: string, id: string, detail: string) =>
    `A Stripe event (${type}, ${id}) has not finished after an hour${detail ? `: ${detail}` : ""}. Please check it.`,
  reconciled: (intent: string) =>
    `Stripe took this payment (${intent}) but its webhook never reached the site. The regular check picked it up and ran it now. Please check the booking, and the webhook endpoint in Stripe.`,
  reconcileFailed: (intent: string) =>
    `URGENT: Stripe took this payment (${intent}) but it could not be recorded here. Please check it in Stripe and in Admin.`,
  overpaid:
    "This booking has received more than its price, usually a second payment. Nothing was refunded automatically. Check the booking in Admin and refund it there if it should go back.",
  datesLost:
    "URGENT: a guest paid, but the dates had already gone, so no booking was made. Their money is being refunded automatically and they have been told. Please contact them.",
  datesLostRefund:
    "URGENT: the automatic refund for a lost booking has not gone through. It will be retried, but please check Stripe and refund the guest there if it stays open.",
  noBooking: (intent: string) =>
    `URGENT: Stripe took a payment (${intent}) for a booking that does not exist here. Please check Stripe.`,
  extraPayment:
    "A second payment arrived on a confirmed booking. Nothing was refunded automatically. Check the booking in Admin and refund it there if it should go back.",
  amountMismatch:
    "URGENT: a payment arrived for a different amount than this checkout expected, so the booking was NOT confirmed. The money is held and nothing was refunded automatically. Check Stripe, then confirm with the guest or refund them from Admin.",
  balanceOnClosed:
    "A balance payment arrived on a booking that is no longer live. Nothing was refunded automatically. Please refund it from Admin.",
  wrongCurrency: (currency: string, intent: string) =>
    `URGENT: a payment arrived in ${currency} instead of euros (${intent}). The booking was NOT confirmed. Please check Stripe.`,
  bankPaymentFailed:
    "A delayed bank payment failed, so the payment was not received.",
  disputeOpened: (reason: string) =>
    `${reason}. The payment shows as disputed in Admin. Reply in the Stripe dashboard before its deadline.`,
  disputeClosed: (status: string) =>
    `A card dispute closed with the result: ${status}. Check it in Stripe.`,
  refundFailed: (refundId: string) =>
    `Stripe reports that this refund failed (${refundId}), so the guest does not have the money back. Please check it in Stripe and refund again from Admin.`,
};

export type PaymentAlertStrings = typeof paymentAlertsEn;
