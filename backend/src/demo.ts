/**
 * Deterministic, offline "demo coach".
 *
 * The product is built around Meta Muse (Spark text + vision, Image). When the server has no
 * META_MODEL_API_KEY every AI screen would otherwise be a 503, which makes the app impossible to
 * demo on a fresh machine. These helpers keep the exact same API shapes and UI flows, but use
 * local templates/heuristics instead of a model. Responses are marked `mode: "demo"` so the UI
 * can say so, and the live path is untouched when a key is present.
 */
import { APP_NAME } from "./config.js";
import type { Business } from "./data/directory.js";
import type { RawOffer } from "./offerSanity.js";

export const DEMO_MODE = "demo" as const;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const pick = <T>(items: readonly T[], seed: string): T => items[hash(seed) % items.length];

const clip = (s: string, max = 140) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

const cleanGoal = (goal: string) => goal.trim().replace(/[.!]+$/, "");

export interface NudgeInput {
  goals: string | string[];
  appName: string;
  pointsAtRisk: number;
  streak: number;
  tone?: string;
  nextReward?: string;
  history?: { nudge: string; outcome: "backed_off" | "opened_anyway" }[];
}

/** One local nudge, shaped exactly like POST /api/nudge's model result. */
export function localNudge(ctx: NudgeInput): { nudge: string; tone: string } {
  const goals = (Array.isArray(ctx.goals) ? ctx.goals : [ctx.goals]).map(cleanGoal).filter(Boolean);
  const goal = goals.length ? pick(goals, `${ctx.appName}|goal|${ctx.streak}`) : "";
  const app = ctx.appName;
  const points = ctx.pointsAtRisk;
  const streak = ctx.streak;
  const reward = ctx.nextReward?.trim();

  type Line = { text: string; tone: string };
  const lines: Line[] = [];

  // A brand-new account has nothing to burn. Talk about the habit and the goal, never "0 points".
  if (points <= 0) {
    const zero: Line[] = [
      { text: `Habit talking. ${app} can wait; the next real-life reward can't.`, tone: "witty" },
      { text: `You opened ${app} on autopilot. Close it and keep the day yours.`, tone: "calm" },
      { text: `Nothing to burn yet, so make this the first win. Put ${app} down.`, tone: "hype" },
    ];
    if (streak > 0) zero.push({ text: `${streak} days strong. Don't trade that for ${app}.`, tone: "tough-love" });
    if (goal) {
      zero.push(
        { text: `${goal} won't happen with ${app} open. Put it down.`, tone: "tough-love" },
        { text: `You said you wanted to ${goal.toLowerCase()}. ${app} is not that.`, tone: "playful" },
      );
    }
    const preferredZero = ctx.tone ? zero.filter((l) => l.tone === ctx.tone) : [];
    const chosenZero = pick(preferredZero.length ? preferredZero : zero, `${app}|zero|${goal}`);
    return { nudge: clip(chosenZero.text), tone: chosenZero.tone };
  }

  if (streak > 0) {
    lines.push(
      { text: `${streak} days strong. Opening ${app} burns ${points} points and resets the streak.`, tone: "tough-love" },
      { text: `${app} costs ${points} points. You've earned ${streak} days of not doing this.`, tone: "calm" },
      { text: `Keep the ${streak}-day streak alive. Close ${app} and ${points} points stay yours.`, tone: "hype" },
    );
  } else {
    lines.push(
      { text: `No streak yet, so start one now: close ${app} and keep your ${points} points.`, tone: "calm" },
      { text: `Today is day one. Put ${app} down and bank ${points} points.`, tone: "hype" },
      { text: `First win of the day is the easiest. ${app} can wait.`, tone: "playful" },
    );
  }

  if (goal) {
    lines.push(
      { text: `${app}: ${points} points on the line. ${goal} is the better trade.`, tone: "witty" },
      { text: `${goal} won't happen with ${app} open. Put it down.`, tone: "tough-love" },
      { text: `You said you wanted to ${goal.toLowerCase()}. ${app} is not that.`, tone: "playful" },
      { text: `Put ${app} down. ${points} points saved, "${goal}" closer.`, tone: "calm" },
    );
  }
  if (reward) {
    lines.push(
      { text: `You're close to ${reward}. ${app} costs ${points} points and the progress.`, tone: "hype" },
      { text: `Skip ${app} and you're ${points} points nearer to ${reward}.`, tone: "playful" },
    );
  }
  lines.push(
    { text: `Habit talking. ${app} can wait; the ${points} points can't be un-burned.`, tone: "witty" },
    { text: `Breathe. Close ${app}. ${points} points stay with you.`, tone: "calm" },
    { text: `One more scroll costs ${points} points. Keep them.`, tone: "tough-love" },
    { text: `${app} will still be there. Your ${points} points won't if you open it.`, tone: "witty" },
  );

  const preferred = ctx.tone ? lines.filter((l) => l.tone === ctx.tone) : [];
  const pool = preferred.length ? preferred : lines;
  const chosen = pick(pool, `${ctx.appName}|${ctx.streak}|${ctx.pointsAtRisk}|${goal}`);
  return { nudge: clip(chosen.text), tone: chosen.tone };
}

const BATCH_TEMPLATES: { text: string; tone: string }[] = [
  { text: "{app} will still be there. Your {points} points won't if you open it.", tone: "witty" },
  { text: "Put {app} down and keep {points} points. That's the whole trick.", tone: "calm" },
  { text: "{points} points, gone, for {app}? Not today.", tone: "playful" },
  { text: "You opened {app} out of habit. Close it and keep the streak.", tone: "tough-love" },
  { text: "{app} can wait. {points} points can't be un-burned.", tone: "witty" },
  { text: "One tap burns {points} points on {app}. Your call.", tone: "calm" },
  { text: "Trade {app} for {points} points. Best deal you'll make today.", tone: "hype" },
  { text: "Your future self says thanks for closing {app}.", tone: "playful" },
];

/** A batch of cached nudge templates (with {points}/{streak}/{app} placeholders). */
export function localNudgeBatch(count: number, ctx: NudgeInput): { text: string; tone: string }[] {
  const offset = hash(`${ctx.appName}|batch`) % BATCH_TEMPLATES.length;
  return Array.from({ length: count }, (_, i) => BATCH_TEMPLATES[(offset + i) % BATCH_TEMPLATES.length]);
}

/** The bundled sample menu (web/public/samples/menu-ember-oak.jpg), transcribed. */
export const SAMPLE_MENU: RawOffer = {
  business: "Ember & Oak Café",
  offerTitle: "Oat latte + butter croissant, 25% off",
  description:
    "A slow morning without the scroll: a silky oat latte and a laminated butter croissant at the corner café. Phones face down.",
  items: [
    { name: "Espresso", price: 3.25 },
    { name: "Oat Latte", price: 5.5 },
    { name: "Cardamom Cappuccino", price: 5.75 },
    { name: "Cold Brew", price: 4.75 },
    { name: "Butter Croissant", price: 4.25 },
    { name: "Sourdough Toast", price: 6 },
    { name: "Morning Bun", price: 4.5 },
    { name: "Latte Art Class", price: 28 },
    { name: "Brunch Board for Two", price: 32 },
  ],
  regularPrice: 9.75,
  suggestedDiscountPercent: 25,
  monthlyCap: 40,
  pointsPrice: 240,
  terms: "Weekday mornings before 11am. One per person per month. Dine-in.",
  category: "food",
  confidence: 0.93,
  notes: "Demo reader matched the bundled sample menu. Check prices before publishing.",
};

/**
 * Draft offer for demo mode. With `sampleMenu` we can reproduce the bundled menu exactly;
 * otherwise we return an honest low-confidence skeleton the merchant edits by hand.
 */
export function localOffer(opts: { businessName?: string; sampleMenu?: boolean }): RawOffer {
  if (opts.sampleMenu) {
    return { ...SAMPLE_MENU, business: opts.businessName?.trim() || SAMPLE_MENU.business };
  }
  return {
    business: opts.businessName?.trim() || "",
    offerTitle: "20% off your signature item",
    description:
      "A low-friction perk for your quiet hours. Edit the title, price and terms to match what you actually sell.",
    items: [],
    regularPrice: 0,
    suggestedDiscountPercent: 20,
    monthlyCap: 30,
    pointsPrice: 300,
    terms: "One per person per month. Mention the offer when you order.",
    category: "other",
    confidence: 0.2,
    notes:
      "Demo mode: no Meta vision model configured, so the photo was not read. Fill in the item and prices manually, or set META_MODEL_API_KEY on the server for photo reading.",
  };
}

/** Demo proof check: accept the photo, but say plainly that no vision model checked it. */
export function localProof(): { isRealVisit: boolean; confidence: number; reason: string } {
  return {
    isRealVisit: true,
    confidence: 0.6,
    reason: "Photo received. Demo mode accepted it without a vision check.",
  };
}

export interface ScoutInput {
  city: string;
  category: string;
  topN: number;
}

export interface ScoutStep {
  n: number;
  kind: "tool_call" | "message";
  tool?: string;
  args?: unknown;
  result?: unknown;
  text?: string;
  ms: number;
}

export interface ScoutResult {
  runId: string;
  input: ScoutInput;
  complete: boolean;
  ranked: { businessId: string; name: string; category: string; neighborhood: string; score: number; reasons: string[] }[];
  drafts: {
    id: string;
    businessId: string;
    businessName: string;
    to: string;
    subject: string;
    body: string;
    proposedOffer: string;
    status: "draft_not_sent";
  }[];
  summary: string;
  totalMs: number;
  steps: ScoutStep[];
  mode: typeof DEMO_MODE;
  outreachSent: false;
}

const PROPOSED_OFFER: Record<string, string> = {
  food: "20% off a signature item, capped at 40 redemptions a month",
  drinks: "25% off any drink before 5pm, capped at 60 a month",
  fitness: "Half-price day pass, capped at 30 a month",
  class: "30% off an intro class, capped at 20 a month",
  experience: "25% off an off-peak booking, capped at 20 a month",
  retail: "15% off one item, capped at 50 a month",
  other: "20% off your quietest hour, capped at 30 a month",
};

function scoreBusiness(b: Business, category: string): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 45;
  if (category !== "any" && b.category === category) {
    score += 18;
    reasons.push(`Matches your ${category} focus`);
  }
  if (b.rating >= 4.6) {
    score += 8;
    reasons.push(`Loved locally (${b.rating}★)`);
  }
  if (b.slowHours) {
    score += 12;
    reasons.push(`Has slow hours: ${b.slowHours.toLowerCase()}`);
  }
  if (b.tags.some((t) => /community|beginner-friendly|hands-on|social|no-laptop/.test(t))) {
    score += 8;
    reasons.push("Social, hands-on crowd");
  }
  if (b.priceLevel <= 2) {
    score += 5;
    reasons.push("Accessible price point");
  }
  return { score: Math.max(35, Math.min(96, Math.round(score))), reasons: reasons.slice(0, 3) };
}

/** Run a deterministic, step-by-step scout so the agent screen works without a key. */
export function localScout(input: ScoutInput, businesses: Business[]): ScoutResult {
  const t0 = Date.now();
  const steps: ScoutStep[] = [];
  let n = 0;
  const push = (s: Omit<ScoutStep, "n" | "ms">, ms = 120) => steps.push({ n: ++n, ms, ...s });

  push({ kind: "message", text: `Demo mode: scanning ${input.city} for ${input.category === "any" ? "any" : input.category} partners.` });

  const found = businesses.filter(
    (b) => b.city.toLowerCase() === input.city.toLowerCase() && (input.category === "any" || b.category === input.category),
  );
  push(
    { kind: "tool_call", tool: "search_businesses", args: { city: input.city, category: input.category }, result: found.map((b) => ({ id: b.id, name: b.name, category: b.category, neighborhood: b.neighborhood, rating: b.rating })) },
    180,
  );

  for (const b of found.slice(0, 8)) {
    const { contact: _contact, ...profile } = b;
    push({ kind: "tool_call", tool: "get_business_profile", args: { businessId: b.id }, result: profile }, 90);
  }

  const scored = found
    .map((b) => ({ business: b, ...scoreBusiness(b, input.category) }))
    .sort((a, b) => b.score - a.score || a.business.name.localeCompare(b.business.name));
  push(
    {
      kind: "tool_call",
      tool: "score_candidates",
      args: { scores: scored.map((s) => ({ businessId: s.business.id, score: s.score, reasons: s.reasons })) },
      result: { ok: true, recorded: scored.length, unknownIds: [] },
    },
    220,
  );

  const top = scored.slice(0, input.topN);
  const drafts: ScoutResult["drafts"] = [];
  for (const { business: b } of top) {
    const proposedOffer = PROPOSED_OFFER[b.category] ?? PROPOSED_OFFER.other;
    const subject = `A quiet-hours perk for ${b.name}?`;
    const body = `Hi ${b.name} team,\n\nI'm with ${APP_NAME}, a focus app where people earn points for staying off their phones and spend them at local spots. ${b.description}\n\nYou mentioned ${b.slowHours.toLowerCase()} is quiet, and that's exactly when our members are looking for somewhere to go. We'd feature you in the app with "${proposedOffer}". No setup cost, and you only honour the ones customers actually claim.\n\nWould you be open to a short chat this week?\n\nThe ${APP_NAME} team`;
    const draft = {
      id: `draft_demo_${b.id}`,
      businessId: b.id,
      businessName: b.name,
      to: b.contact,
      subject,
      body,
      proposedOffer,
      status: "draft_not_sent" as const,
    };
    drafts.push(draft);
    push(
      { kind: "tool_call", tool: "draft_outreach", args: { businessId: b.id, subject, body, proposedOffer }, result: { draftId: draft.id, status: draft.status, note: "Saved for human review. Not sent." } },
      140,
    );
  }

  const summary =
    top.length > 0
      ? `Demo mode found ${found.length} ${input.category === "any" ? "" : `${input.category} `}businesses in ${input.city}. Best fits: ${top.map((t) => t.business.name).join(", ")}. Drafts are ready for review. Nothing was sent.`
      : `No businesses matched ${input.city} / ${input.category}. Try another city or category.`;
  push({ kind: "message", text: summary }, 100);

  return {
    runId: `run_demo_${hash(`${input.city}|${input.category}|${Date.now()}`)}`,
    input,
    complete: drafts.length > 0,
    ranked: scored.map((s) => ({
      businessId: s.business.id,
      name: s.business.name,
      category: s.business.category,
      neighborhood: s.business.neighborhood,
      score: s.score,
      reasons: s.reasons,
    })),
    drafts,
    summary,
    totalMs: Date.now() - t0,
    steps,
    mode: DEMO_MODE,
    outreachSent: false,
  };
}
