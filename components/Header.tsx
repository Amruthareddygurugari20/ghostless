import type { DialogKind } from "./InfoDialog";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="#4FD8FF" strokeOpacity=".35" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="9.5" fill="none" stroke="#2EF2B0" strokeOpacity=".45" strokeWidth="1.2" />
      <circle cx="16" cy="16" r="5" fill="none" stroke="#2EF2B0" strokeOpacity=".7" strokeWidth="1.2" />
      <path d="M16 16 L16 2 A14 14 0 0 1 27.5 8 Z" fill="#2EF2B0" fillOpacity=".12" />
      <circle cx="16" cy="16" r="2.4" fill="#2EF2B0" style={{ filter: "drop-shadow(0 0 4px #2EF2B0)" }} />
    </svg>
  );
}

export default function Header({ onOpen }: { onOpen: (kind: DialogKind) => void }) {
  return (
    <header className="absolute inset-x-0 top-0 z-30" data-label-avoid>
      <div className="mx-auto flex h-[72px] items-center justify-between px-5 desk:h-[84px] desk:px-[clamp(28px,4.4vw,72px)]">
        <a href="/" className="flex items-center gap-2.5 rounded-full" aria-label="Ghostless home">
          <Logo className="size-7" />
          <span className="font-display text-[19px] font-semibold tracking-[-0.02em]">Ghostless</span>
        </a>

        <nav aria-label="Main" className="flex items-center gap-1 desk:gap-2">
          <button
            type="button"
            onClick={() => onOpen("how")}
            className="hidden rounded-full px-4 py-2 text-[14px] text-ink-2 transition-colors hover:text-ink desk:inline-flex"
          >
            How it works
          </button>
          <button
            type="button"
            onClick={() => onOpen("privacy")}
            className="hidden rounded-full px-4 py-2 text-[14px] text-ink-2 transition-colors hover:text-ink desk:inline-flex"
          >
            Privacy
          </button>
          <button
            type="button"
            onClick={() => onOpen("access")}
            className="ml-2 rounded-full bg-ink px-4 py-2.5 text-[13.5px] font-medium text-void shadow-[0_0_28px_-2px_rgba(46,242,176,0.45),0_0_0_1px_rgba(46,242,176,0.25)] transition hover:shadow-[0_0_38px_0_rgba(46,242,176,0.6),0_0_0_1px_rgba(46,242,176,0.4)] desk:px-5"
          >
            Get early access
          </button>
        </nav>
      </div>
    </header>
  );
}
