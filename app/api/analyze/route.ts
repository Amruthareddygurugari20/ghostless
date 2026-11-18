import { NextResponse, type NextRequest } from "next/server";
import { OllamaError, reviewJobs, type ReviewInput } from "@/lib/ollama";

// POST /api/analyze  { jobs: [{ id, title, company, description }] }
// Second pass after a search: a local Ollama model reads each posting.

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(req: NextRequest) {
  let body: { jobs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Expected JSON." }, { status: 400 });
  }
  const jobs: ReviewInput[] = (Array.isArray(body.jobs) ? body.jobs : [])
    .slice(0, 25)
    .map((j: Record<string, unknown>) => ({
      id: str(j?.id, 80),
      title: str(j?.title, 160),
      company: str(j?.company, 120),
      description: str(j?.description, 800),
    }))
    .filter((j) => j.id && j.title);
  if (jobs.length === 0) return NextResponse.json({ error: "bad_request", message: "No jobs to review." }, { status: 400 });

  try {
    return NextResponse.json(await reviewJobs(jobs));
  } catch (e) {
    if (e instanceof OllamaError) return NextResponse.json({ error: e.code, message: e.message }, { status: 503 });
    return NextResponse.json({ error: "failed", message: "Local AI review failed." }, { status: 500 });
  }
}
