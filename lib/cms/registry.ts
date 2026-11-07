import { later } from "@/lib/admin/later";
import type {
  ChoiceDef,
  CollectionDef,
  FieldDef,
  ListDef,
  PageDef,
  SectionDef,
} from "@/lib/cms/types";

// Labels are markers: a page puts them into words with `sayAll`.
const l = later.cms.labels;

// The map of everything Yorgos can edit: each page, its sections in the order
// they appear on the page, and a plain label for every field. The editor is
// generated from this list, and nothing outside it can be saved.

const line = (name: string, label: string, hint?: string): FieldDef => ({
  name,
  label,
  kind: "line",
  hint,
  required: name === "title",
});

const must = (field: FieldDef): FieldDef => ({ ...field, required: true });

const rich = (name: string, label: string, hint?: string): FieldDef => ({
  name,
  label,
  kind: "rich",
  hint,
});

const seoSection = (slug: string): SectionDef => ({
  key: "seo",
  label: l.howThisPageLooksOnGoogle,
  photos: `og.${slug}`,
  fields: [
    line("metaTitle", l.titleOnGoogle, l.theTabTitleAndTheFirst),
    {
      name: "metaDescription",
      label: l.shortDescriptionOnGoogle,
      kind: "text",
      hint: l.oneOrTwoSentencesLeaveEmpty,
    },
  ],
});

const room = (key: string, label: string): SectionDef => ({
  key,
  label,
  photos: `section.${key}`,
  fields: [line("title", l.title), rich("body", l.description)],
});

const titleOnly = (label: string = l.pageTitle): FieldDef[] => [
  line("title", label),
];

export const AMENITY_ICONS: ChoiceDef = {
  name: "icon",
  label: l.icon,
  options: [
    { value: "hammock", label: l.hammock },
    { value: "shower", label: l.shower },
    { value: "flame", label: l.flame },
    { value: "snowflake", label: l.snowflake },
    { value: "wifi", label: l.wiFi },
    { value: "tv", label: l.television },
    { value: "wind", label: l.air },
    { value: "yogaMat", label: l.yogaMat },
    { value: "waves", label: l.waves },
    { value: "towels", label: l.towels },
  ],
};

export const STEP_ICONS: ChoiceDef = {
  name: "icon",
  label: l.arrow,
  options: [
    { value: "turnRight", label: l.turnRight },
    { value: "turnLeft", label: l.turnLeft },
    { value: "arrowUp", label: l.straightOn },
    { value: "smile", label: l.smileYouHaveArrived },
  ],
};

const stepList = (idPrefix: string): ListDef => ({
  itemLabel: l.step,
  addLabel: l.addAStep,
  idPrefix,
  itemPhotos: true,
  choice: STEP_ICONS,
  fields: [
    must(rich("text", l.whatToDo)),
    line("iconLabel", l.arrowInWords, l.readAloudByScreenReadersFor),
  ],
});

const textPage = (slug: string, label: string, bodyLabel: string): PageDef => ({
  slug,
  label,
  path: `/${slug}`,
  sections: [
    {
      key: "hero",
      label: l.topOfThePage,
      photos: "page.hero",
      fields: titleOnly(),
    },
    {
      key: "main",
      label: l.theText,
      fields: [
        {
          name: "body",
          label: bodyLabel,
          kind: "rich",
          strict: true,
          hint: l.untilThisIsPublishedVisitorsSee,
        },
      ],
    },
    seoSection(slug),
  ],
});

const PAGES: PageDef[] = [
  {
    slug: "home",
    label: l.homePage,
    path: "",
    alsoShownOn: ["gallery"],
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "home.hero",
        fields: [line("welcome", l.smallLineAboveTheName)],
      },
      room("welcome", l.welcome),
      room("masterBedroom", l.masterBedroom),
      room("secondBedroom", l.secondBedroom),
      room("kitchen", l.kitchen),
      room("interiorBathroom", l.interiorBathroom),
      room("exteriorBathroom", l.exteriorBathroom),
      room("coolOff", l.coolOffSpots),
      {
        key: "landscape",
        label: l.widePhotoOfTheHouse,
        photos: "home.landscape",
        fields: [],
      },
      {
        key: "overall",
        label: l.overall,
        fields: [line("title", l.title), rich("body", l.description)],
      },
      {
        key: "places",
        label: l.placesToVisit,
        fields: [line("title", l.title), rich("body", l.description)],
        link: {
          href: "/admin/content/lists/places",
          label: l.editTheListOfPlaces,
        },
      },
      {
        key: "amenities",
        label: l.amenities,
        fields: [line("title", l.title)],
        list: {
          itemLabel: l.amenity,
          addLabel: l.addAnAmenity,
          idPrefix: "amenity",
          choice: AMENITY_ICONS,
          fields: [must(line("label", l.name))],
        },
      },
      {
        key: "reviews",
        label: l.guestReviews,
        fields: [line("title", l.heading)],
        link: {
          href: "/admin/content/lists/testimonials",
          label: l.editTheReviews,
        },
      },
      seoSection("home"),
    ],
  },
  {
    slug: "host",
    label: l.theHost,
    path: "/host",
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "host.hero",
        fields: titleOnly(),
      },
      {
        key: "letter",
        label: l.letterFromTheHost,
        photos: "host.portrait",
        fields: [rich("body", l.theLetter)],
      },
      seoSection("host"),
    ],
  },
  {
    slug: "directions",
    label: l.directions,
    path: "/directions",
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "directions.hero",
        fields: [line("welcome", l.smallLineAboveTheName)],
      },
      {
        key: "adamas",
        label: l.fromTheCenterOfAdamas,
        fields: [line("title", l.title)],
        list: stepList("adamas"),
      },
      {
        key: "airport",
        label: l.fromTheAirport,
        fields: [
          line("title", l.title),
          line("link", l.linkBackToTheAdamasRoute),
        ],
        list: stepList("airport"),
      },
      seoSection("directions"),
    ],
  },
  {
    slug: "gallery",
    label: l.gallery,
    path: "/gallery",
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "page.hero",
        fields: titleOnly(),
      },
      seoSection("gallery"),
    ],
  },
  {
    slug: "contact",
    label: l.contact,
    path: "/contact",
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "page.hero",
        fields: titleOnly(),
      },
      {
        key: "details",
        label: l.contactDetails,
        fields: [
          must(line("name", l.name)),
          line("mapHeading", l.headingAboveTheMap),
        ],
      },
      seoSection("contact"),
    ],
  },
  {
    slug: "book",
    label: l.reservations,
    path: "/book",
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "page.hero",
        fields: titleOnly(),
      },
      {
        key: "main",
        label: l.theText,
        fields: [line("soon", l.firstLine), line("body", l.secondLine)],
      },
      seoSection("book"),
    ],
  },
  {
    slug: "faq",
    label: l.questionsAndAnswers,
    path: "/faq",
    sections: [
      {
        key: "hero",
        label: l.topOfThePage,
        photos: "page.hero",
        fields: titleOnly(),
      },
      {
        key: "questions",
        label: l.theQuestions,
        fields: [],
        link: {
          href: "/admin/content/lists/faq",
          label: l.editTheQuestionsAndAnswers,
        },
      },
      seoSection("faq"),
    ],
  },
  textPage("house-rules", l.houseRules, l.theHouseRules),
  textPage("privacy", l.privacyPolicy, l.thePolicy),
  textPage("terms", l.termsAndConditions, l.theTerms),
  textPage("cancellation", l.cancellationPolicy, l.thePolicy),
  textPage("cookies", l.cookiePolicy, l.thePolicy),
  {
    slug: "site",
    label: l.everyPageMenuFooterContactDetails,
    path: null,
    sections: [
      {
        key: "contact",
        label: l.contactDetails,
        fields: [
          {
            name: "email",
            label: l.email,
            kind: "email",
            shared: true,
            required: true,
          },
          {
            name: "phone",
            label: l.phone,
            kind: "line",
            shared: true,
            required: true,
            hint: l.keepTheCountryCodeForExample,
          },
          {
            name: "whatsapp",
            label: l.whatsappNumber,
            kind: "line",
            shared: true,
            required: true,
            hint: l.digitsOnlyStartingWith0030,
          },
          {
            name: "facebook",
            label: l.facebookLink,
            kind: "url",
            shared: true,
            required: true,
          },
          {
            name: "instagram",
            label: l.instagramLink,
            kind: "url",
            shared: true,
            required: true,
          },
        ],
      },
      {
        key: "address",
        label: l.address,
        fields: [
          must(line("line1", l.firstLine)),
          must(line("line2", l.secondLine)),
        ],
      },
      {
        key: "reserve",
        label: l.bandAboveTheFooter,
        photos: "reserve.band",
        fields: [must(rich("title", l.bigText))],
      },
    ],
  },
];

/**
 * A page that exists only while end-to-end tests run, so they can publish and
 * upload for real without touching the pages other tests are reading.
 */
export const TEST_PAGE: PageDef = {
  slug: "cms-test",
  label: l.testPage,
  path: "/cms-test",
  sections: [
    {
      key: "hero",
      label: l.topOfThePage,
      photos: "test.hero",
      fields: titleOnly(),
    },
    room("room", l.testRoom),
    {
      key: "main",
      label: l.theText,
      fields: [
        { name: "body", label: l.thePolicy, kind: "rich", strict: true },
      ],
    },
    seoSection("cms-test"),
  ],
};

export const testPageEnabled = () => process.env.CMS_TEST_PAGE === "1";

export function allPages(): PageDef[] {
  return testPageEnabled() ? [...PAGES, TEST_PAGE] : PAGES;
}

export function findPage(slug: string): PageDef | undefined {
  return allPages().find((page) => page.slug === slug);
}

const ROOM_GROUP = l.roomsAndSpaces;
const HEADER_GROUP = l.largePhotosAtTheTopOf;
const OTHER_GROUP = l.otherPhotos;

const FIXED_COLLECTIONS: CollectionDef[] = [
  ...[
    ["welcome", l.welcome],
    ["masterBedroom", l.masterBedroom],
    ["secondBedroom", l.secondBedroom],
    ["kitchen", l.kitchen],
    ["interiorBathroom", l.interiorBathroom],
    ["exteriorBathroom", l.exteriorBathroom],
    ["coolOff", l.coolOffSpots],
  ].map(([key, label]): CollectionDef => ({
    id: `section.${key}`,
    label,
    group: ROOM_GROUP,
    pages: ["home", "gallery"],
    textOn: `/admin/content/home#${key}`,
  })),
  {
    id: "home.hero",
    label: l.homePage,
    group: HEADER_GROUP,
    single: true,
    decorative: true,
    pages: ["home"],
  },
  {
    id: "host.hero",
    label: l.theHost,
    group: HEADER_GROUP,
    single: true,
    decorative: true,
    pages: ["host"],
  },
  {
    id: "directions.hero",
    label: l.directions,
    group: HEADER_GROUP,
    single: true,
    decorative: true,
    pages: ["directions"],
  },
  {
    id: "page.hero",
    label: l.allOtherPages,
    group: HEADER_GROUP,
    single: true,
    decorative: true,
    pages: [
      "gallery",
      "contact",
      "book",
      "faq",
      "house-rules",
      "privacy",
      "terms",
      "cancellation",
      "cookies",
    ],
  },
  {
    id: "host.portrait",
    label: l.portraitOfTheHost,
    group: OTHER_GROUP,
    single: true,
    pages: ["host"],
    textOn: "/admin/content/host#letter",
  },
  {
    id: "home.landscape",
    label: l.widePhotoOfTheHouse,
    group: OTHER_GROUP,
    single: true,
    pages: ["home"],
  },
  {
    id: "reserve.band",
    label: l.bandAboveTheFooter,
    group: OTHER_GROUP,
    single: true,
    decorative: true,
    pages: ["site"],
  },
];

const TEST_COLLECTIONS: CollectionDef[] = [
  {
    id: "test.hero",
    label: l.testHero,
    group: l.test,
    single: true,
    optional: true,
    decorative: true,
    pages: ["cms-test"],
  },
  {
    id: "section.room",
    label: l.testRoom,
    group: l.test,
    pages: ["cms-test"],
    textOn: "/admin/content/cms-test#room",
  },
];

/** The collections with a fixed name, for the photo overview. */
export function fixedCollections(): CollectionDef[] {
  return testPageEnabled()
    ? [...FIXED_COLLECTIONS, ...TEST_COLLECTIONS]
    : FIXED_COLLECTIONS;
}

const ITEM_ID = /^[a-z0-9-]{1,40}$/;

export const isItemId = (value: string) => ITEM_ID.test(value);

/**
 * Looks up any collection, including the ones named after a directions step or
 * a page. Anything else is refused, so a form cannot invent a collection.
 */
export function findCollection(id: string): CollectionDef | undefined {
  const fixed = fixedCollections().find((c) => c.id === id);
  if (fixed) return fixed;

  if (id.startsWith("step.") && isItemId(id.slice("step.".length))) {
    return {
      id,
      label: l.directionsStep,
      group: l.directionsSteps,
      single: true,
      optional: true,
      pages: ["directions"],
      textOn: "/admin/content/directions#adamas",
    };
  }

  const page = id.startsWith("og.") ? findPage(id.slice("og.".length)) : null;
  if (page) {
    return {
      id,
      label: l.photoWhenShared(page.label),
      group: l.photosWhenShared,
      single: true,
      optional: true,
      pages: [page.slug],
      textOn: `/admin/content/${page.slug}#seo`,
    };
  }
  return undefined;
}

/** A friendly name for a collection, for "also used in" warnings. */
export function collectionName(id: string): string {
  const found = findCollection(id);
  if (!found) return id;
  return found.group === HEADER_GROUP ? l.topOfPage(found.label) : found.label;
}

/** Route patterns to refresh after a page's content changes. */
export function routesForPages(slugs: string[]): {
  path: string;
  type: "page" | "layout";
}[] {
  const routes = new Map<string, "page" | "layout">();
  const add = (slug: string) => {
    const page = findPage(slug);
    if (!page) return;
    if (page.path === null) {
      routes.set("/[locale]", "layout");
      return;
    }
    routes.set(`/[locale]${page.path}`, "page");
    page.alsoShownOn?.forEach(add);
  };
  slugs.forEach(add);
  return [...routes].map(([path, type]) => ({ path, type }));
}
