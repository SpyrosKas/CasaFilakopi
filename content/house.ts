// Photo layout of the site. Interim until T4.19 moves images to the database;
// the words live in messages/*.json.

const photo = (file: string) => `/img/tinified/${file}`;

export type HouseSectionKey =
  | "welcome"
  | "masterBedroom"
  | "secondBedroom"
  | "kitchen"
  | "interiorBathroom"
  | "exteriorBathroom"
  | "coolOff";

export type HouseSection = {
  key: HouseSectionKey;
  photo: string;
  slides: string[];
  /**
   * Home opens these wide galleries on a sharp photo: the main one is only
   * 635 px across, too small to lead at that size.
   */
  mainPhotoLast?: boolean;
};

export const houseSections: HouseSection[] = [
  {
    key: "welcome",
    photo: photo("_DSC1169.jpg"),
    slides: [],
  },
  {
    key: "masterBedroom",
    photo: photo("_DSC1119-min_tinified_Croped.jpg"),
    slides: [
      photo("_DSC1121.jpg"),
      photo("_DSC1118.jpg"),
      photo("_DSC1137.jpg"),
      photo("_DSC1138.jpg"),
      photo("_DSC1146.jpg"),
      photo("_DSC1150.jpg"),
    ],
  },
  {
    key: "secondBedroom",
    photo: photo("krevat2.jpg"),
    slides: [
      photo("_DSC1148.jpg"),
      photo("_DSC1149.jpg"),
      photo("_DSC1132.jpg"),
    ],
  },
  {
    key: "kitchen",
    photo: photo("_DSC1081.jpg"),
    mainPhotoLast: true,
    slides: [
      photo("_DSC1167.jpg"),
      photo("_DSC1089.jpg"),
      photo("kitchen.jpeg"),
      photo("stove.jpeg"),
      photo("sinki.jpeg"),
      photo("gas-grill.jpeg"),
      photo("_DSC1090.jpg"),
      photo("fridge.jpeg"),
    ],
  },
  {
    key: "interiorBathroom",
    photo: photo("_DSC1126.jpg"),
    slides: [],
  },
  {
    key: "exteriorBathroom",
    photo: photo("_DSC1095.jpg"),
    slides: [
      photo("_DSC1103.jpg"),
      photo("_DSC1105.jpg"),
      photo("_DSC1112.jpg"),
    ],
  },
  {
    key: "coolOff",
    photo: photo("_DSC1163.jpg"),
    mainPhotoLast: true,
    slides: [
      photo("_DSC1170.jpg"),
      photo("_DSC1172.jpg"),
      photo("_DSC1159.jpg"),
      photo("_DSC1168.jpg"),
      photo("_DSC1157.jpg"),
      photo("_DSC1164.jpg"),
      photo("_DSC1175.jpg"),
    ],
  },
];

/** Message key in the Photos namespace: the file name without its extension. */
export function photoKey(src: string) {
  return src.slice(src.lastIndexOf("/") + 1, src.lastIndexOf("."));
}

export const heroImages = {
  home: photo("_DSC1162_opt.jpg"),
  host: photo("_DSC1148.jpg"),
  directions: photo("_DSC1157.jpg"),
  page: photo("_DSC1164.jpg"),
  reserve: photo("_DSC1164.jpg"),
} as const;

export const hostPhoto = "/img/thehost02.jpg";

/** The full-width picture of the house in its landscape on Home. */
export const landscapePhoto = photo("_DSC1175.jpg");

export type ReviewKey = "alex" | "steven" | "kristina";

export const reviews: { key: ReviewKey; stars: number }[] = [
  { key: "alex", stars: 5 },
  { key: "steven", stars: 5 },
  { key: "kristina", stars: 4.5 },
];
