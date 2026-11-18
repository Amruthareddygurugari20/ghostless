"use client";

import { AnimatePresence, animate, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { TONE_COLOR, VERDICT_COLOR, VERDICT_LABEL, verdictFor, type Job } from "@/lib/jobs";

const EASE = [0.22, 1, 0.36, 1] as const;

function ScoreRing({ score, color, reducedMotion }: { score: number; color: string; reducedMotion: boolean }) {
  const R = 31;
  const C = 2 * Math.PI * R;
  const [shown, setShown] = useState(reducedMotion ? score : 0);
  const prev = useRef(reducedMotion ? score : 0);

  useEffect(() => {
    if (reducedMotion) {
      prev.current = score;
      setShown(score);
      return;
    }
    const ctl = animate(prev.current, score, {
      duration: 0.9,
      ease: EASE,
      onUpdate: (v) => setShown(Math.round(v)),
    });
    prev.current = score;
    return () => ctl.stop();
  }, [score, reducedMotion]);

  return (
    <div className="relative size-[76px] flex-none" role="img" aria-label={`Realness score ${score} out of 100`}>
      <svg viewBox="0 0 76 76" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
        <motion.circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: reducedMotion ? C * (1 - score / 100) : C, stroke: color }}
          animate={{ strokeDashoffset: C * (1 - score / 100), stroke: color }}
          transition={{ duration: reducedMotion ? 0 : 0.9, ease: EASE }}
          style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <div aria-hidden="true" className="absolute inset-0 grid place-items-center font-display text-[24px] font-semibold tracking-[-0.03em]">
        {shown}
      </div>
    </div>
  );
}

interface JobCardProps {
  job: Job;
  index: number;
  total: number;
  live: boolean;
  onPrev: () => void;
  onNext: () => void;
  onSkip: () => void;
  reducedMotion: boolean;
}

export default function JobCard({ job, index, total, live, onPrev, onNext, onSkip, reducedMotion }: JobCardProps) {
  const verdict = verdictFor(job.score);
  const color = VERDICT_COLOR[verdict];
  const isGhost = verdict === "ghost";
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => setNote(null), [job.id]);

  const findReferrers = () => {
    setNote(
      job.referrers
        ? `${job.referrers} people at ${job.company} can refer you. The referral finder opens with early access.`
        : `The referral finder isn't live yet. It will look for people at ${job.company} who can refer you.`
    );
  };

  const slide = reducedMotion ? 0 : 8;

  return (
    <aside
      aria-label="Selected job"
      data-label-avoid
      className="glass relative z-20 mx-4 -mt-4 p-5 desk:fixed desk:right-[clamp(20px,2.4vw,36px)] desk:bottom-[clamp(20px,2.4vw,36px)] desk:mx-0 desk:mt-0 desk:w-[360px] desk:p-6"
    >
      <div className="flex items-center justify-between">
        {live ? (
          <span className="flex items-center gap-2 rounded-full border border-real/25 px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] text-real">
            <span className="size-1.5 rounded-full bg-real shadow-[0_0_8px_#2EF2B0]" aria-hidden="true" />
            LIVE
          </span>
        ) : (
          <span className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] tracking-[0.16em] text-ink-2">
            SAMPLE DATA
          </span>
        )}
        <div className="flex items-center gap-1">
          <span className="mr-1 font-mono text-[11px] text-ink-3" aria-hidden="true">
            {index + 1}/{total}
          </span>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous job"
            className="grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-white/5 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next job"
            className="grid size-8 place-items-center rounded-full text-ink-2 transition hover:bg-white/5 hover:text-ink"
          >
            <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
              <path d="m6 3 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={job.id}
          initial={{ opacity: 0, y: slide }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -slide }}
          transition={{ duration: reducedMotion ? 0 : 0.28, ease: EASE }}
        >
          <div className="mt-4 flex items-center gap-4" aria-live="polite">
            <ScoreRing score={job.score} color={color} reducedMotion={reducedMotion} />
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium tracking-[0.18em]" style={{ color, textShadow: `0 0 14px ${color}66` }}>
                {VERDICT_LABEL[verdict].toUpperCase()}
              </p>
              <h2 className="mt-1 line-clamp-2 break-words font-display text-[21px] font-semibold leading-tight tracking-[-0.02em]">{job.title}</h2>
              <p className="mt-0.5 truncate text-[14px] text-ink-2">
                {job.company} · {job.location}
              </p>
            </div>
          </div>

          <ul className="mt-5 space-y-2.5 border-t border-white/[0.07] pt-4" aria-label="Clues">
            {job.clues.map((clue, i) => (
              <li key={clue.text} className={`${i >= 2 ? "hidden desk:flex" : "flex"} items-center gap-3 text-[14px] text-ink`}>
                <span
                  aria-hidden="true"
                  className="size-[7px] flex-none rounded-full"
                  style={{ background: TONE_COLOR[clue.tone], boxShadow: `0 0 10px ${TONE_COLOR[clue.tone]}` }}
                />
                <span>
                  <span className="sr-only">{clue.tone === "good" ? "Good sign: " : clue.tone === "warn" ? "Warning: " : "Ghost sign: "}</span>
                  {clue.text}
                </span>
              </li>
            ))}
          </ul>

          {isGhost ? (
            <button
              type="button"
              onClick={onSkip}
              className="glass-pill mt-5 w-full rounded-full px-5 py-3 text-[14.5px] font-medium text-ink transition hover:border-white/25"
            >
              Skip and keep watching
            </button>
          ) : (
            <button
              type="button"
              onClick={findReferrers}
              className="mt-5 w-full rounded-full bg-ink px-5 py-3 text-[14.5px] font-medium text-void shadow-[0_8px_30px_-8px_rgba(46,242,176,0.55)] transition hover:bg-white"
            >
              Find who can refer me
            </button>
          )}
          <p role="status" className={`text-[12.5px] leading-snug text-ink-2 ${note ? "mt-3" : "sr-only"}`}>
            {note}
          </p>
          {job.url && (
            <div className="mt-3 flex items-center justify-between text-[12.5px]">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                View posting ↗<span className="sr-only"> (opens in a new tab)</span>
              </a>
              <a
                href="https://www.adzuna.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[10.5px] tracking-[0.06em] text-ink-3 hover:text-ink-2"
              >
                Jobs by Adzuna
              </a>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </aside>
  );
}
