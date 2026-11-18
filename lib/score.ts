// Ghost-job scoring. Pure functions, no imports, so it runs on the server,
// in the browser, or directly under `node` for quick checks.

export type ClueTone = "good" | "warn" | "ghost";

export interface Clue {
  text: string;
  tone: ClueTone;
}

/** Whether the job also appears on the company's own careers board. */
export type CareersCheck = "listed" | "missing" | "unknown";

export interface ScoreInput {
  title: string;
  /** ISO date the posting was created. */
  created: string;
  /** Description text (Adzuna returns a snippet). */
  description: string;
  /** True only when the employer gave a salary (not an estimate). */
  salaryListed: boolean;
  careers: CareersCheck;
  /** How many times this company + title showed up in the same search. */
  duplicates: number;
  now?: number;
}

const DAY = 86_400_000;

export function daysSince(iso: string, now = Date.now()): number | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

// Phrases that usually mean "we're collecting resumes, not hiring".
const PIPELINE_PHRASES = [
  /talent (pool|community|network|pipeline)/i,
  /future (opportunities|openings|roles)/i,
  /evergreen/i,
  /pipeline (role|position|requisition)/i,
  /no (current|immediate) (opening|vacanc)/i,
];

export function scoreJob(input: ScoreInput): { score: number; clues: Clue[]; postedDays: number | null } {
  const signals: { weight: number; clue: Clue }[] = [];
  let score = 70;
  const add = (weight: number, text: string, tone: ClueTone) => {
    score += weight;
    signals.push({ weight, clue: { text, tone } });
  };

  // 1. Posting age — the strongest signal.
  const days = daysSince(input.created, input.now);
  if (days !== null) {
    const label = days === 0 ? "Posted today" : days <= 30 ? `Posted ${days} day${days === 1 ? "" : "s"} ago` : `Open ${days} days`;
    if (days <= 7) add(20, label, "good");
    else if (days <= 14) add(12, label, "good");
    else if (days <= 30) add(0, label, "warn");
    else if (days <= 60) add(-18, label, "warn");
    else if (days <= 90) add(-30, label, "ghost");
    else add(-42, label, "ghost");
  }

  // 2. Careers page
  if (input.careers === "listed") add(12, "On the company careers page", "good");
  else if (input.careers === "missing") add(-18, "Not on the company careers page", "ghost");

  // 3. "Join our talent pool" style language
  const text = `${input.title} ${input.description}`;
  if (PIPELINE_PHRASES.some((re) => re.test(text))) add(-25, "Reads like a talent pool, not a role", "ghost");

  // 4. Salary transparency
  if (input.salaryListed) add(8, "Salary listed", "good");
  else add(-4, "No salary range", "warn");

  // 5. Same role listed many times at once
  if (input.duplicates >= 3) add(-10, `Listed ${input.duplicates} times in this search`, "warn");
  else if (input.duplicates === 2) add(-4, "Listed twice in this search", "warn");

  const clues = signals
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 4)
    .map((s) => s.clue);

  return { score: Math.round(Math.min(98, Math.max(3, score))), clues, postedDays: days };
}

/** Lowercase words, no punctuation — for comparing titles. */
export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9+#\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !["the", "and", "for", "of", "to", "in", "a", "an", "remote", "hybrid", "us", "usa"].includes(w));
}

/** True when a careers-board title is close enough to the posting's title. */
export function titleMatches(title: string, boardTitles: string[]): boolean {
  const want = titleTokens(title);
  if (want.length === 0) return false;
  return boardTitles.some((bt) => {
    const have = new Set(titleTokens(bt));
    const hits = want.filter((w) => have.has(w)).length;
    return hits / want.length >= 0.75;
  });
}

/** A local-AI read of the posting text (see lib/ollama.ts). */
export interface AiReview {
  /** 0 = clearly a real opening, 100 = clearly a ghost job. */
  risk: number;
  reason: string;
}

/** Blend an AI review into a rule-based score: moves it by at most ±15. */
export function applyAiReview(score: number, clues: Clue[], ai: AiReview): { score: number; clues: Clue[] } {
  const risk = Math.min(100, Math.max(0, ai.risk));
  const delta = Math.round((50 - risk) * 0.3);
  const tone: ClueTone = risk < 35 ? "good" : risk < 65 ? "warn" : "ghost";
  const clue: Clue = { text: `AI ${ai.reason}`, tone };
  const next = [...clues];
  next.splice(1, 0, clue); // right after the strongest rule-based clue
  return { score: Math.round(Math.min(98, Math.max(3, score + delta))), clues: next.slice(0, 4) };
}
