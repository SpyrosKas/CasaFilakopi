import { Resend } from "resend";
import {
  classifyFailure,
  TransportError,
  type EmailTransport,
} from "../transport";

const SEND_TIMEOUT_MS = 15_000;

export const quoteSender = (name: string, address: string) =>
  `"${name.replace(/[\\"\r\n]/g, "")}" <${address}>`;

export function resendTransport(apiKey: string): EmailTransport {
  const client = new Resend(apiKey);

  return {
    name: "resend",
    async send(email) {
      let result;
      try {
        result = await client.emails.send(
          {
            from: quoteSender(email.from.name, email.from.address),
            to: email.to,
            replyTo: email.replyTo,
            subject: email.subject,
            html: email.html,
            text: email.text,
            tags: [{ name: "email_log_id", value: email.logId }],
            attachments: email.attachments.map((attachment) => ({
              filename: attachment.filename,
              content: attachment.content,
              contentType: attachment.contentType,
            })),
          },
          // A retry after a lost answer cannot deliver the email twice.
          {
            idempotencyKey: email.idempotencyKey,
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        throw new TransportError(`resend: ${message}`, "retry");
      }

      if (result.error) {
        const { message, name, statusCode } = result.error;
        throw new TransportError(
          `resend ${statusCode ?? "?"} ${name}: ${message}`,
          classifyFailure(statusCode, name),
        );
      }
      if (!result.data) {
        throw new TransportError("resend: no answer", "retry");
      }
      return { id: result.data.id };
    },
  };
}
