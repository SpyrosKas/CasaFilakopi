import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHero } from "@/components/site/hero";
import { MapEmbed } from "@/components/site/map-embed";
import { ReserveBand } from "@/components/site/reserve-band";
import { loadContact, loadPage, pageMetadata } from "@/lib/cms/public";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Contact" });
  return pageMetadata("contact", locale, t("metaTitle"));
}

export default async function ContactPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Contact");
  const page = await loadPage("contact", locale);
  const contact = await loadContact(locale);

  return (
    <>
      <PageHero
        image={page.photo("page.hero")?.src}
        title={page.text("hero", "title")}
      />
      <section className="section">
        <div className="wrap contact-layout">
          <div>
            <dl className="contact-list">
              <dt>{t("nameLabel")}</dt>
              <dd>{page.text("details", "name")}</dd>
              <dt>{t("addressLabel")}</dt>
              <dd>
                {contact.addressLine1} <br /> {contact.addressLine2}
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

            {/* Track MAIL replaces this block with the contact form (T3.24). */}
            <div
              id="contact-form-slot"
              className="placeholder-notice"
              data-placeholder
            >
              <h2>{t("formSlotTitle")}</h2>
              <p>{t("formSlotBody")}</p>
            </div>
          </div>
          <div>
            <h2 className="contact-map-heading">
              {page.text("details", "mapHeading")}
            </h2>
            <MapEmbed />
          </div>
        </div>
      </section>
      <ReserveBand />
    </>
  );
}
