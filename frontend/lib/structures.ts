// What kind of structure a monument is, so the map can stand a small 3D model of it on its spot.
// Uses the backend's `nature` and `category` when it sends them; otherwise guesses from the name.

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
  | "site"
  // natural places and settlements
  | "mountain"
  | "island"
  | "sacred_lake"
  | "grove"
  | "town";

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
  mountain: "Mountain or hill",
  island: "Island",
  sacred_lake: "Natural lake",
  grove: "Forest or grove",
  town: "Settlement",
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

/** Which natural shape to draw for a natural site. */
function naturalKind(name: string, fromServer?: string | null): Category {
  if (/\b(island|bet)\b/i.test(name)) return "island";
  if (fromServer === "lake" || /\b(lake|sarovar|talav|talao)\b/i.test(name)) return "sacred_lake";
  if (/(van|vana|forest|grove|garden)\b/i.test(name)) return "grove";
  return "mountain";
}

/**
 * The shape to draw for a monument. `nature` (from the backend) decides first: natural places get
 * a mountain, island, lake or grove; settlements a small town; built sites their structure type.
 */
export function categoryOf(name: string, fromServer?: string | null, nature?: string | null): Category {
  if (nature === "natural") return naturalKind(name, fromServer);
  if (nature === "settlement") return "town";
  if (fromServer && fromServer in CATEGORY_LABEL) return fromServer as Category;
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return "site";
}
