import { setRequestLocale } from "next-intl/server";
import { Accordion } from "@/components/site/accordion";
import {
  PlaceholderNotice,
  TextPageFrame,
  textPageMetadata,
} from "@/components/site/placeholder-page";
import { RichBlocks } from "@/components/site/rich-text";
import { loadFaq } from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

export function generateMetadata({ params }: Props) {
  return textPageMetadata(params, "faq");
}

export default async function FaqPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const questions = await loadFaq(locale);

  return (
    <TextPageFrame slug="faq" locale={locale}>
      {questions.length > 0 ? (
        <Accordion
          panels={questions.map(({ id, question, answer }) => ({
            id,
            title: question,
            content: <RichBlocks text={answer} />,
          }))}
        />
      ) : (
        <PlaceholderNotice />
      )}
    </TextPageFrame>
  );
}
