import { randomUUID } from "node:crypto";
import type { EmailTransport, OutgoingEmail } from "../transport";

/** Keeps emails in a list. Used by tests and by EMAIL_DEV_TRANSPORT=memory. */
export interface MemoryTransport extends EmailTransport {
  sent: OutgoingEmail[];
}

export function memoryTransport(
  hook?: (email: OutgoingEmail) => void | Promise<void>,
): MemoryTransport {
  const sent: OutgoingEmail[] = [];
  return {
    name: "memory",
    sent,
    async send(email) {
      await hook?.(email);
      sent.push(email);
      return { id: randomUUID() };
    },
  };
}
