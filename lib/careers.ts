import "server-only";
import { titleMatches, type CareersCheck } from "./score";

// Many companies post jobs through Greenhouse or Lever, which publish
// free, public job-board APIs. We guess the board name from the company
// name. If no board is found we say nothing (unknown), never "ghost".

type Board = string[] | null;
const cache = new Map<string, { at: number; titles: Board }>();
const TTL = 6 * 60 * 60 * 1000;

function boardNames(company: string): string[] {
  const words = company
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|group|holdings)\b\.?/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return [];
  return [...new Set([words.join(""), words.join("-")])].filter((s) => s.length >= 2);
}

async function getJson(url: string, ms: number): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function findBoard(company: string): Promise<Board> {
  const key = company.toLowerCase().trim();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.titles;

  const lookups = boardNames(company).flatMap((name) => [
    getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(name)}/jobs`, 3000).then((d) => {
      const jobs = (d as { jobs?: { title?: string }[] } | null)?.jobs;
      return Array.isArray(jobs) && jobs.length > 0 ? jobs.map((j) => j.title ?? "") : null;
    }),
    getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(name)}?mode=json`, 3000).then((d) =>
      Array.isArray(d) && d.length > 0 ? (d as { text?: string }[]).map((j) => j.text ?? "") : null
    ),
  ]);
  const results = await Promise.all(lookups);
  const titles = results.find((r) => r !== null) ?? null;
  cache.set(key, { at: Date.now(), titles });
  return titles;
}

export async function checkCareers(company: string, title: string): Promise<CareersCheck> {
  if (!company) return "unknown";
  const board = await findBoard(company);
  if (!board) return "unknown";
  return titleMatches(title, board) ? "listed" : "missing";
}
