"use client";

import { motion } from "framer-motion";
import { useState, type FormEvent } from "react";
import type { DialogKind } from "./InfoDialog";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; message: string; summary: string };

interface HeroProps {
  onOpen: (kind: DialogKind) => void;
  reducedMotion: boolean;
  search: SearchState;
  onSearch: (title: string, location: string) => void;
  aiNote: { text: string; busy: boolean } | null;
}

export default function Hero({ onOpen, reducedMotion, search, onSearch, aiNote }: HeroProps) {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const loading = search.status === "loading";
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (title.trim() && !loading) onSearch(title.trim(), location.trim());
  };
  const eyebrow =
    search.status === "loading" ? "SCANNING JOBS…" : search.status === "done" ? search.summary : "LIVE JOB RADAR · SAMPLE DATA";
  const item = {
    hidden: { opacity: 0, y: reducedMotion ? 0 : 16 },
    show: { opacity: 1, y: 0 },
  };
  return (
    <motion.section
      aria-labelledby="hero-title"
      data-label-avoid
      className="pointer-events-none relative z-20 px-5 pt-[104px] desk:absolute desk:left-[clamp(28px,4.4vw,72px)] desk:top-1/2 desk:w-[min(600px,44vw)] desk:-translate-y-1/2 desk:px-0 desk:pt-0"
      initial="hidden"
      animate="show"
      transition={{ staggerChildren: reducedMotion ? 0 : 0.08, delayChildren: reducedMotion ? 0 : 0.35 }}
    >
      <motion.p
        variants={item}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.18em] text-ink-2"
      >
        <span className="pulse-dot" aria-hidden="true" />
        <span className="truncate">{eyebrow}</span>
      </motion.p>

      <motion.h1
        id="hero-title"
        variants={item}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mt-5 font-display text-[clamp(44px,12.4vw,64px)] font-semibold leading-[0.95] tracking-[-0.045em] desk:mt-6 desk:text-[min(6.1vw,10.4vh,92px)]"
      >
        Stop applying to <span className="ghost-word">ghosts.</span>
      </motion.h1>

      <motion.p
        variants={item}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="mt-5 max-w-[30rem] text-[16px] leading-[1.6] text-ink-2 desk:mt-6 desk:text-[clamp(16px,1.25vw,18px)]"
      >
        Every job becomes a light. The closer it glows to you, the more likely it&rsquo;s real. Ghost jobs drift at the dark
        edge.
      </motion.p>

      <motion.form
        variants={item}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        role="search"
        aria-label="Search jobs"
        onSubmit={submit}
        className="pointer-events-auto mt-7 desk:mt-8"
      >
        <div className="glass-pill flex flex-col rounded-[22px] p-1.5 transition-colors focus-within:border-edge/55 focus-within:shadow-[0_0_0_3px_rgba(79,216,255,0.15)] sm:flex-row sm:items-center sm:rounded-full">
          <label htmlFor="search-title" className="sr-only">
            Job title
          </label>
          <input
            id="search-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={80}
            autoComplete="off"
            placeholder="Job title, e.g. ML Engineer"
            className="min-w-0 flex-[1.35] bg-transparent px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <span aria-hidden="true" className="mx-4 h-px bg-white/10 sm:mx-0 sm:h-6 sm:w-px" />
          <label htmlFor="search-location" className="sr-only">
            City or Remote
          </label>
          <input
            id="search-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={80}
            autoComplete="off"
            placeholder="City or Remote"
            className="min-w-0 flex-1 bg-transparent px-4 py-3 text-[15px] text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex items-center justify-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-void shadow-[0_10px_40px_-10px_rgba(46,242,176,0.55)] transition hover:bg-white disabled:opacity-70 sm:mt-0"
          >
            {loading && <span aria-hidden="true" className="size-3.5 animate-spin rounded-full border-2 border-void/30 border-t-void" />}
            {loading ? "Scanning" : "Find jobs"}
          </button>
        </div>
        <p
          role="status"
          className={`mt-3 min-h-[20px] text-[13.5px] leading-snug ${search.status === "error" ? "text-maybe" : "text-ink-2"}`}
        >
          {search.status === "error" || search.status === "done" ? search.message : ""}
        </p>
        {aiNote && (
          <p role="status" className="mt-1 flex items-center gap-2 font-mono text-[11px] tracking-[0.04em] text-ink-3">
            <span
              aria-hidden="true"
              className={`size-1.5 flex-none rounded-full bg-edge shadow-[0_0_8px_#4FD8FF] ${aiNote.busy ? "animate-pulse" : ""}`}
            />
            {aiNote.text}
          </p>
        )}
        <button
          type="button"
          onClick={() => onOpen("how")}
          className="mt-1 text-[14px] text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline"
        >
          See how it works →
        </button>
      </motion.form>

      <motion.div variants={item} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="mt-8 desk:mt-9">
        <dl className="grid max-w-[30rem] grid-cols-2 gap-6">
          <div>
            <dt className="sr-only">55 percent</dt>
            <dd className="font-display text-[30px] font-semibold tracking-[-0.03em] text-ink desk:text-[34px]">55%</dd>
            <dd className="mt-1 text-[13.5px] leading-snug text-ink-2">say getting ghosted is their top frustration</dd>
          </div>
          <div>
            <dt className="sr-only">67 percent</dt>
            <dd className="font-display text-[30px] font-semibold tracking-[-0.03em] text-ink desk:text-[34px]">67%</dd>
            <dd className="mt-1 text-[13.5px] leading-snug text-ink-2">have run into ghost jobs</dd>
          </div>
        </dl>
        <p className="mt-4 font-mono text-[10.5px] tracking-[0.06em] text-ink-3">
          Source: Resume Genius 2026 Job Seeker Insights Report
        </p>
      </motion.div>
    </motion.section>
  );
}
