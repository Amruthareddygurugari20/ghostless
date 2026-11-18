import "server-only";
import type { AiReview } from "./score";

// Free, local AI review using Ollama (https://ollama.com) running on this machine.
// Nothing leaves your computer: job text goes to localhost only.

const BASE = (process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/$/, "");

export class OllamaError extends Error {
  constructor(
    public code: "unavailable" | "no_model" | "failed",
    message: string
  ) {
    super(message);
  }
}

export interface ReviewInput {
  id: string;
  title: string;
  company: string;
  description: string;
}

let modelCache: { at: number; model: string | null } | null = null;

/** OLLAMA_MODEL if set, otherwise the first installed chat model. */
async function pickModel(): Promise<string> {
  if (process.env.OLLAMA_MODEL) return process.env.OLLAMA_MODEL;
  if (modelCache && Date.now() - modelCache.at < 60_000 && modelCache.model) return modelCache.model;
  let data: { models?: { name: string; capabilities?: string[]; details?: { family?: string } }[] };
  try {
    const res = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(1500), cache: "no-store" });
    data = await res.json();
  } catch {
    throw new OllamaError("unavailable", "Local AI is off. Start Ollama to add an AI review of each posting.");
  }
  const chat = (data.models ?? []).filter(
    (m) => !/embed/i.test(m.name) && (!m.capabilities || m.capabilities.includes("completion"))
  );
  const model = chat[0]?.name ?? null;
  modelCache = { at: Date.now(), model };
  if (!model) throw new OllamaError("no_model", "Ollama is running but has no chat model. Run: ollama pull llama3.2");
  return model;
}

// Small local models judge one posting at a time far better than a batch,
// and pick from labels more reliably than they invent numbers.
const SYSTEM = `You check one job posting for signs of a "ghost job" (no real intent to hire soon). Judge ONLY from the text.
Answer "ghost" if it collects resumes for a talent pool / talent community / future opportunities, or is a staffing agency gathering resumes.
Answer "vague" if it names no team, product, project or tools and the duties are generic (e.g. "build models", "other duties as assigned").
Answer "specific" only if it names a team, product or project, or specific tools, or concrete responsibilities.
Then give evidence: copy the short phrase (3 to 8 words) from THIS posting that best supports your verdict.`;

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["specific", "vague", "ghost"] },
    evidence: { type: "string" },
  },
  required: ["verdict", "evidence"],
};

type Verdict = "specific" | "vague" | "ghost";
const RISK: Record<Verdict, number> = { specific: 15, vague: 60, ghost: 92 };
const FALLBACK: Record<Verdict, string> = {
  specific: "finds specific details",
  vague: "finds the posting vague",
  ghost: "sees resume collection",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function reviewOne(model: string, job: ReviewInput): Promise<AiReview | null> {
  const text = `${job.title} at ${job.company}. ${job.description}`.slice(0, 900);
  if (job.description.trim().length < 40) return null; // too little to judge

  let res: Response;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      cache: "no-store",
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: SCHEMA,
        options: { temperature: 0, num_predict: 80 },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: text },
        ],
      }),
    });
  } catch {
    throw new OllamaError("unavailable", "Local AI didn't answer in time.");
  }
  if (res.status === 404) throw new OllamaError("no_model", `Ollama doesn't have the model “${model}”. Run: ollama pull ${model}`);
  if (!res.ok) throw new OllamaError("failed", `Local AI returned an error (${res.status}).`);

  let out: { verdict?: string; evidence?: string };
  try {
    out = JSON.parse((await res.json())?.message?.content ?? "{}");
  } catch {
    return null;
  }
  const verdict = out.verdict as Verdict;
  if (!(verdict in RISK)) return null;

  // Only show the quote if it really is in the posting (no made-up evidence).
  const evidence = String(out.evidence ?? "").replace(/["“”]/g, "").trim();
  const grounded = evidence.length >= 3 && norm(text).includes(norm(evidence));
  const quote = evidence.length > 46 ? `${evidence.slice(0, 45)}…` : evidence;
  const reason = grounded ? `${verdict === "specific" ? "notes" : "flags"} “${quote}”` : FALLBACK[verdict];
  return { risk: RISK[verdict], reason };
}

export async function reviewJobs(jobs: ReviewInput[]): Promise<{ model: string; reviews: Record<string, AiReview> }> {
  const model = await pickModel();
  const reviews: Record<string, AiReview> = {};
  for (const job of jobs) {
    const r = await reviewOne(model, job);
    if (r) reviews[job.id] = r;
  }
  return { model, reviews };
}
