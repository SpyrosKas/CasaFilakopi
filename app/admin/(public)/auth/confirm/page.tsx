import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { ActionForm } from "@/components/admin/form";
import { confirmEmailLink } from "@/lib/admin/actions/auth";

/** Where reset and invite emails land. Nothing happens until the button. */
export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<{
    code?: string;
    token_hash?: string;
    type?: string;
    error?: string;
  }>;
}) {
  const { t } = await adminI18n();

  const { code, token_hash: tokenHash, type, error } = await searchParams;
  const usable = !error && (code || (tokenHash && type));

  if (!usable) {
    return (
      <div className="stack">
        <h1>{t.confirm.title}</h1>
        <p className="notice notice-bad" role="alert">
          {t.confirm.badLink}
        </p>
        <Link href="/admin/forgot-password" className="button" prefetch={false}>
          {t.confirm.askAgain}
        </Link>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{t.confirm.title}</h1>
      <p>{t.confirm.intro}</p>
      <ActionForm
        action={confirmEmailLink}
        submitLabel={t.confirm.submit}
        pendingLabel={t.confirm.submitting}
      >
        {code && <input type="hidden" name="code" value={code} />}
        {!code && <input type="hidden" name="tokenHash" value={tokenHash} />}
        {!code && <input type="hidden" name="type" value={type} />}
      </ActionForm>
      <p>
        <Link
          href="/admin/forgot-password"
          className="text-link"
          prefetch={false}
        >
          {t.confirm.askAgain}
        </Link>
      </p>
    </div>
  );
}
