import {
  classifyFailure,
  TransportError,
  type EmailTransport,
} from "../transport";

/** Local development only: the Mailpit that `supabase start` runs. */
export function mailpitTransport(baseUrl: string): EmailTransport {
  return {
    name: "mailpit",
    async send(email) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/v1/send`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            From: { Email: email.from.address, Name: email.from.name },
            To: [{ Email: email.to }],
            ReplyTo: [{ Email: email.replyTo }],
            Subject: email.subject,
            HTML: email.html,
            Text: email.text,
            Attachments: email.attachments.map((attachment) => ({
              Filename: attachment.filename,
              ContentType: attachment.contentType,
              Content: attachment.content.toString("base64"),
            })),
          }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown";
        throw new TransportError(`mailpit: ${message}`, "retry");
      }

      if (!response.ok) {
        throw new TransportError(
          `mailpit ${response.status}: ${await response.text()}`,
          classifyFailure(response.status),
        );
      }
      const { ID } = (await response.json()) as { ID: string };
      return { id: ID };
    },
  };
}
