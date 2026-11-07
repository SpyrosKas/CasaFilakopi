import { useTranslations } from "next-intl";
import { ErrorScreen } from "@/components/site/error-screen";
import { Link } from "@/i18n/navigation";

export default function NotFound() {
  const t = useTranslations("NotFound");
  return (
    <ErrorScreen title={t("title")} body={t("body")}>
      <Link href="/" className="btn btn-primary text-white">
        {t("home")}
      </Link>
    </ErrorScreen>
  );
}
