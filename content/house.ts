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
  /** Side the main photo sits on at desktop width. */
  photoSide: "left" | "right";
  photo: string;
  round: string;
  slides: string[];
};

export const houseSections: HouseSection[] = [
  {
    key: "welcome",
    photoSide: "right",
    photo: photo("_DSC1169.jpg"),
    round: photo("_DSC1173_rounded.jpg"),
    slides: [],
  },
  {
    key: "masterBedroom",
    photoSide: "left",
    photo: photo("_DSC1119-min_tinified_Croped.jpg"),
    round: photo("_DSC1118_rounded.jpg"),
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
    photoSide: "right",
    photo: photo("krevat2.jpg"),
    round: photo("_DSC1134_rounded.jpg"),
    slides: [
      photo("_DSC1148.jpg"),
      photo("_DSC1149.jpg"),
      photo("_DSC1132.jpg"),
    ],
  },
  {
    key: "kitchen",
    photoSide: "left",
    photo: photo("_DSC1081.jpg"),
    round: photo("_DSC1093_rounded.jpg"),
    slides: [
      photo("fridge.jpeg"),
      photo("_DSC1089.jpg"),
      photo("_DSC1090.jpg"),
      photo("kitchen.jpeg"),
      photo("_DSC1167.jpg"),
      photo("stove.jpeg"),
      photo("gas-grill.jpeg"),
      photo("sinki.jpeg"),
    ],
  },
  {
    key: "interiorBathroom",
    photoSide: "right",
    photo: photo("_DSC1126.jpg"),
    round: photo("_DSC1142_rounded.jpg"),
    slides: [],
  },
  {
    key: "exteriorBathroom",
    photoSide: "left",
    photo: photo("_DSC1095.jpg"),
    round: photo("_DSC1108_rounded.jpg"),
    slides: [
      photo("_DSC1103.jpg"),
      photo("_DSC1105.jpg"),
      photo("_DSC1112.jpg"),
    ],
  },
  {
    key: "coolOff",
    photoSide: "right",
    photo: photo("_DSC1163.jpg"),
    round: photo("_DSC1166_rounded.jpg"),
    slides: [
      photo("_DSC1157.jpg"),
      photo("_DSC1159.jpg"),
      photo("_DSC1164.jpg"),
      photo("_DSC1168.jpg"),
      photo("_DSC1170.jpg"),
      photo("_DSC1175.jpg"),
      photo("_DSC1172.jpg"),
    ],
  },
];

export const heroImages = {
  home: photo("_DSC1162_opt.jpg"),
  host: photo("_DSC1148.jpg"),
  directions: photo("_DSC1157.jpg"),
  page: photo("_DSC1164.jpg"),
  reserve: photo("_DSC1164.jpg"),
} as const;

export const hostPhoto = "/img/thehost02.jpg";

export type ReviewKey = "alex" | "steven" | "kristina";

export const reviews: {
  key: ReviewKey;
  stars: number;
  reveal: "fade-left" | "fade-up" | "fade-right";
  delay: "400" | "500";
}[] = [
  { key: "alex", stars: 5, reveal: "fade-left", delay: "400" },
  { key: "steven", stars: 5, reveal: "fade-up", delay: "500" },
  { key: "kristina", stars: 4.5, reveal: "fade-right", delay: "400" },
];
