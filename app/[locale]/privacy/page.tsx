import { setRequestLocale } from "next-intl/server";
import { TextPage, textPageMetadata } from "@/components/site/placeholder-page";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props) {
  return textPageMetadata(params, "privacy");
}

export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TextPage slug="privacy" locale={locale} />;
}
