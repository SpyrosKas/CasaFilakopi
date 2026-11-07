"use client";

import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile. Mounted only once the rules in contact-form.tsx allow,
// so the script never loads before that. Script and widget go away on unmount.

const SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      language: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("blocked")));
    if (!existing) {
      (script as HTMLScriptElement).src = SCRIPT_URL;
      (script as HTMLScriptElement).async = true;
      document.head.append(script);
    }
  });
}

export function Turnstile({
  siteKey,
  locale,
  resetKey,
  failedText,
  onToken,
}: {
  siteKey: string;
  locale: string;
  /** Change it to ask for a new token: one token works only once. */
  resetKey: number;
  /** Shown if the check cannot load, such as behind a blocker. */
  failedText: string;
  onToken: (token: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    loadScript()
      .then(() => {
        if (!active || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          language: locale,
          callback: onToken,
          "expired-callback": () => onToken(null),
          "error-callback": () => onToken(null),
        });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, locale, onToken]);

  useEffect(() => {
    if (resetKey > 0 && widget.current) {
      window.turnstile?.reset(widget.current);
    }
  }, [resetKey]);

  if (failed) return <p className="contact-problem">{failedText}</p>;
  return <div ref={box} />;
}
