# Ghostless

Stop applying to ghosts. Search a job title and a place; every result becomes a light on a 3D radar.
The closer it glows to you, the more likely the job is real. Ghost jobs drift at the dark edge.

Everything here is free: Adzuna's developer tier for job search, public Greenhouse/Lever boards for the
careers-page check, and an optional local AI model through Ollama.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then paste your Adzuna keys into .env.local
npm run dev                        # http://localhost:3000
```

1. **Adzuna keys (free):** sign up at https://developer.adzuna.com, open the dashboard and copy the
   Application ID and Application Key into `.env.local`.
2. **Local AI (optional, free):** install Ollama (https://ollama.com), pull a model, and keep it running:
   `ollama pull qwen3:8b`. Ghostless picks the first installed chat model automatically,
   or set `OLLAMA_MODEL`. If Ollama isn't running, search still works without the AI review.

Until you search, the radar shows made-up sample data.

## How a job is scored (`lib/score.ts`)

Starts at 70, then:

| Signal | Effect |
| --- | --- |
| Posting age | +20 (≤7 days) … −42 (90+ days) |
| On the company's Greenhouse/Lever careers board | +12, or −18 if the board exists but the job isn't on it |
| "Talent pool" / "future opportunities" wording | −25 |
| Salary listed by the employer (not Adzuna's estimate) | +8, otherwise −4 |
| Same company + title listed several times in one search | −4 to −10 |
| Local AI read of the text: specific / vague / ghost | +11 / −3 / −13 |

75+ = likely real, 35–74 = maybe, under 35 = likely ghost. Scores are estimates from public signals.

The AI reviews one posting at a time (small models are more accurate that way), so results appear
first and the orbs glide to their new spots as each review finishes (about 4 s per posting with an
8B model). It must quote the posting; a quote that isn't really in the text is dropped.

Not yet included: repost history (needs saving results over days) and layoff (WARN) notices.

## Where things live

- `app/api/search/route.ts` – Adzuna search, duplicate folding, careers check, scoring
- `app/api/analyze/route.ts`, `lib/ollama.ts` – local AI review
- `lib/score.ts` – scoring rules · `lib/careers.ts` – Greenhouse/Lever lookup · `lib/jobs.ts` – types + sample data
- `components/Radar3D.tsx` – the 3D scene · `components/GhostlessApp.tsx` – page state
- `components/Hero.tsx` (search form), `JobCard.tsx`, `Header.tsx`, `InfoDialog.tsx`

Layout breakpoint is 860px (`desk:` in Tailwind). Desktop radar framing in `CameraRig` mirrors the hero
width and card height; update it if you change those.

If you deploy this, Ollama must be reachable from the server (`OLLAMA_URL`); on a typical host it won't be,
and the app simply skips the AI review.
