import { NextResponse, type NextRequest } from "next/server";
import { checkCareers } from "@/lib/careers";
import { angleFor, verdictFor, type Job } from "@/lib/jobs";
import { scoreJob, titleTokens, type CareersCheck } from "@/lib/score";

// GET /api/search?title=ML+Engineer&location=Cincinnati
// Searches Adzuna (https://developer.adzuna.com) on the server so the API key
// never reaches the browser, then scores every result for ghost-job signals.

interface AdzunaResult {
  id: string | number;
  title?: string;
  description?: string;
  created?: string;
  redirect_url?: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
  company?: { display_name?: string };
  location?: { display_name?: string };
}

const MAX_RESULTS = 18;

const stripHtml = (s = "") =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();

const error = (status: number, code: string, message: string) => NextResponse.json({ error: code, message }, { status });

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const title = (sp.get("title") ?? "").trim().slice(0, 80);
  const location = (sp.get("location") ?? "").trim().slice(0, 80);
  if (!title) return error(400, "missing_title", "Type a job title to search.");

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return error(
      503,
      "missing_key",
      "Job search isn't set up yet: add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env.local, then restart the dev server."
    );
  }

  const country = (process.env.ADZUNA_COUNTRY ?? "us").toLowerCase();
  const base = process.env.ADZUNA_API_BASE ?? "https://api.adzuna.com/v1/api";
  const remote = /\bremote\b/i.test(location);
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: "40",
    what: remote ? `${title} remote` : title,
    "content-type": "application/json",
  });
  if (location && !remote) params.set("where", location);

  let data: { results?: AdzunaResult[]; count?: number };
  try {
    const res = await fetch(`${base}/jobs/${country}/search/1?${params}`, {
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      return error(502, "bad_key", "Adzuna rejected the API key. Check ADZUNA_APP_ID and ADZUNA_APP_KEY in .env.local.");
    }
    if (!res.ok) return error(502, "upstream", `The job search service returned an error (${res.status}). Try again in a moment.`);
    data = await res.json();
  } catch {
    return error(504, "timeout", "The job search service didn't answer in time. Try again.");
  }

  // Normalise, then fold duplicates (same company + same title) into one entry.
  const groups = new Map<string, { r: AdzunaResult; count: number }>();
  for (const r of data.results ?? []) {
    const company = stripHtml(r.company?.display_name) || "Unknown company";
    const key = `${company.toLowerCase()}|${titleTokens(stripHtml(r.title)).join(" ")}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      // keep the oldest posting date: a repost resets the date but not the role's age
      if ((r.created ?? "") < (g.r.created ?? "")) g.r = { ...g.r, created: r.created };
    } else groups.set(key, { r, count: 1 });
  }
  const unique = [...groups.values()].slice(0, MAX_RESULTS);

  // Careers-page check per posting, capped so one slow board can't stall the search.
  const careers = new Map<string, CareersCheck>();
  const careersKey = (r: AdzunaResult) => `${stripHtml(r.company?.display_name)}|${stripHtml(r.title)}`;
  await Promise.race([
    Promise.all(
      unique.map(async ({ r }) => {
        careers.set(careersKey(r), await checkCareers(stripHtml(r.company?.display_name), stripHtml(r.title)));
      })
    ),
    new Promise((resolve) => setTimeout(resolve, 4500)),
  ]);

  const jobs: Job[] = unique
    .map(({ r, count }) => {
      const company = stripHtml(r.company?.display_name) || "Unknown company";
      const jobTitle = stripHtml(r.title) || title;
      const predicted = String(r.salary_is_predicted ?? "0") === "1";
      const { score, clues } = scoreJob({
        title: jobTitle,
        created: r.created ?? "",
        description: stripHtml(r.description),
        salaryListed: !predicted && Boolean(r.salary_min || r.salary_max),
        careers: careers.get(careersKey(r)) ?? "unknown",
        duplicates: count,
      });
      return {
        id: `adz-${r.id}`,
        title: jobTitle,
        company,
        location: stripHtml(r.location?.display_name) || (remote ? "Remote" : location || "—"),
        score,
        angle: 0,
        clues,
        url: r.redirect_url,
        description: stripHtml(r.description).slice(0, 600),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((j, i) => ({ ...j, angle: angleFor(i) }));

  // Float labels on the best match, one "maybe" and the most ghostly.
  const pick = [jobs[0], jobs.find((j) => verdictFor(j.score) === "maybe"), jobs[jobs.length - 1]];
  for (const j of pick) if (j) j.label = true;

  return NextResponse.json({
    jobs,
    total: data.count ?? jobs.length,
    query: { title, location },
    source: "adzuna",
  });
}
