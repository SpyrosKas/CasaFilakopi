import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import {
  PlaceholderPage,
  placeholderMetadata,
} from "@/components/site/placeholder-page";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props) {
  return placeholderMetadata(params, "terms");
}

export default function TermsPage({ params }: Props) {
  setRequestLocale(use(params).locale);
  return <PlaceholderPage page="terms" />;
}
