// Every word the admin panel shows, in one place, so Greek can be added by
// turning this object into one per language.

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
    cutoffHint: "Use 0 to 23, Greek time. 12 means noon.",
    horizon: "How many months ahead guests can book",
  },
  rules: {
    title: "Payment and cancellation",
    intro: "Choose how guests pay and what they get back if they cancel.",
    newOnly:
      "Changes apply to new bookings only. Bookings already made keep the rules they were made with.",
    paymentHeading: "How guests pay",
    modeFull: "Full price when they book",
    modeDeposit: "A deposit when they book, the rest later",
    modeOnArrival: "Nothing online, they pay when they arrive",
    depositHeading: "Deposit",
    depositPercent: "A percentage of the price",
    depositFixed: "A fixed amount",
    depositPercentField: "Deposit in percent",
    depositAmountField: "Deposit in euros",
    balanceField: "Days before arrival the rest is due",
    cancelHeading: "If a guest cancels",
    nonRefundable: "No refunds, ever",
    tierIntro:
      "Each line says how much a guest gets back when they cancel at least that many days before arrival. You need one line for 0 days.",
    tierDays: "Days before arrival, or more",
    tierPercent: "Percent refunded",
    tierLine: (n: number) => `Line ${n}`,
    addTier: "Add a line",
    removeTier: (n: number) => `Remove line ${n}`,
    previewHeading: "What a guest will read",
    previewPayment: "Payment",
    previewCancellation: "Cancellation",
    onArrivalNote:
      "Guests pay nothing online, so these refunds only matter if you take money some other way.",
    saved:
      "Saved. New bookings will use these rules. Existing bookings have not changed.",
    errors: {
      paymentMode: "Please choose how guests pay.",
      depositPercent:
        "The deposit must be a whole number from 1 to 99 percent.",
      depositAmount: "The deposit must be between 1 and 10,000 euros.",
      depositRequired: "Please set the deposit.",
      depositNotAllowed: "A deposit can only be set when guests pay a deposit.",
      balanceDays: "Days before arrival must be a whole number from 0 to 365.",
      tierDays: "Days must be a whole number from 0 to 365.",
      tierPercent: "Percent must be a whole number from 0 to 100.",
      tooManyTiers: "Please use 10 lines or fewer.",
      nonRefundableTiers:
        "Remove the refund lines, or untick “No refunds, ever”.",
      noTiers: "Add at least one line, or tick “No refunds, ever”.",
      duplicateDays: "Two lines have the same number of days.",
      needZeroTier:
        "You need a line for 0 days, so late cancellations are covered.",
      refundOrder:
        "The closer to arrival a guest cancels, the less they should get back. Check the percent on each line.",
    },
    guest: {
      payFull: "You pay the full price when you book.",
      payOnArrival: "You pay nothing now. You pay when you arrive.",
      depositPercent: (percent: number) =>
        `You pay ${percent}% of the price when you book.`,
      depositFixed: (euros: string) => `You pay €${euros} when you book.`,
      depositMissing: "You pay a deposit when you book.",
      balance: (days: number) =>
        days === 0
          ? "The rest is due on the day you arrive."
          : `The rest is due ${dayWord(days)} before you arrive.`,
      nonRefundable: "If you cancel, you get no refund.",
      refundFull: "you get all your money back",
      refundNone: "you get nothing back",
      refundPart: (percent: number) => `you get ${percent}% of your money back`,
      anyTime: (refund: string) => `If you cancel at any time, ${refund}.`,
      orMore: (days: number, refund: string) =>
        `If you cancel ${dayWord(days)} or more before you arrive, ${refund}.`,
      between: (from: number, to: number, refund: string) =>
        from === to
          ? `If you cancel ${dayWord(from)} before you arrive, ${refund}.`
          : `If you cancel ${from} to ${to} days before you arrive, ${refund}.`,
      lessThan: (days: number, refund: string) =>
        `If you cancel less than ${dayWord(days)} before you arrive, ${refund}.`,
    },
  },
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
    cutoffHour: "Must be a whole number from 0 to 23.",
    horizonMonths: "Must be a whole number from 1 to 36.",
  },
} as const;
