"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { MarkSentForm } from "@/components/admin/invoices/mark-sent-form";
import {
  addDocuments,
  clearSelection,
  toggleDocument,
  useSelection,
  type SelectedDocument,
} from "@/components/admin/invoices/selection-store";
import { t } from "@/lib/admin/strings";
import {
  reviewSelection,
  selectMatching,
  type ReviewResult,
} from "@/lib/invoicing/actions";
import { SELECTION_LIMIT } from "@/lib/invoicing/filters";
import { formatEuro } from "@/lib/invoicing/format";

const s = t.invoices.selection;

export function RowCheckbox({
  document,
  number,
}: {
  document: SelectedDocument;
  number: string;
}) {
  const selected = useSelection();
  return (
    <label className="inv-check">
      <input
        type="checkbox"
        aria-label={s.selectRow(number)}
        checked={selected.has(document.id)}
        onChange={() => toggleDocument(document)}
      />
    </label>
  );
}

export function SelectionTools({
  documents,
  matchingCount,
  query,
}: {
  documents: SelectedDocument[];
  matchingCount: number;
  query: string;
}) {
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const selectAll = () =>
    startTransition(async () => {
      setMessage("");
      const result = await selectMatching(query);
      if (result.status === "error") {
        setMessage(result.message ?? t.common.somethingWrong);
      } else if (!addDocuments(result.documents)) {
        setMessage(s.tooManyPicked(SELECTION_LIMIT));
      }
    });

  const selectPage = () => {
    setMessage(addDocuments(documents) ? "" : s.tooManyPicked(SELECTION_LIMIT));
  };

  return (
    <div className="stack">
      <div className="inv-actions">
        <button
          type="button"
          className="button button-quiet"
          onClick={selectPage}
        >
          {s.selectPage}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={selectAll}
          disabled={pending}
        >
          {pending ? s.selecting : s.selectAll(matchingCount)}
        </button>
      </div>
      {message && (
        <p className="notice notice-bad" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function Warnings({
  review,
}: {
  review: Extract<ReviewResult, { status: "ok" }>;
}) {
  return (
    <>
      {review.missingPdf.length > 0 && (
        <div className="notice notice-bad" role="alert">
          <p>
            <strong>{s.missingHeading}</strong>
          </p>
          <ul className="inv-names">
            {review.missingPdf.map((document) => (
              <li key={document.id}>
                <Link
                  href={`/admin/invoices/${document.id}`}
                  prefetch={false}
                  className="text-link"
                >
                  {document.documentNumber}
                </Link>
              </li>
            ))}
          </ul>
          <p>{s.missingNote}</p>
        </div>
      )}
      {review.alreadySent.length > 0 && (
        <div className="notice notice-info" role="status">
          <p>
            <strong>{s.sentHeading}</strong>
          </p>
          <ul className="inv-names">
            {review.alreadySent.map((document) => (
              <li key={document.id}>
                {s.sentOn(document.documentNumber, document.sentOn)}
              </li>
            ))}
          </ul>
          <p>{s.sentNote}</p>
        </div>
      )}
    </>
  );
}

type Step = "download" | "mark";

export function SelectionBar({ query }: { query: string }) {
  const selected = useSelection();
  const form = useRef<HTMLFormElement>(null);
  const [panel, setPanel] = useState<{
    step: Step;
    forIds: string;
    review: Extract<ReviewResult, { status: "ok" }>;
  } | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const ids = [...selected.keys()];
  const key = ids.join();
  const total = [...selected.values()].reduce((sum, cents) => sum + cents, 0);
  // A panel describes one exact selection. Any change makes it out of date.
  const open = panel?.forIds === key ? panel : null;

  if (ids.length === 0) return null;

  const begin = (step: Step) =>
    startTransition(async () => {
      setMessage("");
      setPanel(null);
      const review = await reviewSelection(ids);
      if (review.status === "error") {
        setMessage(review.message);
        return;
      }
      const needsWarning =
        review.missingPdf.length > 0 || review.alreadySent.length > 0;
      if (step === "download" && !needsWarning) {
        form.current?.requestSubmit();
      } else {
        setPanel({ step, forIds: key, review });
      }
    });

  const onlyMissing =
    open?.review.count === 1 && open.review.missingPdf.length === 1;

  return (
    <div className="inv-bar" data-testid="selection-bar">
      {/* A plain post, so the browser saves the file the normal way. */}
      <form
        ref={form}
        id="inv-download"
        method="post"
        action="/admin/invoices/export/download"
      >
        <input type="hidden" name="filter" value={query} />
        {ids.map((id) => (
          <input type="hidden" name="id" value={id} key={id} />
        ))}
      </form>

      {message && (
        <p className="notice notice-bad" role="alert">
          {message}
        </p>
      )}

      {open && (
        <div className="stack inv-panel">
          <Warnings review={open.review} />
          {open.step === "download" && onlyMissing && <p>{s.onlyMissing}</p>}
          {open.step === "download" && !onlyMissing && (
            <button type="submit" form="inv-download" className="button">
              {s.downloadAnyway}
            </button>
          )}
          {open.step === "mark" && (
            <div className="stack">
              <h2>{s.markHeading}</h2>
              <p>{s.markIntro}</p>
              <MarkSentForm ids={ids} />
            </div>
          )}
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setPanel(null)}
          >
            {s.close}
          </button>
        </div>
      )}

      <p className="inv-bar-summary" aria-live="polite">
        <strong>{s.count(ids.length)}</strong>
        <span>
          {s.total}: {formatEuro(total)}
        </span>
      </p>
      <div className="inv-bar-buttons">
        <button
          type="button"
          className="button"
          disabled={pending}
          onClick={() => begin("download")}
        >
          {pending ? s.downloading : s.download}
        </button>
        <button
          type="button"
          className="button button-quiet"
          disabled={pending}
          onClick={() => begin("mark")}
        >
          {s.markSent}
        </button>
        <button
          type="button"
          className="button button-quiet"
          onClick={clearSelection}
        >
          {s.clear}
        </button>
      </div>
    </div>
  );
}
