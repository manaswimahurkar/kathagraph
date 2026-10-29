// What kind of structure a monument is, so the map can stand a small 3D model of it on its spot.
// Uses the backend's `category` when it sends one; otherwise guesses from the name.

export type Category =
  | "temple"
  | "stepwell"
  | "fort"
  | "mosque"
  | "tomb"
  | "cave"
  | "lake"
  | "palace"
  | "museum"
  | "site";

export const CATEGORY_LABEL: Record<Category, string> = {
  temple: "Temple",
  stepwell: "Stepwell",
  fort: "Fort or gateway",
  mosque: "Mosque",
  tomb: "Tomb",
  cave: "Caves",
  lake: "Lake or tank",
  palace: "Palace",
  museum: "Museum or memorial",
  site: "Heritage site",
};

const RULES: [Category, RegExp][] = [
  ["stepwell", /\b(vav|vaav|stepwell|baoli|kund)\b/i],
  ["cave", /\bcaves?\b/i],
  ["mosque", /\b(mosque|masjid|roza)\b/i],
  ["tomb", /\b(tomb|maqbara|dargah|mausoleum|rauza)\b/i],
  ["fort", /\b(fort|kot|qila|darwaza|gate|sarai|wall)\b/i],
  ["palace", /\b(palace|mahal|vilas)\b/i],
  ["lake", /\b(lake|talav|talao|sarovar|tank|causeway)\b/i],
  ["museum", /\b(museum|sangrahalaya|ashram|mandir, porbandar|kirti mandir|memorial)\b/i],
  ["temple", /\b(temple|temples|mandir|derasar|jain|stupa|monastery|chauri|shamlaji|somnath|dwarka|ambaji|palitana|girnar)\b/i],
];

export function categoryOf(name: string, fromServer?: string | null): Category {
  if (fromServer && fromServer in CATEGORY_LABEL) return fromServer as Category;
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return "site";
}
