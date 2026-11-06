import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

// not-found.tsx can only set metadata at the app root, so the tab title of the
// 404 is set here.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "NotFound" });
  return { title: t("metaTitle") };
}

// Any unknown path under a locale gets the styled, translated 404.
export default function CatchAll() {
  notFound();
}
