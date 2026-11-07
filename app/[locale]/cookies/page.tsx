import { setRequestLocale } from "next-intl/server";
import { TextPage, textPageMetadata } from "@/components/site/placeholder-page";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props) {
  return textPageMetadata(params, "cookies");
}

export default async function CookiesPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <TextPage slug="cookies" locale={locale} />;
}
