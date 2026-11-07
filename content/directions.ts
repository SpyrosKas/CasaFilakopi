// Picture and arrow for each direction step; words are in messages/*.json.

export type StepIcon =
  "arrowCircleRight" | "arrowCircleLeft" | "arrowCircleUp" | "smileBeam";

export type Step = { image: string; icon: StepIcon };

const pic = (file: string) => `/img/directions_tinified/${file}`;

export const adamasSteps: Step[] = [
  { image: pic("Adamas1.jpg"), icon: "arrowCircleRight" },
  { image: pic("Adamas2.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas3.jpg"), icon: "arrowCircleLeft" },
  { image: pic("Adamas4.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas5.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas6.jpg"), icon: "arrowCircleRight" },
  { image: pic("Adamas7.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas8.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas9.jpg"), icon: "arrowCircleUp" },
  { image: pic("adamas11.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas12.jpg"), icon: "arrowCircleRight" },
  { image: pic("Adamas13.jpg"), icon: "arrowCircleUp" },
  { image: pic("Adamas14.jpg"), icon: "arrowCircleLeft" },
  { image: "/img/tinified/_DSC1168.jpg", icon: "smileBeam" },
];

export const airportSteps: Step[] = [
  { image: pic("Airport1.jpg"), icon: "arrowCircleRight" },
];
