import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";

/**
 * The layout sends the browser only a few namespaces, so the booking pages add
 * their own here rather than growing every page's payload.
 */
export async function BookingMessages({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={{ Book: messages.Book }}>
      {children}
    </NextIntlClientProvider>
  );
}
