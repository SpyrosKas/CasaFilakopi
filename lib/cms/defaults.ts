import { adamasSteps, airportSteps, type StepIcon } from "@/content/directions";
import { contact } from "@/content/contact";
import { houseSections, reviews } from "@/content/house";
import imageSizes from "@/content/image-sizes.json";
import { publicMediaUrl, SITE_PREFIX } from "@/lib/cms/media-url";
import { fromMessage } from "@/lib/cms/rich";
import type { BlockData, Lang, ListItem, SitePhoto } from "@/lib/cms/types";
import el from "@/messages/el.json";
import en from "@/messages/en.json";

// The site as it stood when the text left the code. It does two jobs: the
// first import into the database, and what a page shows if the database cannot
// be reached, so a visitor never gets a blank page.

const messages: Record<Lang, typeof en> = { en, el: el as typeof en };

/** Builds a block from the same reader applied to both languages. */
function block(read: (m: typeof en) => Record<string, string>): BlockData {
  return { en: read(messages.en), el: read(messages.el) };
}

const amenityIcons = [
  "hammock",
  "shower",
  "flame",
  "snowflake",
  "wifi",
  "tv",
  "wind",
  "yogaMat",
  "waves",
  "towels",
];

const amenities = (lang: Lang) =>
  messages[lang].Home.amenitiesBody.split(/,\s*/);

function amenityItems(): ListItem[] {
  return amenityIcons.map((icon, index) => ({
    id: `amenity-${icon.toLowerCase()}`,
    choice: icon,
    en: { label: amenities("en")[index] },
    el: { label: amenities("el")[index] },
  }));
}

const stepIcons: Record<StepIcon, string> = {
  arrowCircleRight: "turnRight",
  arrowCircleLeft: "turnLeft",
  arrowCircleUp: "arrowUp",
  smileBeam: "smile",
};

function stepItems(
  route: "adamas" | "airport",
  steps: { icon: StepIcon }[],
): ListItem[] {
  const words = (lang: Lang, number: number) => {
    const list = messages[lang].Directions[route] as Record<
      string,
      { text: string; icon: string }
    >;
    const step = list[number];
    return { text: fromMessage(step.text), iconLabel: step.icon };
  };
  return steps.map((step, index) => ({
    id: `${route}-${index + 1}`,
    choice: stepIcons[step.icon],
    en: words("en", index + 1),
    el: words("el", index + 1),
  }));
}

const seo = (metaTitle: (m: typeof en) => string) =>
  block((m) => ({ metaTitle: metaTitle(m), metaDescription: "" }));

function title(read: (m: typeof en) => string) {
  return block((m) => ({ title: read(m) }));
}

const textPageBlocks = (key: keyof typeof en.Pages) => ({
  hero: title((m) => m.Pages[key].title),
  main: block(() => ({ body: "" })),
  seo: seo((m) => m.Pages[key].title),
});

function roomBlocks() {
  return Object.fromEntries(
    houseSections.map(({ key }) => [
      key,
      block((m) => ({
        title: m.Home.sections[key].title,
        body: fromMessage(m.Home.sections[key].body),
      })),
    ]),
  );
}

const digitsOf = (href: string) => href.replace(/\D/g, "");

const DEFAULT_BLOCKS: Record<string, Record<string, BlockData>> = {
  home: {
    hero: block((m) => ({ welcome: m.Home.welcomeTo })),
    ...roomBlocks(),
    overall: block((m) => ({
      title: m.Home.overallTitle,
      body: fromMessage(m.Home.overallBody),
    })),
    places: block((m) => ({
      title: m.Home.placesTitle,
      body: fromMessage(m.Home.placesBody),
    })),
    amenities: {
      ...block((m) => ({ title: m.Home.amenitiesTitle })),
      items: amenityItems(),
    },
    reviews: title((m) => m.Reviews.heading),
    seo: seo((m) => m.Home.metaTitle),
  },
  host: {
    hero: title((m) => m.Host.title),
    letter: block((m) => ({ body: fromMessage(m.Host.letter) })),
    seo: seo((m) => m.Host.metaTitle),
  },
  directions: {
    hero: block((m) => ({ welcome: m.Directions.welcome })),
    adamas: {
      ...title((m) => m.Directions.adamasTitle),
      items: stepItems("adamas", adamasSteps),
    },
    airport: {
      ...block((m) => ({
        title: m.Directions.airportTitle,
        link: m.Directions.airportLink,
      })),
      items: stepItems("airport", airportSteps),
    },
    seo: seo((m) => m.Directions.metaTitle),
  },
  gallery: {
    hero: title((m) => m.Gallery.title),
    seo: seo((m) => m.Gallery.metaTitle),
  },
  contact: {
    hero: title((m) => m.Contact.title),
    details: block((m) => ({
      name: m.Contact.name,
      mapHeading: m.Contact.mapHeading,
    })),
    seo: seo((m) => m.Contact.metaTitle),
  },
  book: {
    hero: title((m) => m.Book.title),
    main: block((m) => ({ soon: m.Book.soon, body: m.Book.body })),
    seo: seo((m) => m.Book.metaTitle),
  },
  faq: {
    hero: title((m) => m.Pages.faq.title),
    seo: seo((m) => m.Pages.faq.title),
  },
  "house-rules": textPageBlocks("houseRules"),
  privacy: textPageBlocks("privacy"),
  terms: textPageBlocks("terms"),
  cancellation: textPageBlocks("cancellation"),
  cookies: textPageBlocks("cookies"),
  site: {
    contact: {
      en: {},
      el: {},
      shared: {
        email: contact.email,
        phone: contact.phoneDisplay,
        whatsapp: contact.whatsappDisplay,
        facebook: contact.facebook,
        instagram: contact.instagram,
      },
    },
    address: block((m) => ({
      line1: m.Nav.addressLine1,
      line2: m.Nav.addressLine2,
    })),
    reserve: block((m) => ({ title: fromMessage(m.Reserve.title) })),
  },
};

/** Every page that has text to import, by slug and then section. */
export const defaultBlocks = (): Record<string, Record<string, BlockData>> =>
  DEFAULT_BLOCKS;

export const defaultPageBlocks = (slug: string): Record<string, BlockData> =>
  DEFAULT_BLOCKS[slug] ?? {};

// Photos. A path is relative to the old public/img folder.

type Alt = Partial<Record<Lang, string>>;

const fileKey = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1, path.lastIndexOf("."));

const stripLeading = (src: string) => src.replace(/^\/img\//, "");

function photoAlt(path: string): Alt {
  const key = fileKey(path) as keyof typeof en.Photos;
  return { en: en.Photos[key], el: (el as typeof en).Photos[key] };
}

function sectionPlacements(): Record<string, string[]> {
  return Object.fromEntries(
    houseSections.map(({ key, photo, slides, mainPhotoLast }) => {
      const main = stripLeading(photo);
      const rest = slides.map(stripLeading);
      return [
        `section.${key}`,
        mainPhotoLast ? [...rest, main] : [main, ...rest],
      ];
    }),
  );
}

function stepPlacements(
  route: "adamas" | "airport",
  steps: { image: string }[],
): Record<string, string[]> {
  return Object.fromEntries(
    steps.map((step, index) => [
      `step.${route}-${index + 1}`,
      [stripLeading(step.image)],
    ]),
  );
}

/** Which photos sit where, in order. The first of each is its cover. */
export const defaultPlacements = (): Record<string, string[]> => ({
  ...sectionPlacements(),
  ...stepPlacements("adamas", adamasSteps),
  ...stepPlacements("airport", airportSteps),
  "home.hero": ["tinified/_DSC1162_opt.jpg"],
  "host.hero": ["tinified/_DSC1148.jpg"],
  "directions.hero": ["tinified/_DSC1157.jpg"],
  "page.hero": ["tinified/_DSC1164.jpg"],
  "reserve.band": ["tinified/_DSC1164.jpg"],
  "host.portrait": ["thehost02.jpg"],
  "home.landscape": ["tinified/_DSC1175.jpg"],
});

/** The description of every photo that has one, per language. */
export function defaultAlts(): Record<string, Alt> {
  const alts: Record<string, Alt> = {};
  const add = (path: string, alt: Alt) => {
    alts[path] = { ...alts[path], ...alt };
  };

  const stepAlts = (
    route: "adamas" | "airport",
    steps: { image: string }[],
  ) => {
    steps.forEach((step, index) => {
      const read = (lang: Lang) =>
        (messages[lang].Directions[route] as Record<string, { alt: string }>)[
          index + 1
        ].alt;
      add(stripLeading(step.image), { en: read("en"), el: read("el") });
    });
  };
  stepAlts("adamas", adamasSteps);
  stepAlts("airport", airportSteps);

  for (const path of Object.values(defaultPlacements()).flat()) {
    const alt = photoAlt(path);
    if (alt.en || alt.el) add(path, alt);
  }
  for (const { key, photo } of houseSections) {
    add(stripLeading(photo), {
      en: messages.en.Home.sections[key].alt,
      el: messages.el.Home.sections[key].alt,
    });
  }
  add("thehost02.jpg", {
    en: messages.en.Host.photoAlt,
    el: messages.el.Host.photoAlt,
  });
  return alts;
}

const sizes = imageSizes as Record<string, number[]>;

/** A photo from the imported set, for when the database cannot be read. */
export function defaultPhoto(path: string, lang: Lang): SitePhoto {
  const [width, height] = sizes[`/img/${path}`];
  return {
    src: publicMediaUrl(`${SITE_PREFIX}${path}`),
    width,
    height,
    alt: defaultAlts()[path]?.[lang] ?? "",
  };
}

export function defaultCollection(collection: string, lang: Lang): SitePhoto[] {
  return (defaultPlacements()[collection] ?? []).map((path) =>
    defaultPhoto(path, lang),
  );
}

export interface DefaultReview {
  key: string;
  author: string;
  stars: number;
  en: { teaser: string; text: string };
  el: { teaser: string; text: string };
}

export function defaultReviews(): DefaultReview[] {
  return reviews.map(({ key, stars }) => ({
    key,
    stars,
    author: messages.en.Reviews.items[key].name,
    en: {
      teaser: messages.en.Reviews.items[key].teaser,
      text: messages.en.Reviews.items[key].text,
    },
    el: {
      teaser: messages.el.Reviews.items[key].teaser,
      text: messages.el.Reviews.items[key].text,
    },
  }));
}

/** Phone and WhatsApp links, from the numbers as Yorgos types them. */
export function phoneLink(display: string): string {
  return `tel:+${digitsOf(display).replace(/^00/, "")}`;
}

export function whatsappLink(display: string): string {
  return `https://wa.me/${digitsOf(display).replace(/^00/, "")}`;
}
