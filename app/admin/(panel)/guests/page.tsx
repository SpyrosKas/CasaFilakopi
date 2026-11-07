import Link from "next/link";
import { Field } from "@/components/admin/form";
import { Empty, PageHead } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/session";
import { loadStayBook } from "@/lib/admin/stay-data";
import { buildGuests } from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";

const g = t.guests;

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const admin = await requireAdmin();
  const asked = (await searchParams).q;
  const search = (typeof asked === "string" ? asked : "").slice(0, 120);
  const wanted = search.trim().toLowerCase();

  const { stays } = await loadStayBook(admin);
  const everyone = buildGuests(stays);
  const guests = wanted
    ? everyone.filter((guest) =>
        [guest.name, guest.email, guest.phone].some((value) =>
          value?.toLowerCase().includes(wanted),
        ),
      )
    : everyone;

  return (
    <div className="stack">
      <PageHead title={g.title} intro={g.intro} />
      <form action="/admin/guests" className="stack">
        <Field label={g.search} name="q" type="search" defaultValue={search} />
      </form>
      {guests.length === 0 ? (
        <Empty>{wanted ? g.noMatch : g.empty}</Empty>
      ) : (
        <section className="panel">
          <ul className="rows">
            {guests.map((guest) => (
              <li key={guest.key}>
                <Link
                  href={`/admin/guests/${guest.key}`}
                  prefetch={false}
                  className="row"
                >
                  <span className="row-main">
                    <span className="row-title">
                      {guest.name ?? t.stay.noName}
                    </span>
                    <span className="row-sub">
                      {guest.email ?? guest.phone ?? ""}
                    </span>
                  </span>
                  <span className="row-side">
                    {g.stays(guest.stays.length)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
