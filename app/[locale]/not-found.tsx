import { getLocale, getTranslations } from "next-intl/server";
import { ErrorScreen } from "@/components/site/error-screen";
import { Link } from "@/i18n/navigation";
import { loadPage } from "@/lib/cms/public";

export default async function NotFound() {
  const t = await getTranslations("NotFound");
  const page = await loadPage("contact", await getLocale());
  return (
    <ErrorScreen
      image={page.photo("page.hero")?.src}
      title={t("title")}
      body={t("body")}
    >
      <Link href="/" className="btn btn-primary">
        {t("home")}
      </Link>
    </ErrorScreen>
  );
}
