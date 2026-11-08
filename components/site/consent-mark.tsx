import {
  CONSENT_MAX_AGE_MS,
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
} from "@/content/consent";

// Runs before the first paint, so a visitor who has already chosen never sees
// the server-rendered cookie banner flash. Same test as readStored in
// consent-store.ts. The site's CSP allows inline scripts.
const MARK_SCRIPT = `try{var v=JSON.parse(localStorage.getItem(${JSON.stringify(
  CONSENT_STORAGE_KEY,
)}));if(v&&v.version===${JSON.stringify(
  COOKIE_POLICY_VERSION,
)}&&Date.now()-v.at<${CONSENT_MAX_AGE_MS})document.documentElement.dataset.consent="decided"}catch(e){}`;

/** First thing in body: marks html[data-consent] for a returning visitor. */
export function ConsentMark() {
  return <script dangerouslySetInnerHTML={{ __html: MARK_SCRIPT }} />;
}
