import type { Metadata } from "next";
import {
  NextIntlClientProvider,
  useMessages,
  useTranslations,
} from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { use } from "react";
import { ContactForm } from "@/components/site/contact-form";
import { PageHero } from "@/components/site/hero";
import { MapEmbed } from "@/components/site/map-embed";
import { ReserveBand } from "@/components/site/reserve-band";
import { contact } from "@/content/contact";
import { heroImages } from "@/content/house";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  return { title: t("metaTitle") };
}

export default function ContactPage({ params }: Props) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Contact");
  const tNav = useTranslations("Nav");
  // Only this page's browser code needs these words.
  const { ContactForm: formMessages } = useMessages();

  return (
    <>
      <PageHero image={heroImages.page} title={t("title")} />
      <section className="section">
        <div className="wrap contact-layout">
          <div>
            <dl className="contact-list">
              <dt>{t("nameLabel")}</dt>
              <dd>{t("name")}</dd>
              <dt>{t("addressLabel")}</dt>
              <dd>
                {tNav("addressLine1")} <br /> {tNav("addressLine2")}
              </dd>
              <dt>{t("emailLabel")}</dt>
              <dd>
                <a href={`mailto:${contact.email}`}>{contact.email}</a>
              </dd>
              <dt>{t("phoneLabel")}</dt>
              <dd>
                <a href={contact.phoneHref}>{contact.phoneDisplay}</a>
              </dd>
              <dt>{t("whatsappLabel")}</dt>
              <dd>
                <a href={contact.whatsappHref}>{contact.whatsappDisplay}</a>
              </dd>
            </dl>

            <NextIntlClientProvider messages={{ ContactForm: formMessages }}>
              <ContactForm />
            </NextIntlClientProvider>
          </div>
          <div>
            <h2 className="contact-map-heading">{t("mapHeading")}</h2>
            <MapEmbed />
          </div>
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
