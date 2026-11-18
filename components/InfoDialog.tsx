"use client";

import { useEffect, useRef, useState } from "react";

export type DialogKind = "how" | "privacy" | "access";

const TITLES: Record<DialogKind, string> = {
  how: "How Ghostless works",
  privacy: "Privacy",
  access: "Get early access",
};

export default function InfoDialog({ kind, onClose }: { kind: DialogKind | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState<DialogKind | null>(kind);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (kind) {
      setShown(kind);
      setSent(false);
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [kind]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      className="glass glass-dialog"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {shown && (
        <div className="p-6 desk:p-8">
          <div className="flex items-start justify-between gap-4">
            <h2 id="dialog-title" className="font-display text-[24px] font-semibold tracking-[-0.02em]">
              {TITLES[shown]}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 grid size-9 place-items-center rounded-full text-ink-2 hover:bg-white/5 hover:text-ink"
            >
              <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
                <path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {shown === "how" && (
            <ol className="mt-5 space-y-4 text-[15px] leading-relaxed text-ink-2">
              {[
                ["Search a title and a place.", "We pull matching jobs and check each one: how long it's been open, whether it's on the company's own careers page, whether a salary is listed, “talent pool” language, and how many times it's listed."],
                ["See it on the radar.", "Each job becomes a light. The closer it sits to you, the more likely it's real. Ghost jobs drift out to the dark edge."],
                ["Get referred, then follow up.", "For real jobs, we show who can refer you and remind you when it's time to follow up."],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-4">
                  <span className="mt-0.5 grid size-7 flex-none place-items-center rounded-full border border-real/40 font-mono text-[12px] text-real">
                    {i + 1}
                  </span>
                  <span>
                    <strong className="font-medium text-ink">{title}</strong> {body}
                  </span>
                </li>
              ))}
              <li className="pt-1 font-mono text-[11px] tracking-[0.08em] text-ink-3">SCORES ARE ESTIMATES FROM PUBLIC SIGNALS. UNTIL YOU SEARCH, THE RADAR SHOWS SAMPLE DATA.</li>
            </ol>
          )}

          {shown === "privacy" && (
            <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-ink-2">
              <p>When you search, your job title and place are sent to the Adzuna job search service to find matching jobs. Company names are checked against public Greenhouse and Lever job boards. If Ollama is running on your computer, a local AI model reads each posting; that text never leaves your machine. Your searches aren&rsquo;t saved.</p>
              <p>Until you search, the companies and jobs on the radar are made up.</p>
            </div>
          )}

          {shown === "access" && (
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                setSent(true);
              }}
            >
              <p className="text-[15px] leading-relaxed text-ink-2">Be first to know when referrals and follow-up tracking open.</p>
              <label htmlFor="dialog-input" className="mt-5 block font-mono text-[11px] tracking-[0.14em] text-ink-2">
                EMAIL
              </label>
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <input
                  id="dialog-input"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/40 px-5 py-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-edge/60 focus:outline-none"
                />
                <button type="submit" className="rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-void hover:bg-white">
                  Join
                </button>
              </div>
              <p role="status" className="mt-4 min-h-[1.5em] text-[13.5px] leading-snug text-ink-2">
                {sent && "Thanks! Early access sign-up isn't connected yet, so nothing was sent."}
              </p>
            </form>
          )}
        </div>
      )}
    </dialog>
  );
}
