import { loadLodging } from "@/lib/cms/public";
import { jsonForScript, lodgingBusiness } from "@/lib/seo";

/** schema.org data for search engines, from the CMS and the property row. */
export async function LodgingJsonLd({ locale }: { locale: string }) {
  const data = await loadLodging(locale);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonForScript(lodgingBusiness(data)) }}
    />
  );
}
