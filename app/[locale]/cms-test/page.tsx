import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Gallery, GalleryGrid } from "@/components/site/gallery";
import { PageHero } from "@/components/site/hero";
import { PlaceholderNotice } from "@/components/site/placeholder-page";
import { RichBlocks, RichInline } from "@/components/site/rich-text";
import { loadPage, pageMetadata } from "@/lib/cms/public";
import { testPageEnabled } from "@/lib/cms/registry";

type Props = { params: Promise<{ locale: string }> };

// Exists only while the end-to-end tests run (CMS_TEST_PAGE=1): they publish,
// upload and delete for real here, in the same components the real pages use,
// without disturbing the pages other tests are reading at the same time.

export async function generateMetadata({ params }: Props) {
  if (!testPageEnabled()) return {};
  const { locale } = await params;
  return pageMetadata("cms-test", locale, "Test page");
}

export default async function CmsTestPage({ params }: Props) {
  if (!testPageEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const page = await loadPage("cms-test", locale);
  const title = page.text("room", "title");
  const photos = page.photos("section.room");
  const body = page.text("main", "body");

  return (
    <>
      <PageHero
        image={page.photo("test.hero")?.src}
        focus={page.photo("test.hero")?.focus}
        title={page.text("hero", "title")}
      />
      <section className="section house-section house-tinted">
        <div className="wrap house-pair">
          <article className="room">
            {photos.length > 0 && (
              <Gallery photos={photos} label={title} sizes="88vw" />
            )}
            <div className="room__text">
              <h2>{title}</h2>
              <p>
                <RichInline text={page.text("room", "body")} gap />
              </p>
            </div>
          </article>
        </div>
      </section>
      <section className="section">
        <div className="wrap">
          {photos.length > 0 && <GalleryGrid title={title} photos={photos} />}
        </div>
      </section>
      <section className="section">
        <div className="wrap page-content">
          {body.trim() ? <RichBlocks text={body} /> : <PlaceholderNotice />}
        </div>
      </section>
    </>
  );
}
