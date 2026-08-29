# myWIPhealing — Impact Platform 🤍

A creative-wellness impact platform for **myWIPhealing**, **powered by Gym Brain**
(the AI dashboard & integration layer in this repo). Seni Scape, Harmoni Circle and
SHIPS are myWIPhealing programs that feed it.

Two halves:

1. **The survey** — "Seni", a DeepSeek-powered conversational AI that asks the compiled
   bilingual (EN/BM) impact survey in a chat (replacing Google Forms), stores each completed
   response, and auto-analyses it (sentiment, themes, wellbeing shift, follow-up flags).
2. **The dashboards** — four branded surfaces that turn those responses into proof:
   Community Health (public), Corporate Impact (per-client), Participant Journeys (internal),
   and the Admin Hub.

## Setup

1. Install dependencies: `npm install`
2. Set values in `.env`:
   - `DEEPSEEK_API_KEY` — DeepSeek API key (https://platform.deepseek.com)
   - `ADMIN_PASSWORD` — password for the admin-gated dashboards
   - *(optional, Community totals)* `STAT_PEOPLE_REACHED`, `STAT_HOURS_DELIVERED`,
     `STAT_COMMUNITIES`, `STAT_ORGANISATIONS`, `STAT_SINCE_YEAR` — org-confirmed totals.
     Left unset, the Community dashboard shows an honest "set in config" placeholder
     instead of inventing numbers.
3. Start: `npm start`

## URLs

| Page | Path | Access |
|------|------|--------|
| Survey (share with participants) | `/` | Public |
| Community Health dashboard | `/community.html` | Public (anonymised, shareable social proof) |
| Corporate Impact dashboard | `/corporate.html` | Admin password |
| Participant Journeys | `/participant.html` | Admin password (internal) |
| Admin Hub | `/admin.html` | Admin password |

## Brand & design

All pages share `public/brand.css`, which encodes the **myWIPhealing Color System v1.0**
(stonewashed `#F5EFE6` surfaces, near-black `#2C2C2A` text, banana-green `#C9EE21`/`#D5FC4C`
pill CTAs paired with near-black, coral `#E8794A`, myrtle `#174509` dark sections). Each
dashboard carries its assigned section accent: Community = rose, Corporate = blue,
Individual = mint (set via `body class="theme-*"`).

## How it works

- `POST /api/chat` — relays the conversation to DeepSeek with the compiled survey system
  prompt. On completion the model emits a hidden `<survey_complete>{json}</survey_complete>`
  block; the server extracts it, runs a second DeepSeek call to analyse the response, and
  saves both.
- `GET /api/public/community` — **no auth**. Anonymised, field-whitelisted aggregate that
  powers the Community dashboard. Returns only aggregates + admin-approved testimonials —
  never names, email, phone, or raw transcripts.
- `POST /api/admin/login` — exchanges the password for a stateless bearer token.
- `GET /api/admin/data` — stats + all responses (with AI analysis) + participant groupings.
- `GET /api/admin/corporate?program=&company=&from=&to=` — team-level before/after aggregates,
  filterable.
- `POST /api/admin/responses/:id/approve-quote` — consent gate: mark/unmark one open-text
  answer as a public testimonial (`{ field, author, approved }`).
- `POST /api/admin/insights` — on-demand DeepSeek report across the dataset.

Aggregation lives in `stats.js` (`communityStats`, `corporateStats`, `groupByParticipant`,
`computeStats`) — pure functions over the stored responses.

## Phased data model

The survey today is a **single-session** instrument, so dashboards show what it truly
collects and label the rest honestly:

- ✅ **Live now:** wellbeing index, self-worth pre→post shift, mind-state shift, AI
  sentiment/themes word cloud, booth-experience split, consent-gated testimonials,
  per-participant journeys, follow-up flags.
- 🔜 **Phase 2 (survey extension):** NPS, sleep / work-focus, engagement & attendance over
  time, and per-company corporate before/after. These need a stable participant identity,
  an employer field, and matched pre/post programme flows. Until then they render as
  clearly-labeled "Available after survey extension" placeholders — never fabricated.

## Privacy

- Community + Corporate views are **aggregate and anonymised**; Corporate is team-level only,
  never individual scores.
- Public testimonials require explicit **admin approval** (consent); the public endpoint
  whitelists safe fields only.
- Participant Journeys is **internal/admin-only**.
- Self-reported wellbeing — **not** clinical data (labeled in every footer).

## Storage & deployment

Locally, responses live in `data/responses.json` (git-ignored). On Vercel the filesystem is
ephemeral, so storage auto-switches to Redis — Upstash REST (`UPSTASH_REDIS_REST_URL/TOKEN`
or `KV_REST_API_URL/TOKEN`) or standard Redis over TCP (`REDIS_URL`). The app runs as a
Vercel serverless function via `api/index.js` + the `vercel.json` rewrite. One-time setup:
import the repo (Framework Preset **Other**), add `DEEPSEEK_API_KEY` + `ADMIN_PASSWORD`,
create a Redis store under **Storage** and connect it, then redeploy.

### Supabase backup mirror

Vercel's Supabase integration already sets `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and
those are used automatically - no extra variables needed. Run `supabase/schema.sql` in that
project first (Supabase dashboard -> SQL Editor); the mirror refuses to write to a database
that has no `responses` table, so a wrong or unmigrated project fails safe rather than
scattering participant answers into it.

To override the integration's values, set `SURVEY_SUPABASE_URL` / `SURVEY_SUPABASE_SERVICE_ROLE_KEY`
(these win). `SURVEY_SUPABASE_PROJECT_REF` optionally pins an expected project ref and refuses
anything else.

- **Writes** go to both stores. Either one failing is logged and tolerated; only losing *both*
  fails the request, so a mirror outage never costs a participant their answers.
- **Reads** come from the primary, and fall back to Supabase when the primary errors *or*
  comes back empty - which is what a recycled or unprovisioned Redis store looks like.
- With no Redis configured at all, Supabase simply becomes the primary store.
- Answers are stored in a single `data` jsonb column, so **changing the questionnaire needs no
  migration here**. Bump `SURVEY_SCHEMA_VERSION` when questions change; it is recorded per row
  so answers to reworded questions can be segmented rather than blindly averaged.
- `GET /api/admin/storage` (admin auth) reports which stores are live and how many responses
  each holds - check it before a session to catch a silently-empty backend.

Note that `SUPABASE_URL` is also set in some of this org's *other* environments, where it points
at an unrelated database. The table-existence preflight is what makes that safe: the mirror only
engages against a project that has already been migrated with `supabase/schema.sql`.
