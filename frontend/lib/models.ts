// 3D scans of each monument, shown with Sketchfab's own viewer (embedded, not downloaded).
// These scans are not openly licensed: all rights stay with their authors. We only embed them
// through Sketchfab's player, which the authors allow, and credit each author by name with a link.
// Matched to a monument by name, so the same list works for demo and live data.

export interface SiteModel {
  uid: string; // Sketchfab model id
  label: string; // our short name for the tab
  title: string; // the author's title on Sketchfab
  author: string;
  authorUrl: string;
  modelUrl: string;
}

const DORON = { author: "Doron Altaratz", authorUrl: "https://sketchfab.com/doron_altaratz" };

const MODELS: { match: RegExp; models: SiteModel[] }[] = [
  {
    match: /adalaj|rudabai|rudadevi/i,
    models: [
      {
        uid: "c95c5018af984e9daf3fd25b66abcb78",
        label: "Carved balcony",
        title: "Adalaj Gandhinagar Stepwell, Gujarat. Detail",
        ...DORON,
        modelUrl: "https://sketchfab.com/3d-models/adalaj-gandhinagar-stepwell-gujarat-detail-c95c5018af984e9daf3fd25b66abcb78",
      },
      {
        uid: "3348d4f718684ef1aece10a2ba4c5daa",
        label: "Wall niche",
        title: "Adalaj Stepwell (Vav) Gujarat, detail",
        ...DORON,
        modelUrl: "https://sketchfab.com/3d-models/adalaj-stepwell-vav-gujarat-detail-3348d4f718684ef1aece10a2ba4c5daa",
      },
      {
        uid: "cac7b815e7564e86b87277a049a2c74f",
        label: "Pillar",
        title: "Adalaj Gandhinagar Stepwell, Gujarat. Detail",
        ...DORON,
        modelUrl: "https://sketchfab.com/3d-models/adalaj-gandhinagar-stepwell-gujarat-detail-cac7b815e7564e86b87277a049a2c74f",
      },
    ],
  },
  {
    match: /rani\s*-?ki\s*-?va[av]|queen'?s stepwell/i,
    models: [
      {
        uid: "de3d47ebe4244c25ad88812e0d6a8d05",
        label: "Sculpted wall",
        title: "Rani Ki Stepwell (Vav) Patan, Gujarat. detail",
        ...DORON,
        modelUrl: "https://sketchfab.com/3d-models/rani-ki-stepwell-vav-patan-gujarat-detail-de3d47ebe4244c25ad88812e0d6a8d05",
      },
      {
        uid: "0ef39b30e2fe4d558424142e95e59999",
        label: "Carved frieze",
        title: "Rani Ki Stepwell (Vav) Patan, Gujarat. detail",
        ...DORON,
        modelUrl: "https://sketchfab.com/3d-models/rani-ki-stepwell-vav-patan-gujarat-detail-0ef39b30e2fe4d558424142e95e59999",
      },
      {
        uid: "1a4fee746a4449c9b67c833fefbf7f98",
        label: "Whole stepwell",
        title: "Rani Ki Vav, Gujarat India",
        author: "CyArk",
        authorUrl: "https://sketchfab.com/CyArk",
        modelUrl: "https://sketchfab.com/3d-models/rani-ki-vav-gujarat-india-1a4fee746a4449c9b67c833fefbf7f98",
      },
    ],
  },
  {
    match: /jama mosque, ahmedabad|jami masjid,? ahmedabad/i,
    models: [
      {
        uid: "abb7c2ef3e124104a5e8c710d30a6dad",
        label: "Stone screen",
        title: "Jami Masjid, Ahmedabad, Gujatat (detail)",
        author: "Doron Altaratz",
        authorUrl: "https://sketchfab.com/doron_altaratz",
        modelUrl: "https://sketchfab.com/3d-models/jami-masjid-ahmedabad-gujatat-detail-abb7c2ef3e124104a5e8c710d30a6dad",
      },
      {
        uid: "3082c0377a3c44eb9c3ff9c1fc35f372",
        label: "Mihrab",
        title: "Jami Masjid, Ahmedabad. A Mihrab",
        author: "Doron Altaratz",
        authorUrl: "https://sketchfab.com/doron_altaratz",
        modelUrl: "https://sketchfab.com/3d-models/jami-masjid-ahmedabad-a-mihrab-3082c0377a3c44eb9c3ff9c1fc35f372",
      },
    ],
  },
  {
    match: /sarkhej/i,
    models: [
      {
        uid: "226ab8796f854fc6b3bd7489aaad1e71",
        label: "Mihrab",
        title: "Sarkhej Roza, Ahmedabad, Gujarat. Mihrab",
        author: "Doron Altaratz",
        authorUrl: "https://sketchfab.com/doron_altaratz",
        modelUrl: "https://sketchfab.com/3d-models/sarkhej-roza-ahmedabad-gujarat-mihrab-226ab8796f854fc6b3bd7489aaad1e71",
      },
      {
        uid: "c1510f0f843c4414a708947f5ac67f80",
        label: "Tomb carving",
        title: "Sarkhej Roza tomb complex (detail)",
        author: "Doron Altaratz",
        authorUrl: "https://sketchfab.com/doron_altaratz",
        modelUrl: "https://sketchfab.com/3d-models/sarkhej-roza-tomb-complex-detail-c1510f0f843c4414a708947f5ac67f80",
      },
      {
        uid: "1256dfad429343038a94f5b07336af94",
        label: "Well",
        title: "Sarkhej Roza, Ahmedabad - well detail",
        author: "Doron Altaratz",
        authorUrl: "https://sketchfab.com/doron_altaratz",
        modelUrl: "https://sketchfab.com/3d-models/sarkhej-roza-ahmedabad-well-detail-1256dfad429343038a94f5b07336af94",
      },
    ],
  },
  {
    match: /rudra\s*mahalaya/i,
    models: [
      {
        uid: "611a7a76a03d490ab98614503608fa89",
        label: "Whole site",
        title: "RUDRA MAHALAYA",
        author: "moniln",
        authorUrl: "https://sketchfab.com/moniln9",
        modelUrl: "https://sketchfab.com/3d-models/rudra-mahalaya-611a7a76a03d490ab98614503608fa89",
      },
    ],
  },
  {
    match: /sidi\s*bashir/i,
    models: [
      {
        uid: "6403e43284104637863864c46c4b7b5d",
        label: "Minarets",
        title: "SIDI BASHIR",
        author: "moniln",
        authorUrl: "https://sketchfab.com/moniln9",
        modelUrl: "https://sketchfab.com/3d-models/sidi-bashir-6403e43284104637863864c46c4b7b5d",
      },
    ],
  },
  {
    match: /mahabat\s*maqbara/i,
    models: [
      {
        uid: "e6a4e6abb2b04c948945ec6d7c8f4f2d",
        label: "Mausoleum",
        title: "Mahabat Maqbara_palace",
        author: "moniln",
        authorUrl: "https://sketchfab.com/moniln9",
        modelUrl: "https://sketchfab.com/3d-models/mahabat-maqbara-palace-e6a4e6abb2b04c948945ec6d7c8f4f2d",
      },
    ],
  },
  {
    match: /champaner-pavagadh|champaner archaeological/i,
    models: [
      {
        uid: "3264bf10b99a4a6bb647419bc6669517",
        label: "Mosque interior",
        title: "Champaner Masjid Indoor",
        author: "Anirban Basak",
        authorUrl: "https://sketchfab.com/anirbanbasak",
        modelUrl: "https://sketchfab.com/3d-models/champaner-masjid-indoor-3264bf10b99a4a6bb647419bc6669517",
      },
    ],
  },
  {
    match: /sabarmati\s*ashram|gandhi\s*ashram/i,
    models: [
      {
        uid: "c2739e5560bc48629d8fd79a6ce65568",
        label: "Charkha (collection)",
        title: "Charkho",
        author: "Gandhi Ashram Sabarmati",
        authorUrl: "https://sketchfab.com/GandhiAshramSabarmati",
        modelUrl: "https://sketchfab.com/3d-models/charkho-c2739e5560bc48629d8fd79a6ce65568",
      },
    ],
  },
  {
    match: /dada\s*harir|bai\s*harir/i,
    models: [
      {
        uid: "c53b539b42e3487cad54b5dfd86bf261",
        label: "Carved detail",
        title: "Dada Harir Stepwell (Vav) Ahmedabad, Gujarat.",
        ...DORON,
        modelUrl: "https://sketchfab.com/3d-models/dada-harir-stepwell-vav-ahmedabad-gujarat-c53b539b42e3487cad54b5dfd86bf261",
      },
    ],
  },
];

export function modelsFor(name: string, aliases: string[] = []): SiteModel[] {
  const names = [name, ...aliases];
  return MODELS.find((m) => names.some((n) => m.match.test(n)))?.models ?? [];
}

export function embedUrl(uid: string): string {
  // autostart: load straight away; dnt: no tracking; ui_theme dark matches the site
  return `https://sketchfab.com/models/${uid}/embed?autostart=1&preload=1&dnt=1&ui_theme=dark&ui_hint=2`;
}
