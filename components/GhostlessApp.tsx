"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { jobs as SAMPLE_JOBS, verdictFor, type AiReview, type Job } from "@/lib/jobs";
import { applyAiReview } from "@/lib/score";
import Header from "./Header";
import Hero, { type SearchState } from "./Hero";
import InfoDialog, { type DialogKind } from "./InfoDialog";
import JobCard from "./JobCard";

const Radar3D = dynamic(() => import("./Radar3D"), { ssr: false, loading: () => null });

const COMPACT_QUERY = "(max-width: 859.98px)";

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

export default function GhostlessApp() {
  const [jobs, setJobs] = useState<Job[]>(SAMPLE_JOBS);
  const [live, setLive] = useState(false);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [aiNote, setAiNote] = useState<{ text: string; busy: boolean } | null>(null);
  const searchId = useRef(0);
  const [activeId, setActiveId] = useState(SAMPLE_JOBS[0].id);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [webgl, setWebgl] = useState<boolean | null>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const compact = useMediaQuery(COMPACT_QUERY);

  useEffect(() => setWebgl(hasWebGL()), []);

  const index = Math.max(0, jobs.findIndex((j) => j.id === activeId));
  const job = jobs[index];

  const step = useCallback(
    (dir: 1 | -1) => setActiveId(jobs[(index + dir + jobs.length) % jobs.length].id),
    [index, jobs]
  );
  const skip = useCallback(() => {
    // Jump to the next job that isn't a ghost.
    for (let k = 1; k <= jobs.length; k++) {
      const next = jobs[(index + k) % jobs.length];
      if (verdictFor(next.score) !== "ghost") return setActiveId(next.id);
    }
  }, [index, jobs]);

  // Second pass: a free local model (Ollama) reads each posting and nudges its score.
  const runAiReview = useCallback(async (found: Job[], id: number) => {
    let model = "";
    let done = 0;
    for (const job of found) {
      if (id !== searchId.current) return; // a newer search started
      setAiNote({ text: `Local AI reading postings… ${done}/${found.length}`, busy: true });
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jobs: [{ id: job.id, title: job.title, company: job.company, description: job.description ?? "" }],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (id !== searchId.current) return;
        if (!res.ok) {
          setAiNote({ text: data.message ?? "Local AI review is unavailable.", busy: false });
          return;
        }
        model = data.model ?? model;
        const r: AiReview | undefined = data.reviews?.[job.id];
        if (r) {
          setJobs((prev) => prev.map((j) => (j.id === job.id && !j.ai ? { ...j, ...applyAiReview(j.score, j.clues, r), ai: r } : j)));
        }
      } catch {
        if (id === searchId.current) setAiNote({ text: "Local AI review is unavailable.", busy: false });
        return;
      }
      done++;
    }
    if (id === searchId.current) setAiNote({ text: `AI reviewed ${done} postings with ${model}, on your computer.`, busy: false });
  }, []);

  const runSearch = useCallback(async (title: string, location: string) => {
    const id = ++searchId.current;
    setSearch({ status: "loading" });
    setAiNote(null);
    try {
      const qs = new URLSearchParams({ title, location });
      const res = await fetch(`/api/search?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (id !== searchId.current) return;
      if (!res.ok) {
        setSearch({ status: "error", message: data.message ?? "Search failed. Try again." });
        return;
      }
      const found: Job[] = data.jobs ?? [];
      const where = /\bremote\b/i.test(location) ? " (remote)" : location ? ` in ${location}` : "";
      if (found.length === 0) {
        setSearch({ status: "error", message: `No jobs found for “${title}”${where}. Try a broader title or a nearby city.` });
        return;
      }
      const ghosts = found.filter((j) => verdictFor(j.score) === "ghost").length;
      setJobs(found);
      setLive(true);
      setActiveId(found[0].id);
      setSearch({
        status: "done",
        message: `${found.length} jobs for “${title}”${where}. ${ghosts === 0 ? "No likely ghosts." : `${ghosts} look like ghosts.`}`,
        summary: `${found.length} RESULTS · ${title}${where}`.toUpperCase(),
      });
      if (window.matchMedia(COMPACT_QUERY).matches) {
        document.getElementById("radar")?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      }
      void runAiReview(found, id);
    } catch {
      if (id === searchId.current)
        setSearch({ status: "error", message: "Couldn't reach the search. Check your connection and try again." });
    }
  }, [reducedMotion, runAiReview]);

  return (
    <div className="relative min-h-dvh overflow-x-hidden desk:h-dvh desk:overflow-hidden">
      <div className="stars-bg" aria-hidden="true" />


      <div className="vignette z-[1]" aria-hidden="true" />

      <Header onOpen={setDialog} />

      <main>
        <Hero onOpen={setDialog} reducedMotion={reducedMotion} search={search} onSearch={runSearch} aiNote={aiNote} />
        <section
          id="radar"
          aria-label="Job radar"
          className="radar-wrap relative z-0 mt-2 h-[clamp(320px,96vw,480px)] w-full desk:fixed desk:inset-0 desk:mt-0 desk:h-auto"
        >
          <div
            role="img"
            aria-label="3D job radar with sample data. You sit at the glowing center. Each job is a light: real jobs glow green near the center with referral paths to you, uncertain jobs glow amber further out, and ghost jobs drift as violet ghosts in the ghost zone at the dark edge. Use the job card's previous and next buttons to browse jobs with a keyboard."
            className="absolute inset-0"
          >
            {webgl === false ? (
              <div className="grid h-full place-items-center px-6">
                <p className="glass max-w-sm p-6 text-center text-[15px] leading-relaxed text-ink-2 desk:ml-[38vw]">
                  Your browser can&rsquo;t show the 3D radar because WebGL isn&rsquo;t available. You can still browse the sample jobs
                  in the card.
                </p>
              </div>
            ) : webgl ? (
              <Radar3D jobs={jobs} activeId={activeId} onActivate={setActiveId} reducedMotion={reducedMotion} compact={compact} />
            ) : null}
          </div>
        </section>
        <JobCard
          job={job}
          index={index}
          total={jobs.length}
          live={live}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onSkip={skip}
          reducedMotion={reducedMotion}
        />
      </main>

      <p
        aria-hidden="true"
        className="pointer-events-none fixed bottom-[clamp(20px,2.4vw,36px)] left-[clamp(28px,4.4vw,72px)] z-20 hidden font-mono text-[11px] tracking-[0.2em] text-ink-3 desk:block [@media(max-height:700px)]:hidden"
      >
        DRAG TO ROTATE · HOVER A LIGHT
      </p>

      <footer className="relative z-20 px-5 pt-10 pb-10 desk:hidden">
        <nav aria-label="Footer" className="flex gap-5 text-[14px] text-ink-2">
          <button type="button" onClick={() => setDialog("how")} className="hover:text-ink">
            How it works
          </button>
          <button type="button" onClick={() => setDialog("privacy")} className="hover:text-ink">
            Privacy
          </button>
        </nav>
        <p className="mt-4 font-mono text-[10.5px] tracking-[0.08em] text-ink-3">
          {live ? "JOBS BY ADZUNA · SCORES ARE ESTIMATES" : "SAMPLE DATA · COMPANIES ARE MADE UP"}
        </p>
      </footer>

      <InfoDialog kind={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
