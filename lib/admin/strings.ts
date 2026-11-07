// Every word the admin panel shows, in one place, so Greek can be added by
// turning this object into one per language.

import { invoiceStrings } from "@/lib/admin/invoice-strings";

const dayWord = (days: number) => (days === 1 ? "1 day" : `${days} days`);

export const t = {
  common: {
    appName: "Casa Filakopi",
    panelName: "Casa Filakopi admin",
    save: "Save",
    saving: "Saving...",
    saved: "Saved.",
    fixErrors: "Please fix the items marked below.",
    somethingWrong: "Something went wrong. Please try again.",
    errorTitle: "That did not work",
    tryAgain: "Try again",
    menu: "Menu",
    closeMenu: "Close menu",
  },
  nav: {
    home: "Home",
    property: "Property details",
    house: "The house",
    booking: "Booking settings",
    rules: "Payment and cancellation",
    invoices: "Invoices and receipts",
    account: "My account",
    signOut: "Sign out",
  },
  login: {
    title: "Sign in",
    email: "Email",
    password: "Password",
    submit: "Sign in",
    submitting: "Signing in...",
    forgot: "Forgot your password?",
    wrong: "That email or password is not right.",
    locked: (minutes: number) =>
      `Too many tries. Please wait ${minutes} minutes and try again.`,
    busy: "We could not sign you in just now. Please try again in a few minutes.",
    expired:
      "You were signed out because the session ended. Please sign in again.",
    signedOut: "You are signed out.",
    noPublicSignup:
      "This page is for the house team. Accounts are by invitation only.",
  },
  forgot: {
    title: "Forgot your password",
    intro: "Type your email. We will send you a link to choose a new password.",
    submit: "Send the link",
    submitting: "Sending...",
    sent: "If that email has an account, a link is on its way. It can take a few minutes. Please also check your spam folder.",
    back: "Back to sign in",
  },
  confirm: {
    title: "Choose a new password",
    intro: "Tap the button to continue.",
    submit: "Continue",
    submitting: "One moment...",
    badLink:
      "This link has expired or was already used. Please ask for a new one, and open it on the same phone or computer where you asked for it.",
    missing: "This link is not complete.",
    askAgain: "Ask for a new link",
  },
  newPassword: {
    title: "Choose a new password",
    intro: (min: number) =>
      `Use at least ${min} characters. A short sentence works well.`,
    password: "New password",
    confirm: "Type it again",
    submit: "Save my new password",
    submitting: "Saving...",
    failed: "We could not save that password. Please try a different one.",
  },
  mfa: {
    verifyTitle: "Type your 6-digit code",
    verifyIntro:
      "Open your authenticator app and type the code you see for Casa Filakopi.",
    code: "6-digit code",
    verifySubmit: "Continue",
    verifying: "Checking...",
    wrongCode: "That code did not work. Check the app and try the newest code.",
    locked: (minutes: number) =>
      `Too many wrong codes. Please wait ${minutes} minutes and try again.`,
    enrolTitle: "Protect your account",
    enrolIntroOwner:
      "The owner account needs a second step when signing in. You only set this up once.",
    enrolIntroStaff:
      "Add a second step when signing in. This is optional, but safer.",
    stepInstall:
      "Install an authenticator app on your phone. Google Authenticator and Microsoft Authenticator are both free.",
    stepStart: "Then tap the button below.",
    start: "Start setup",
    starting: "One moment...",
    stepScan: "Add Casa Filakopi to the app.",
    onThisPhone: "Add to the app on this phone",
    otherDevice: "On a computer? Scan this picture with your phone.",
    qrAlt: "QR code for your authenticator app",
    manual: "Or type this key into the app:",
    stepCode: "Type the 6-digit code the app shows.",
    enrolSubmit: "Finish setup",
    startFailed: "We could not start the setup. Please try again.",
    enrolFailed:
      "That code did not work. Check the app and try the newest code.",
    signOutInstead: "Sign out",
  },
  home: {
    title: (name: string) => `Hello, ${name}`,
    intro: "Choose what you want to do.",
    staffIntro: "Bookings, calendar and messages will appear here soon.",
  },
  notAllowed: {
    title: "This page is for the owner",
    intro:
      "Your account cannot open this page. If you need it, please ask the owner.",
    back: "Back to home",
  },
  account: {
    title: "My account",
    name: "Name",
    email: "Email",
    role: "Role",
    roleOwner: "Owner",
    roleStaff: "Staff",
    twoStep: "Second step when signing in",
    twoStepOn: "On",
    twoStepOff: "Off",
    twoStepSetup: "Turn it on",
    password:
      "To change your password, sign out and tap “Forgot your password?”.",
  },
  property: {
    title: "Property details",
    intro: "These details appear on the website and on guest emails.",
    name: "Public name",
    legalName: "Legal name",
    address: "Address",
    phone: "Phone",
    email: "Email",
    registration: "Registration number",
    checkIn: "Check-in time",
    checkOut: "Check-out time",
    instagram: "Instagram link",
    facebook: "Facebook link",
    linkHint: "Starts with https://",
  },
  house: {
    title: "The house",
    intro: "The name, description and how many guests can stay.",
    nameEn: "Name in English",
    nameEl: "Name in Greek",
    descriptionEn: "Description in English",
    descriptionEl: "Description in Greek",
    maxAdults: "Most adults",
    maxChildren: "Most children",
    baseGuests: "Guests included in the price",
    photosLater: "Photos and prices will be added here later.",
    missing: "The house has not been set up yet.",
  },
  booking: {
    title: "Booking settings",
    intro: "How long dates stay reserved and how far ahead guests can book.",
    hold: "Minutes a guest has to finish paying",
    holdHint: (min: number) =>
      `The dates stay reserved for this long. The lowest allowed is ${min} minutes.`,
    cutoff: "Last hour to book for the same day",
    cutoffHint: "Use 0 to 24, Greek time. 12 means noon. 24 means no limit.",
    horizon: "How many months ahead guests can book",
  },
  rules: {
    title: "Payment and cancellation",
    intro: "Choose how guests pay and what they get back if they cancel.",
    newOnly:
      "Changes apply to new bookings only. Bookings already made keep the rules they were made with.",
    unreadable:
      "The saved rules could not be read, so the starting values are shown. Please check them and save.",
    paymentHeading: "How guests pay",
    modeFull: "Full payment",
    modeFullHint: "Guests pay everything when they book.",
    modeDeposit: "Deposit",
    modeDepositHint: "Guests pay part when they book and the rest later.",
    depositPercentField: "Deposit, as a percentage of the booking price",
    balanceField: "Days before arrival the rest is due",
    balanceHint: "0 means the guest pays the rest on arrival.",
    cancelHeading: "If a guest cancels",
    nonRefundable: "No refunds, ever",
    tierIntro:
      "Each line says what part of the booking price a guest gets back when they cancel at least that many days before arrival.",
    tierDays: "Days before arrival, or more",
    tierPercent: "Percent of the booking price refunded",
    tierLine: (n: number) => `Line ${n}`,
    addTier: "Add a line",
    removeTier: (n: number) => `Remove line ${n}`,
    previewHeading: "What a guest will read",
    previewPayment: "Payment",
    previewCancellation: "Cancellation",
    saved:
      "Saved. New bookings will use these rules. Existing bookings have not changed.",
    errors: {
      paymentMode: "Please choose how guests pay.",
      depositPercent:
        "The deposit must be at least 1% and below 100%, with at most 2 decimals.",
      depositRequired: "Please type the deposit percentage.",
      depositNotAllowed: "A deposit can only be set when guests pay a deposit.",
      balanceDays: "Days before arrival must be a whole number from 0 to 365.",
      tierDays: "Days must be a whole number from 0 to 3650.",
      tierPercent: "Percent must be from 0 to 100, with at most 2 decimals.",
      tiersInvalid: "Please check the refund lines.",
      tooManyTiers: "Please use 10 lines or fewer.",
      nonRefundableTiers:
        "Remove the refund lines, or untick \u201cNo refunds, ever\u201d.",
      noTiers: "Add at least one line, or tick \u201cNo refunds, ever\u201d.",
      duplicateDays: "Two lines have the same number of days.",
      refundOrder:
        "A guest cannot get more back by cancelling closer to arrival. Check the percent on each line.",
    },
    guest: {
      payFull: "You pay the full price when you book.",
      depositPercent: (percent: number) =>
        `You pay ${percent}% of the booking price when you book.`,
      balance: (days: number) =>
        `You pay the rest ${dayWord(days)} before you arrive.`,
      balanceOnArrival: "You pay the rest when you arrive.",
      lateBooking:
        "If you book later than that, you pay the full price when you book.",
      refundFull: "we refund the full booking price",
      refundNone: "we refund nothing",
      refundPart: (percent: number) =>
        `we refund ${percent}% of the booking price`,
      sentence: (when: string, refund: string) =>
        `If you cancel ${when}, ${refund}.`,
      anyTime: "any time before you arrive",
      orMore: (days: number) => `${dayWord(days)} or more before you arrive`,
      between: (from: number, to: number) =>
        from === to
          ? `${dayWord(from)} before you arrive`
          : `${from} to ${to} days before you arrive`,
      lessThan: (days: number) =>
        `less than ${dayWord(days)} before you arrive`,
      exampleHeading: (price: string) => `Example: a booking of ${price}`,
      examplePaidFull: (paid: string) =>
        `If you have paid everything (${paid})`,
      exampleDepositOnly: (paid: string) =>
        `If you have paid only the deposit (${paid})`,
      back: (amount: string) => `you get ${amount} back`,
      backAndKeep: (back: string, kept: string) =>
        `you get ${back} back and we keep ${kept}`,
      keep: (kept: string) => `we keep the ${kept}`,
      keepAndOwe: (kept: string, owed: string) =>
        `we keep the ${kept} and you still owe ${owed}`,
    },
  },
  invoices: invoiceStrings,
  validation: {
    required: "Please fill this in.",
    tooLong: "This is too long.",
    email: "Please type a real email address.",
    passwordLength: (min: number) => `Please use at least ${min} characters.`,
    passwordMatch: "The two passwords are not the same.",
    totpCode: "The code is 6 numbers.",
    time: "Please choose a time.",
    webLink: "Please use a full link that starts with https://",
    adults: "Must be a whole number from 1 to 30.",
    children: "Must be a whole number from 0 to 30.",
    baseGuests: "Must be a whole number from 1 to 60.",
    baseGuestsTooHigh:
      "This cannot be more than the adults and children added together.",
    holdMinutes: (min: number) => `Must be a whole number from ${min} to 240.`,
    cutoffHour: "Must be a whole number from 0 to 24.",
    horizonMonths: "Must be a whole number from 1 to 36.",
  },
} as const;
