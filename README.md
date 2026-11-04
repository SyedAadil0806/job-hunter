# Job Hunter

A personal job search assistant. Every morning it:

1. **Finds jobs** from Remotive, Remote OK, Arbeitnow, Jooble, Adzuna and Google Jobs (which includes LinkedIn, Bayt and GulfTalent listings).
2. **Filters** them with cheap rules (role, seniority, location, age), so you only pay AI costs on jobs that could fit.
3. **Scores** each job 0–100 against your CV with AI (Gemini for free, or Claude), and lists matching and missing skills.
4. **Tailors** your CV and writes a cover letter for the best matches, then makes an ATS-friendly PDF.
5. **Tracks** every job you apply to, with status (applied, interview, offer, rejected, …) and notes.

You still click "submit" on each job yourself. That keeps your accounts safe and your applications high quality.

```
GitHub Actions (daily, free) ──► job sites / Google Jobs
          │                              │
          ▼                              ▼
     Neon Postgres (free) ◄── NestJS pipeline + Gemini / Claude
          ▲
          │
 Render (free) NestJS API ◄── Vercel (free) React dashboard
```

**Stack:** NestJS 11, Prisma 6, PostgreSQL, Gemini API / Claude API (schema-enforced JSON output), PDFKit, React 19 + Vite, GitHub Actions.

## How the "no fake facts" rule works

The AI is only allowed to reword and reorder. The code then checks what comes back (`apps/api/src/cv/tailor.merge.ts`):

- Skills: only skills already in your CV are kept; anything new is dropped.
- Bullets: if a reworded bullet has a number that was not in your original bullet, the original is used instead.
- Bullet counts per job and project stay the same as your CV.

## AI: free or paid

Set `AI_PROVIDER` to choose. Scoring uses a fast model, tailoring a stronger one.

| | Gemini (`AI_PROVIDER=gemini`) | Claude (`AI_PROVIDER=claude`) |
|---|---|---|
| Cost | Free tier | A few dollars a month at default limits |
| Default models | `gemini-flash-lite-latest`, `gemini-flash-latest` | `claude-haiku-5-5`, `claude-sonnet-5-5` |
| Privacy | On the free tier Google may use your prompts (your CV) to improve its products, and people may review them | Not used for training |
| Limits | Per-minute and per-day caps; the pipeline spaces calls out and stops cleanly when the daily cap is hit, then continues tomorrow | Pay as you go |

`npm run ai:check` tests your key, lists the Gemini models you can use and checks the database. Override models with `GEMINI_SCORE_MODEL` / `GEMINI_TAILOR_MODEL` (or the `CLAUDE_…` ones).

Everything else (Neon, GitHub Actions, Render, Vercel) is on free plans. Change daily limits in `cv/search-config.json` → `limits`.

## Setup (about 30 minutes, once)

### 1. Your CV and search settings

```bash
cp cv/base-cv.example.json cv/base-cv.json   # then fill in your real CV
npm install
npm run cv:secret                            # prints your CV as one line
```

`cv/base-cv.json` is in `.gitignore`, so your CV never goes into the repo. Edit `cv/search-config.json` to change search words, excluded titles and locations.

### 2. Free accounts and keys

| What | Where | Needed? |
|---|---|---|
| Postgres database | [neon.tech](https://neon.tech) → new project → copy connection string | Yes |
| Gemini API key (free) | [aistudio.google.com](https://aistudio.google.com) → Get API key | Yes (or Claude) |
| Claude API key (paid) | [console.anthropic.com](https://console.anthropic.com) | Only if you choose Claude |
| Google Jobs | [serpapi.com](https://serpapi.com) (free plan, limited searches) | Recommended for UAE |
| Jooble | [jooble.org/api/about](https://jooble.org/api/about) | Recommended for UAE |
| Adzuna | [developer.adzuna.com](https://developer.adzuna.com) | Optional (no UAE, remote only) |

Remotive, Remote OK and Arbeitnow need no key.

### 3. GitHub (runs every morning)

Push this repo to GitHub. A **private** repo is fine and has plenty of free Actions minutes for this.

Go to **Settings → Secrets and variables → Actions** and add these secrets:

- `DATABASE_URL`, `GEMINI_API_KEY`, `BASE_CV_JSON` (required)
- `ANTHROPIC_API_KEY` (only for Claude; also add a **variable** `AI_PROVIDER` = `claude` under the Variables tab)
- `SERPAPI_KEY`, `JOOBLE_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` (optional)

Then open **Actions → Daily job hunt → Run workflow** to try it now. After a run, its page shows a summary with the jobs that are ready.

### 4. API on Render (free)

Render → **New → Blueprint** → pick the repo (it reads `render.yaml`). Fill in `DATABASE_URL`, `GEMINI_API_KEY`, `BASE_CV_JSON` and `WEB_ORIGIN` (your Vercel URL from step 5). Render creates `DASHBOARD_TOKEN` for you; copy it from the service's Environment tab.

Free Render services sleep when idle, so the first request after a while takes about 30 seconds.

### 5. Dashboard on Vercel (free)

Vercel → **Add New Project** → pick the repo → set **Root Directory** to `apps/web` → add env var `VITE_API_URL` = your Render URL → Deploy. Open the site and paste your `DASHBOARD_TOKEN`.

### 6. Telegram message and phone app (optional)

Create a bot with [@BotFather](https://t.me/BotFather), put its token in `apps/api/.env` as `TELEGRAM_BOT_TOKEN`, send the bot "hi", then run `npm run telegram:setup` to get your chat id. Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as GitHub secrets and `DASHBOARD_URL` as a GitHub variable. You get a message when new CVs are ready or something goes wrong, and nothing on quiet days.

To install the dashboard on Android, open it in Chrome, tap the ⋮ menu, then **Add to Home screen** or **Install app**.

## Daily use

1. Open the dashboard → **Ready to apply**.
2. For each job: **Download CV**, open **Cover letter** and copy it, then open the job link and apply.
3. Click **I applied ✓**. The job moves to **Applied**, where you update its status later.
4. **All matches** shows every scored job. **Make CV** tailors one on demand.

## Run locally

```bash
cp apps/api/.env.example apps/api/.env   # fill in DATABASE_URL, GEMINI_API_KEY, DASHBOARD_TOKEN
npm run ai:check                # checks AI key + database
npm run db:push                 # create tables
npm run pipeline                # one full run
npm run dev:api                 # API on :3000
npm run dev:web                 # dashboard on :5173
npm test                        # unit tests
```

Run only some steps: `npm run pipeline -w apps/api -- --only=collect` (or `collect,score`).

## Adding a job site

Make a class that implements `JobSource` in `apps/api/src/sources/`, then add it to `allSources()` in `sources/index.ts`.

## Rules for the job sites

- **Remotive** allows about 4 fetches a day and asks you to link back, so the pipeline fetches it once per run and the dashboard links every job to its source.
- **LinkedIn** is not scraped (that breaks their rules and can get your account banned). LinkedIn jobs come in through Google Jobs instead.
- Respect each site's terms if you change how often the pipeline runs.

## Project layout

```
apps/api      NestJS API + daily pipeline
  src/sources   one file per job site
  src/jobs      filter rules, collector, REST endpoints
  src/ai        Claude scoring + tailoring
  src/cv        CV schema, safe merge, PDF renderer
  prisma        database schema
apps/web      React dashboard
cv/           your CV (git-ignored) + search settings
.github       daily run + CI
```
