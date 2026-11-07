"use client";

import { useActionState, useRef, useTransition, type FormEvent } from "react";
import { ActionForm, FormMessage } from "@/components/admin/form";
import { formatMoment } from "@/components/admin/integrations/format";
import { idleState, type ActionState } from "@/lib/admin/form-state";
import { removeFeed, runSyncNow, saveFeed } from "@/lib/channels/actions";
import type { FeedView } from "@/lib/channels/data";
import { channelStrings as s } from "@/lib/channels/strings";

function LinkForm({ roomId, feed }: { roomId: string; feed: FeedView }) {
  const form = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    // A saved link must not stay on screen, and a refused one must, to fix it.
    async (previous: ActionState, data: FormData) => {
      const next = await saveFeed(previous, data);
      if (next.status === "ok") form.current?.reset();
      return next;
    },
    idleState,
  );
  const [, startTransition] = useTransition();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  const error = state.fieldErrors?.url;
  const id = `feed-url-${feed.channel}`;

  return (
    <form
      ref={form}
      action={formAction}
      onSubmit={onSubmit}
      noValidate
      className="stack"
    >
      <FormMessage state={state} />
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="channel" value={feed.channel} />
      <div className="field">
        <label htmlFor={id}>{s.feed.urlLabel}</label>
        <p className="hint">{s.feed.urlHint}</p>
        <input
          id={id}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error && (
          <p className="field-error" id={`${id}-error`}>
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="button" disabled={pending}>
        {pending ? s.feed.saving : s.feed.save}
      </button>
    </form>
  );
}

/** Stays mounted after the link goes, so its message can still be read. */
function RemoveLink({ roomId, feed }: { roomId: string; feed: FeedView }) {
  const [state, formAction, pending] = useActionState(removeFeed, idleState);
  if (!feed.maskedUrl && state.status === "idle") return null;

  return (
    <form action={formAction} className="stack">
      <FormMessage state={state} />
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="channel" value={feed.channel} />
      {feed.maskedUrl && (
        <button
          type="submit"
          className="button button-quiet"
          disabled={pending}
        >
          {pending ? s.feed.removing : s.feed.remove}
        </button>
      )}
    </form>
  );
}

export function SyncButton({
  label,
  channel,
}: {
  label: string;
  channel?: string;
}) {
  return (
    <ActionForm
      action={runSyncNow}
      submitLabel={label}
      pendingLabel={s.sync.syncing}
    >
      {channel && <input type="hidden" name="channel" value={channel} />}
    </ActionForm>
  );
}

export function FeedCard({ roomId, feed }: { roomId: string; feed: FeedView }) {
  const name = s.names[feed.channel];
  return (
    <section className="channel-section" data-channel={feed.channel}>
      <h3>{name}</h3>
      {feed.maskedUrl ? (
        <p>
          {s.feed.saved} <strong>{feed.maskedUrl}</strong>
        </p>
      ) : (
        <p>{s.feed.none}</p>
      )}
      {feed.maskedUrl && (
        <p>
          {s.feed.lastSync}{" "}
          {feed.lastSyncedAt ? formatMoment(feed.lastSyncedAt) : s.feed.never}
          {feed.consecutiveFailures > 0 &&
            ` (${s.feed.failures(feed.consecutiveFailures)})`}
        </p>
      )}
      <details className="channel-help">
        <summary>{s.feed.whereHeading(name)}</summary>
        <ol className="steps">
          {s.steps[feed.channel].map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
      <LinkForm roomId={roomId} feed={feed} />
      {feed.isActive && (
        <SyncButton label={s.sync.one(name)} channel={feed.channel} />
      )}
      <RemoveLink roomId={roomId} feed={feed} />
    </section>
  );
}
