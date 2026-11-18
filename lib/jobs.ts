// Sample data (made-up companies) plus shared job types and helpers.

import type { AiReview, Clue, ClueTone } from "./score";
export type { AiReview, Clue, ClueTone } from "./score";

export type Verdict = "real" | "maybe" | "ghost";

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  score: number;
  /** Position around the radar, in degrees. */
  angle: number;
  clues: Clue[];
  referrers?: number;
  /** Show a floating label for this orb on desktop. */
  label?: boolean;
  /** Live results only: link to the posting. */
  url?: string;
  /** Live results only: posting text, for the local AI review. */
  description?: string;
  /** Set once the local AI has reviewed this posting. */
  ai?: AiReview;
}

/** Spread orbs around the radar: golden angle keeps neighbours apart. */
export const angleFor = (i: number) => (i * 137.508 + 35) % 360;

export const PALETTE = {
  bg: "#020305",
  real: "#2EF2B0",
  maybe: "#FFB648",
  ghost: "#9B8CFF",
  cyan: "#4FD8FF",
} as const;

export const VERDICT_COLOR: Record<Verdict, string> = {
  real: PALETTE.real,
  maybe: PALETTE.maybe,
  ghost: PALETTE.ghost,
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  real: "Likely real",
  maybe: "Maybe",
  ghost: "Likely ghost",
};

export const TONE_COLOR: Record<ClueTone, string> = {
  good: PALETTE.real,
  warn: PALETTE.maybe,
  ghost: PALETTE.ghost,
};

export function verdictFor(score: number): Verdict {
  if (score >= 75) return "real";
  if (score >= 35) return "maybe";
  return "ghost";
}

/**
 * Distance from the radar center for a score: 90+ hugs the center,
 * under 35 drifts out into the ghost zone near the edge (disc radius = 5).
 */
const ANCHORS: [score: number, radius: number][] = [
  [100, 0.6],
  [90, 1.3],
  [75, 2.2],
  [50, 3.3],
  [35, 4.0],
  [0, 4.95],
];

export function radiusForScore(score: number): number {
  const s = Math.max(0, Math.min(100, score));
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const [s0, r0] = ANCHORS[i];
    const [s1, r1] = ANCHORS[i + 1];
    if (s <= s0 && s >= s1) {
      const t = (s0 - s) / (s0 - s1);
      return r0 + (r1 - r0) * t;
    }
  }
  return ANCHORS[ANCHORS.length - 1][1];
}

export const jobs: Job[] = [
  {
    id: "kestrel-ml",
    title: "ML Engineer",
    company: "Kestrel AI",
    location: "Remote",
    score: 92,
    angle: 35,
    referrers: 2,
    label: true,
    clues: [
      { text: "Posted 3 days ago", tone: "good" },
      { text: "On the company careers page", tone: "good" },
      { text: "2 people can refer you", tone: "good" },
      { text: "No salary range", tone: "warn" },
    ],
  },
  {
    id: "tallgrass-ai",
    title: "AI Engineer",
    company: "Tallgrass Data",
    location: "Cincinnati",
    score: 84,
    angle: 300,
    clues: [
      { text: "Posted 9 days ago", tone: "good" },
      { text: "Salary listed", tone: "good" },
      { text: "Headcount steady", tone: "good" },
    ],
  },
  {
    id: "cobalt-as",
    title: "Applied Scientist",
    company: "Cobalt Health",
    location: "Remote",
    score: 71,
    angle: 155,
    label: true,
    clues: [
      { text: "Hiring is up", tone: "good" },
      { text: "Posted 21 days ago", tone: "warn" },
      { text: "Reposted once", tone: "warn" },
    ],
  },
  {
    id: "fernway-ds",
    title: "Data Scientist",
    company: "Fernway",
    location: "Remote",
    score: 58,
    angle: 215,
    clues: [
      { text: "Posted 34 days ago", tone: "warn" },
      { text: "Reposted twice", tone: "warn" },
      { text: "Headcount flat", tone: "warn" },
    ],
  },
  {
    id: "quarry-sae",
    title: "Senior AI Engineer",
    company: "Quarry Systems",
    location: "Remote",
    score: 44,
    angle: 95,
    clues: [
      { text: "Open 61 days", tone: "warn" },
      { text: "Not on the careers page", tone: "ghost" },
      { text: "Hiring has slowed", tone: "warn" },
    ],
  },
  {
    id: "orbit-ml",
    title: "ML Engineer",
    company: "Orbit Freight",
    location: "Remote",
    score: 31,
    angle: 350,
    clues: [
      { text: "Open 96 days", tone: "ghost" },
      { text: "Reposted 5 times", tone: "ghost" },
      { text: "Layoffs in a public notice", tone: "ghost" },
    ],
  },
  {
    id: "lumen-ape",
    title: "AI Platform Engineer",
    company: "Lumen Bio",
    location: "Mason, OH",
    score: 22,
    angle: 265,
    label: true,
    clues: [
      { text: "Open 120 days", tone: "ghost" },
      { text: "Says “join our talent pool”", tone: "ghost" },
      { text: "No one has heard back", tone: "ghost" },
    ],
  },
];
