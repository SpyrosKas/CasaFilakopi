import Link from "next/link";
import { t } from "@/lib/admin/strings";
import {
  hasFilters,
  STATUS_FILTERS,
  type InvoiceFilters,
} from "@/lib/invoicing/filters";
import { DOC_TYPES, PAYMENT_METHODS } from "@/lib/invoicing/types";

const f = t.invoices.filters;

function Choice({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string | undefined;
  options: { value: string; label: string }[];
}) {
  const id = `filter-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={value ?? ""}>
        <option value="">{f.any}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Box({
  label,
  name,
  value,
  type = "text",
  hint,
}: {
  label: string;
  name: string;
  value: string | undefined;
  type?: string;
  hint?: string;
}) {
  const id = `filter-${name}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && <p className="hint">{hint}</p>}
      <input id={id} name={name} type={type} defaultValue={value ?? ""} />
    </div>
  );
}

/** A plain GET form: the filters end up in the address, ready to share. */
export function InvoiceFiltersForm({ filters }: { filters: InvoiceFilters }) {
  return (
    <details className="inv-filters" open={hasFilters(filters)}>
      <summary>{f.heading}</summary>
      <form method="get" action="/admin/invoices" className="stack">
        <div className="inv-grid">
          <Box
            label={f.month}
            name="month"
            type="month"
            value={filters.month}
          />
          <Box label={f.from} name="from" type="date" value={filters.from} />
          <Box label={f.to} name="to" type="date" value={filters.to} />
          <Choice
            label={f.type}
            name="type"
            value={filters.type}
            options={DOC_TYPES.map((value) => ({
              value,
              label: t.invoices.docType[value],
            }))}
          />
          <Choice
            label={f.status}
            name="status"
            value={filters.status}
            options={STATUS_FILTERS.map((value) => ({
              value,
              label: f.statusOption[value],
            }))}
          />
          <Choice
            label={f.sent}
            name="sent"
            value={filters.sent}
            options={[
              { value: "yes", label: f.yes },
              { value: "no", label: f.no },
            ]}
          />
          <Box label={f.booking} name="booking" value={filters.booking} />
          <Box label={f.guest} name="guest" value={filters.guest} />
          <Choice
            label={f.method}
            name="method"
            value={filters.method}
            options={PAYMENT_METHODS.map((value) => ({
              value,
              label: t.invoices.method[value],
            }))}
          />
          <Box
            label={f.transaction}
            name="transaction"
            value={filters.transaction}
            hint={f.transactionHint}
          />
        </div>
        <div className="inv-actions">
          <button type="submit" className="button">
            {f.apply}
          </button>
          <Link
            href="/admin/invoices"
            prefetch={false}
            className="button button-quiet"
          >
            {f.clear}
          </Link>
        </div>
      </form>
    </details>
  );
}
