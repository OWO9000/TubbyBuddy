/**
 * Demo offers from fictional local businesses, each tagged with the kinds of goals it serves, so Rewards can lead with
 * the offers that fit what a person said they want more time for.
 */

export const THEMES = ["outdoors", "study", "reading", "fitness", "creative", "music", "sleep", "mindful", "social", "food"] as const;
export type Theme = (typeof THEMES)[number];

export interface DemoOffer {
  id: string;
  business: string;
  title: string;
  description: string;
  category: string;
  items: { name: string; price: number }[];
  discount: number;
  cap: number;
  points: number;
  terms: string;
  themes: Theme[];
  /** Muse Image prompt for the card art (scripts/generate-art.ts). */
  art: string;
}

const o = (x: DemoOffer) => x;

export const DEMO_OFFERS: DemoOffer[] = [
  o({ id: "demo-boulder", business: "Granite Loft Bouldering (demo)", title: "Half-price day pass + free shoes", description: "Trade your scroll time for a climb. One full day of bouldering with rental shoes.", category: "fitness", items: [{ name: "Day pass", price: 24 }, { name: "Shoe rental", price: 6 }], discount: 50, cap: 30, points: 900, terms: "Weekdays only. One per person per month. Demo listing.", themes: ["fitness", "social"], art: "An indoor bouldering wall with colorful holds, a chalk bag and climbing shoes on a bench, airy skylights." }),
  o({ id: "demo-cafe", business: "Little Ember Coffee (demo)", title: "Any latte, 40% off", description: "Sit down, phone face-down, enjoy a latte.", category: "food", items: [{ name: "Latte", price: 5.5 }], discount: 40, cap: 100, points: 250, terms: "Dine-in only. Demo listing.", themes: ["food", "reading"], art: "A cozy neighborhood coffee shop counter with a latte with heart latte art in a ceramic cup, a croissant, morning light through the window." }),
  o({ id: "demo-pottery", business: "Wheelhouse Clay Studio (demo)", title: "Intro wheel class, 30% off", description: "Two hours, hands in clay, zero notifications.", category: "class", items: [{ name: "Intro wheel class", price: 65 }], discount: 30, cap: 12, points: 1200, terms: "Book 48h ahead. Demo listing.", themes: ["creative", "mindful"], art: "A pottery wheel with a half-thrown clay bowl, clay-dusted tools and small finished pots on a shelf, soft window light." }),
  o({ id: "demo-kayak", business: "Bay Paddle Co. (demo)", title: "Two-hour kayak rental, 35% off", description: "Out on the water, where the feed can't follow.", category: "outdoors", items: [{ name: "Single kayak, 2 hours", price: 48 }], discount: 35, cap: 25, points: 700, terms: "Weather permitting. Life vest included. Demo listing.", themes: ["outdoors", "fitness"], art: "Two bright kayaks resting on a calm bay shoreline at morning, paddles crossed, soft mist and gentle water reflections." }),
  o({ id: "demo-hike", business: "Ridgeline Walks (demo)", title: "Guided sunrise hike, half price", description: "Three easy miles and a view worth getting up for.", category: "outdoors", items: [{ name: "Guided hike", price: 30 }], discount: 50, cap: 20, points: 600, terms: "Saturdays at 6:30. Demo listing.", themes: ["outdoors", "social", "fitness"], art: "A gentle hillside trail at sunrise with wildflowers, a wooden signpost and soft morning fog over distant hills." }),
  o({ id: "demo-bike", business: "Spoke & Wheel Rentals (demo)", title: "Full-day bike rental, 40% off", description: "A city bike, a lock and a map of the quiet routes.", category: "outdoors", items: [{ name: "City bike, full day", price: 35 }], discount: 40, cap: 40, points: 500, terms: "Helmet included. Demo listing.", themes: ["outdoors", "fitness"], art: "A pastel city bike with a wicker basket parked by a waterfront railing, blue sky and a few gulls." }),
  o({ id: "demo-garden", business: "Fog City Botanical Garden (demo)", title: "Two garden passes for the price of one", description: "Bring someone. Leave the phone in the bag.", category: "outdoors", items: [{ name: "Garden pass", price: 15 }], discount: 50, cap: 60, points: 350, terms: "Valid any day. Demo listing.", themes: ["outdoors", "mindful", "social"], art: "A glass greenhouse conservatory full of ferns and palms, a small stone path and a wooden bench, dappled light." }),
  o({ id: "demo-books", business: "Paper Lantern Books (demo)", title: "20% off any two paperbacks", description: "Staff picks wrapped in brown paper. Choose by the first line.", category: "retail", items: [{ name: "Paperback", price: 18 }], discount: 20, cap: 50, points: 300, terms: "In store only. Demo listing.", themes: ["reading", "study"], art: "A small bookshop table stacked with paperbacks, a reading lamp, a potted plant and a wooden ladder against tall shelves." }),
  o({ id: "demo-cowork", business: "Quiet Hours Cowork (demo)", title: "Coworking day pass, 50% off", description: "A desk, fast wifi, and a room where nobody scrolls.", category: "workspace", items: [{ name: "Day pass", price: 30 }], discount: 50, cap: 30, points: 450, terms: "Weekdays 8 to 6. Demo listing.", themes: ["study"], art: "A bright, calm coworking room with long wooden desks, desk lamps, plants and big windows, empty chairs." }),
  o({ id: "demo-study-cafe", business: "Stacks & Steam Study Café (demo)", title: "Bottomless tea and a study table, 30% off", description: "Quiet tables, outlets, and tea until you're done.", category: "food", items: [{ name: "Study table + tea", price: 12 }], discount: 30, cap: 80, points: 280, terms: "Up to 4 hours. Demo listing.", themes: ["study", "reading", "food"], art: "A quiet study café table with an open notebook, a glass teapot, a stack of books and a warm desk lamp." }),
  o({ id: "demo-language", business: "Mesa Language Exchange (demo)", title: "First conversation class free", description: "Learn a language by talking to people, face to face.", category: "class", items: [{ name: "Conversation class", price: 25 }], discount: 100, cap: 20, points: 400, terms: "Spanish, French or Japanese. Demo listing.", themes: ["study", "social"], art: "A round table set for a small conversation class with notebooks, cups of tea and little flag cards, warm light." }),
  o({ id: "demo-yoga", business: "Saltwater Yoga (demo)", title: "Three classes for the price of two", description: "Slow flow, long exhale, no phones on the mat.", category: "fitness", items: [{ name: "Drop-in class", price: 24 }], discount: 33, cap: 40, points: 650, terms: "Use within 30 days. Demo listing.", themes: ["fitness", "mindful", "sleep"], art: "A calm yoga studio with rolled mats, a few blocks, wooden floor and tall windows looking out to the sea." }),
  o({ id: "demo-run", business: "Marina Run Club (demo)", title: "Coached run and club tee, 50% off", description: "5K along the water with people who'll wait for you.", category: "fitness", items: [{ name: "Coached run", price: 20 }], discount: 50, cap: 50, points: 300, terms: "Tuesdays and Saturdays. Demo listing.", themes: ["fitness", "outdoors", "social"], art: "A waterfront running path at early morning with a bright running shoe in the foreground and a lighthouse far away." }),
  o({ id: "demo-guitar", business: "Fret & Fable Music (demo)", title: "Intro guitar lesson, 40% off", description: "Thirty minutes, one teacher, your first three chords.", category: "class", items: [{ name: "Private lesson", price: 45 }], discount: 40, cap: 15, points: 550, terms: "Guitar provided. Demo listing.", themes: ["music", "creative"], art: "An acoustic guitar on a stand next to a music stand with sheet music, a small amp and a rug, soft studio light." }),
  o({ id: "demo-sauna", business: "Cedar Steam Sauna (demo)", title: "Evening sauna session, 30% off", description: "Ninety minutes of heat, cold plunge and quiet.", category: "wellness", items: [{ name: "Sauna session", price: 40 }], discount: 30, cap: 25, points: 500, terms: "After 6pm. Demo listing.", themes: ["sleep", "mindful"], art: "A cedar wood sauna room with a bucket and ladle, soft steam and a small window with evening light." }),
  o({ id: "demo-games", business: "Meeple House Game Café (demo)", title: "Table fee waived for four", description: "Five hundred board games and a table full of people.", category: "food", items: [{ name: "Table fee", price: 8 }], discount: 100, cap: 40, points: 250, terms: "Groups of up to four. Demo listing.", themes: ["social", "food"], art: "A café table with a colorful board game mid-play, dice, cards and mugs of cocoa, shelves of game boxes behind." }),
  o({ id: "demo-art", business: "Brightline Art Supply (demo)", title: "25% off a sketch kit", description: "A sketchbook, pencils and a reason to sit somewhere and draw.", category: "retail", items: [{ name: "Sketch kit", price: 32 }], discount: 25, cap: 40, points: 300, terms: "In store only. Demo listing.", themes: ["creative"], art: "An open sketchbook with pencil drawings, a tin of colored pencils and a watercolor set on a sunny wooden table." }),
  o({ id: "demo-supper", business: "Long Table Supper Club (demo)", title: "Shared-table dinner, 25% off", description: "Twelve strangers, one long table, phones in a basket.", category: "food", items: [{ name: "Dinner seat", price: 60 }], discount: 25, cap: 24, points: 800, terms: "Thursdays. Demo listing.", themes: ["social", "food"], art: "A long wooden dinner table set for many with candles, bread and bowls of salad under string lights." }),
  o({ id: "demo-tea", business: "Night Owl Tea Bar (demo)", title: "Caffeine-free sleep blend, 30% off", description: "Chamomile, lavender and an earlier bedtime.", category: "food", items: [{ name: "Sleep blend tin", price: 16 }], discount: 30, cap: 60, points: 200, terms: "Demo listing.", themes: ["sleep", "food"], art: "A glass cup of chamomile tea beside a small tin of loose tea and a sprig of lavender on a nightstand, soft evening light." }),
];

const KEYWORDS: Record<Theme, string[]> = {
  outdoors: ["outside", "outdoor", "nature", "hike", "hiking", "walk", "park", "fresh air", "bike", "cycling", "kayak", "garden", "beach", "trail", "sun"],
  study: ["study", "learn", "exam", "class", "course", "school", "homework", "language", "code", "coding", "work", "focus", "project", "ship", "career", "write", "writing", "degree"],
  reading: ["read", "book", "novel"],
  fitness: ["gym", "run", "running", "workout", "exercise", "fit", "yoga", "climb", "sport", "swim", "lift", "train", "move"],
  creative: ["art", "draw", "paint", "create", "craft", "pottery", "photo", "design", "make", "build"],
  music: ["guitar", "music", "piano", "sing", "song", "instrument", "band", "drum"],
  sleep: ["sleep", "bed", "midnight", "rest", "tired", "night"],
  mindful: ["calm", "meditat", "stress", "mindful", "breathe", "present", "anxiety", "relax", "slow down"],
  social: ["friend", "family", "people", "social", "date", "partner", "kids", "together", "community"],
  food: ["cook", "eat", "coffee", "meal"],
};

/** Themes a goal points at, from its words. */
export function themesForGoal(goal: string): Theme[] {
  const g = ` ${goal.toLowerCase()} `;
  return THEMES.filter((t) => KEYWORDS[t].some((k) => g.includes(k)));
}

/** For each offer, the first goal it serves (or null), so the app can say why it's shown. */
export function matchOffers<T extends { id: unknown }>(offers: T[], goals: string[], known: Record<string, Theme[]> = {}) {
  const goalThemes = goals.map((g) => ({ goal: g, themes: new Set<Theme>([...(known[g] ?? []), ...themesForGoal(g)]) }));
  const byId = new Map(DEMO_OFFERS.map((d) => [d.id, d.themes]));
  return offers.map((o) => {
    const themes = byId.get(String(o.id)) ?? [];
    const hits = goalThemes.filter((g) => themes.some((t) => g.themes.has(t)));
    return { offer: o, forGoal: hits[0]?.goal ?? null, score: hits.length };
  });
}
