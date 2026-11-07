import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { findEmptyLanguages } from "@/lib/cms/checks";
import {
  defaultAlts,
  defaultBlocks,
  defaultPlacements,
  phoneLink,
  whatsappLink,
} from "@/lib/cms/defaults";
import { processPhoto, UnreadablePhotoError } from "@/lib/cms/image-process";
import { readEnvFile, resolveTarget } from "@/lib/cms/migrate-guard";
import { planPages, planReviews, stableId } from "@/lib/cms/migrate-plan";
import {
  allPages,
  findCollection,
  findPage,
  routesForPages,
} from "@/lib/cms/registry";
import {
  fromMessage,
  parseRich,
  safeHref,
  sanitizeLine,
  sanitizeText,
} from "@/lib/cms/rich";
import { cleanBlock } from "@/lib/cms/schemas";
import imageSizes from "@/content/image-sizes.json";

describe("sanitising", () => {
  it("removes tags, including ones hidden inside each other", () => {
    expect(sanitizeText("<b>bold</b> text")).toBe("bold text");
    expect(sanitizeText("<<b>script>x")).toBe("x");
    expect(sanitizeText("<img src=x onerror=alert(1)>")).toBe("");
  });

  it("keeps ordinary use of angle brackets and control-free text", () => {
    expect(sanitizeText("2 < 3 and 5 > 4")).toBe("2 < 3 and 5 > 4");
    expect(sanitizeText("a\u0000b\r\nc")).toBe("ab\nc");
  });

  it("makes one line of a one-line field", () => {
    expect(sanitizeLine("one\n  two")).toBe("one two");
  });
});

describe("links", () => {
  it("allows only web, mail, phone and site links", () => {
    expect(safeHref("https://example.test")).toBe("https://example.test");
    expect(safeHref("mailto:a@example.test")).toBe("mailto:a@example.test");
    expect(safeHref("tel:+30123")).toBe("tel:+30123");
    expect(safeHref("/en/host")).toBe("/en/host");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("//evil.test")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });
});

describe("formatting", () => {
  it("reads paragraphs, line breaks, bold, italic and links", () => {
    expect(parseRich("one\ntwo\n\n**three** *four*")).toEqual([
      [
        { type: "text", value: "one" },
        { type: "break" },
        { type: "text", value: "two" },
      ],
      [
        { type: "bold", children: [{ type: "text", value: "three" }] },
        { type: "text", value: " " },
        { type: "italic", children: [{ type: "text", value: "four" }] },
      ],
    ]);
    expect(parseRich("[a](https://example.test)")).toEqual([
      [
        {
          type: "link",
          href: "https://example.test",
          children: [{ type: "text", value: "a" }],
        },
      ],
    ]);
  });

  it("shows a link with a bad address as its words alone", () => {
    expect(parseRich("[a](javascript:alert(1))")[0][0]).toEqual({
      type: "text",
      value: "a",
    });
  });

  it("leaves a lone star alone", () => {
    expect(parseRich("5 * 3")).toEqual([[{ type: "text", value: "5 * 3" }]]);
  });

  it("converts the markup used in messages", () => {
    expect(fromMessage("a<br></br><br></br><em>b</em><br></br> ")).toBe(
      "a\n\n*b*",
    );
  });
});

describe("imported text", () => {
  it("has a block for every section with fields, in page order", () => {
    for (const page of planPages()) {
      const def = findPage(page.slug)!;
      const keys = def.sections
        .filter((section) => section.fields.length > 0 || section.list)
        .map((section) => section.key);
      expect(page.blocks.map((block) => block.key)).toEqual(keys);
    }
  });

  it("fills every field in both languages, legal text apart", () => {
    const missing = [];
    for (const page of allPages()) {
      const blocks = defaultBlocks()[page.slug];
      if (!blocks) continue;
      for (const section of page.sections) {
        for (const field of section.fields) {
          if (field.strict || field.name === "metaDescription") continue;
          const block = blocks[section.key];
          const present = field.shared
            ? block?.shared?.[field.name]
            : block?.en[field.name] && block?.el[field.name];
          if (!present)
            missing.push(`${page.slug}.${section.key}.${field.name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("invents no legal text", () => {
    for (const slug of [
      "house-rules",
      "privacy",
      "terms",
      "cancellation",
      "cookies",
    ]) {
      const { main } = defaultBlocks()[slug];
      expect(main.en.body).toBe("");
      expect(main.el.body).toBe("");
    }
  });

  it("carries no markup from the messages", () => {
    expect(JSON.stringify(defaultBlocks())).not.toMatch(/<\/?(br|em)/);
  });

  it("makes amenities a real list, with the same icons in both languages", () => {
    const { items } = defaultBlocks().home.amenities;
    expect(items).toHaveLength(10);
    for (const item of items!) {
      expect(item.choice).toBeTruthy();
      expect(item.en.label).toBeTruthy();
      expect(item.el.label).toBeTruthy();
    }
    expect(items![0].choice).toBe("hammock");
    expect(items![0].en.label).toBe("Hammock");
  });

  it("keeps every step of the directions", () => {
    const { adamas, airport } = defaultBlocks().directions;
    expect(adamas.items).toHaveLength(14);
    expect(airport.items).toHaveLength(1);
  });

  it("imports the reviews with stars and a stable id", () => {
    const reviews = planReviews();
    expect(reviews.map((review) => review.body.stars)).toEqual([5, 5, 4.5]);
    expect(new Set(reviews.map((review) => review.id)).size).toBe(3);
    expect(stableId("x")).toBe(stableId("x"));
    expect(stableId("x")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("imported photos", () => {
  it("places only photos that exist, in names the site knows", () => {
    const sizes = imageSizes as Record<string, number[]>;
    for (const [collection, paths] of Object.entries(defaultPlacements())) {
      expect(findCollection(collection), collection).toBeTruthy();
      for (const path of paths)
        expect(sizes[`/img/${path}`], path).toBeTruthy();
    }
  });

  it("keeps a description in both languages for each non-decorative photo", () => {
    const alts = defaultAlts();
    for (const [collection, paths] of Object.entries(defaultPlacements())) {
      if (findCollection(collection)!.decorative) continue;
      for (const path of paths) {
        expect(alts[path]?.en, path).toBeTruthy();
        expect(alts[path]?.el, path).toBeTruthy();
      }
    }
  });

  it("keeps the order on the page, wide galleries opening on a sharp photo", () => {
    const placements = defaultPlacements();
    expect(placements["section.masterBedroom"][0]).toContain("Croped");
    expect(placements["section.kitchen"][0]).toBe("tinified/_DSC1167.jpg");
    expect(placements["section.kitchen"].at(-1)).toBe("tinified/_DSC1081.jpg");
  });
});

describe("contact links", () => {
  it("are built from the numbers as typed", () => {
    expect(phoneLink("(+30) 693-470-7765")).toBe("tel:+306934707765");
    expect(whatsappLink("00306934707765")).toBe("https://wa.me/306934707765");
  });
});

describe("saved blocks", () => {
  const page = findPage("home")!;
  const section = page.sections.find((s) => s.key === "kitchen")!;

  it("keeps only known fields, cleaned", () => {
    const result = cleanBlock(section, {
      en: { title: "<b>Kitchen</b>", body: "Text", evil: "x" },
      el: { title: "Κουζίνα", body: "Κείμενο" },
    });
    expect(result).toEqual({
      data: {
        en: { title: "Kitchen", body: "Text" },
        el: { title: "Κουζίνα", body: "Κείμενο" },
      },
    });
  });

  it("names the field that is too long", () => {
    const result = cleanBlock(section, {
      en: { title: "x".repeat(301) },
      el: {},
    });
    expect(result).toEqual({ error: "title is too long." });
  });

  it("refuses a bad address in a link field", () => {
    const contact = findPage("site")!.sections[0];
    const result = cleanBlock(contact, {
      en: {},
      el: {},
      shared: { facebook: "javascript:alert(1)" },
    });
    expect(result).toEqual({ error: "Facebook link does not look right." });
  });

  it("replaces an unknown icon and refuses repeated ids", () => {
    const amenities = page.sections.find((s) => s.key === "amenities")!;
    const item = { id: "a", choice: "bomb", en: {}, el: {} };
    const result = cleanBlock(amenities, { en: {}, el: {}, items: [item] });
    expect("data" in result && result.data.items![0].choice).toBe("hammock");
    expect(
      "error" in cleanBlock(amenities, { en: {}, el: {}, items: [item, item] }),
    ).toBe(true);
  });
});

describe("empty languages", () => {
  it("names a field with text in one language only", () => {
    const page = findPage("home")!;
    expect(
      findEmptyLanguages(page, {
        kitchen: {
          en: { title: "Kitchen", body: "" },
          el: { title: "", body: "" },
        },
      }),
    ).toEqual(["Kitchen: title (Greek is empty)"]);
  });
});

describe("revalidation", () => {
  it("touches only the pages that show the content", () => {
    expect(routesForPages(["host"])).toEqual([
      { path: "/[locale]/host", type: "page" },
    ]);
    expect(routesForPages(["home"])).toEqual([
      { path: "/[locale]", type: "page" },
      { path: "/[locale]/gallery", type: "page" },
    ]);
    expect(routesForPages(["site"])).toEqual([
      { path: "/[locale]", type: "layout" },
    ]);
  });
});

describe("collections", () => {
  it("knows step and page collections and nothing invented", () => {
    expect(findCollection("step.adamas-1")?.single).toBe(true);
    expect(findCollection("og.home")?.optional).toBe(true);
    expect(findCollection("step.Bad Id")).toBeUndefined();
    expect(findCollection("og.nothing")).toBeUndefined();
    expect(findCollection("section.nothing")).toBeUndefined();
  });
});

describe("the import guard", () => {
  const local = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_SECRET_KEY: "local",
  };
  const staging = "https://iecsohriashrdbqcelkl.supabase.co";

  it("runs locally on the key from the file", () => {
    expect(resolveTarget([], {}, local)).toEqual({
      url: local.NEXT_PUBLIC_SUPABASE_URL,
      secretKey: "local",
    });
  });

  it("runs on staging with the key from the shell and the named ref", () => {
    const target = resolveTarget(
      ["--staging=iecsohriashrdbqcelkl"],
      { NEXT_PUBLIC_SUPABASE_URL: staging, SUPABASE_SECRET_KEY: "shell" },
      local,
    );
    expect(target).toEqual({ url: staging, secretKey: "shell" });
  });

  it("never sends the local key to a hosted project", () => {
    const target = resolveTarget(
      ["--staging=iecsohriashrdbqcelkl"],
      { NEXT_PUBLIC_SUPABASE_URL: staging },
      local,
    );
    expect(target).toHaveProperty("refusal");
  });

  it("refuses any other host, and anything named production", () => {
    for (const shell of [
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://other.supabase.co",
        SUPABASE_SECRET_KEY: "k",
      },
      { ...local, VERCEL_ENV: "production" },
      { NEXT_PUBLIC_SUPABASE_URL: staging, SUPABASE_SECRET_KEY: "k" },
    ]) {
      expect(resolveTarget([], shell, {})).toHaveProperty("refusal");
    }
  });

  it("reads .env.local without touching the environment", () => {
    expect(readEnvFile('A_B="1"\n# note\nC=2\n')).toEqual({ A_B: "1", C: "2" });
  });
});

describe("photo processing", () => {
  const withGps = () =>
    sharp({
      create: {
        width: 3000,
        height: 3000,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .withExif({
        IFD0: { Make: "SecretCamera" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "36/1 44/1 0/1" },
      })
      .jpeg()
      .toBuffer();

  it("drops all metadata and caps the size", async () => {
    const input = await withGps();
    expect(input.includes("SecretCamera")).toBe(true);
    const photo = await processPhoto(input);
    const metadata = await sharp(photo.data).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(photo.data.includes("SecretCamera")).toBe(false);
    expect(photo.width).toBe(2560);
  });

  it("does not enlarge a small photo", async () => {
    const small = await sharp({
      create: { width: 200, height: 100, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    expect((await processPhoto(small)).width).toBe(200);
  });

  it("refuses what is not a photo, whatever it claims to be", async () => {
    await expect(processPhoto(Buffer.from("hello"))).rejects.toThrow(
      UnreadablePhotoError,
    );
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    );
    await expect(processPhoto(svg)).rejects.toThrow(UnreadablePhotoError);
  });
});
