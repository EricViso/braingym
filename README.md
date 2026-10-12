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

Plus **WIP Harmoni Circle** — a members-only event hub (`/circle/`) where
memberSHIPS members propose their own peer-led circles (theme, venue, date, itemised
costs, projected revenue) under a fixed facilitator/WIP profit split, and RSVP to approved
ones. Each member has their own login (email + password, or Google, via Supabase Auth) and a
**My Circles** page showing how many Circles they've joined, proposed and hosted. Proposals
land in an admin review queue (`/admin-harmoni.html`) and only appear on the hub once
approved.

## Setup

1. Install dependencies: `npm install`
2. Set values in `.env`:
   - `DEEPSEEK_API_KEY` — DeepSeek API key (https://platform.deepseek.com)
   - `ADMIN_PASSWORD` — password for the admin-gated dashboards
   - `MEMBER_INVITE_CODE` — invite code a new account enters once to join the Harmoni Circle
     hub (`MEMBER_PASSWORD` still works as the old name). See "Member logins" below.
   - `SUPABASE_ANON_KEY` — needed for member logins (plus the Supabase URL/service key below)
   - *(optional, Harmoni Circle)* `HARMONI_FACILITATOR_SHARE` — facilitator's fixed share of
     projected profit, percent 0–100 (default 60; WIP's share covers the program system,
     SHIPS peer framework and art-therapy psychology education module)
   - *(Harmoni Circle emails)* `RESEND_API_KEY` — Resend API key for member emails. Unset, no
     email is sent (each one is logged and skipped); nothing else changes. The sending domain
     (`mywiphealing.com`) must be verified in Resend.
   - *(optional)* `NOTIFY_FROM` — sender, default `WIP Healing <hello@mywiphealing.com>`
   - *(optional)* `SITE_URL` — base for links in emails, default `https://www.mywiphealing.com`
     (emails link to `$SITE_URL/circle/`)
   - *(optional)* `SURVEY_LINK_SECRET` — signs "Share how it went" survey links. Defaults to a
     key derived from the Supabase service key; set it to rotate links independently.
   - `CRON_SECRET` — secret Vercel Cron sends as `Authorization: Bearer …` to the daily
     reminder job. Unset, `/api/cron/reminders` refuses to run. See "Member emails" below.
   - *(optional, Community totals)* `STAT_PEOPLE_REACHED`, `STAT_HOURS_DELIVERED`,
     `STAT_COMMUNITIES`, `STAT_ORGANISATIONS`, `STAT_SINCE_YEAR` — org-confirmed totals.
     Left unset, the Community dashboard shows an honest "set in config" placeholder
     instead of inventing numbers.
3. Start: `npm start`

## URLs

| Page | Path | Access |
|------|------|--------|
| myWIPhealing website (static copy of the WordPress site) | `/`, `/about-us/`, `/corporate/`, … | Public |
| Survey (share with participants) | `/bot` | Public |
| Community Health dashboard | `/community.html` | Public (anonymised, shareable social proof) |
| Corporate Impact dashboard | `/corporate.html` | Admin password |
| Participant Journeys | `/participant.html` | Admin password (internal) |
| Admin Hub | `/admin.html` | Admin password |
| WIP Harmoni Circle hub | `/circle/` (`#propose`, `#me` deep-link) | Member account (Supabase Auth) + one-time invite code |
| Harmoni Circles admin | `/admin-harmoni.html` | Admin password |

## The website (WordPress snapshot)

The public site that used to run on WordPress (Hostinger) is served from this repo as static
files: every page keeps its original path (`public/<slug>/index.html`), with its theme, plugin
and upload assets under `public/wp-content/` and `public/wp-includes/`. To pull in content
edited in WordPress, run `node scripts/mirror-wordpress.js` (optionally pass an origin URL if
WordPress moves off the main domain) and commit the result. It only writes WordPress paths, so
the survey and dashboards are never overwritten.

WordPress knows nothing about this repo's own pages, so `scripts/site-additions.js` (run
automatically at the end of a mirror) adds them to every mirrored page: "Our Impact"
(`/community.html`) and "Impact Survey" (`/bot/`) in the header menu and footer, footer links to
the privacy policy, SHIPS terms and team login, and the homepage sections in
`scripts/home-sections.html`. The Art of Healing '26 festival details on
`/the-art-of-healing-2026/` (schedule, activities, panel, partners) live in
`scripts/art-of-healing-2026.html` and replace WordPress's Canva embed on that page; photos are in
`public/img/art-of-healing-2026/`. Edit those there, then run `node scripts/site-additions.js`; never
edit the mirrored HTML by hand, as the next mirror overwrites it. The survey and community
pages link back to the site through the bar at their top (`public/sitebar.css`).

## Brand & design

All pages share `public/brand.css`, which encodes the **myWIPhealing Color System v1.0**
(stonewashed `#F5EFE6` surfaces, near-black `#2C2C2A` text, banana-green `#C9EE21`/`#D5FC4C`
pill CTAs paired with near-black, coral `#E8794A`, myrtle `#174509` dark sections). Each
dashboard carries its assigned section accent: Community = rose, Corporate = blue,
Individual = mint, Harmoni Circles admin = crimson (set via `body class="theme-*"`).

The member-facing pages (the survey at `/` and the Harmoni Circle hub) instead use the
mywiphealing.com website look: page-local tokens (`#1d1d1f` ink, forest/leaf greens, site
coral `#ef6442`, pastel pinks/mints/lavenders), Bricolage Grotesque headings, ink-outlined
cards with offset shadows, and the hand-drawn doodle stickers.

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

Harmoni Circle:

"Member auth" = a Supabase Auth access token (`Authorization: Bearer …`) whose user has
joined with the invite code. The server verifies tokens against Supabase (`/auth/v1/user`,
cached 60s).

- `GET /api/member/config` — public. Whether logins are on, the Supabase URL and anon key the
  page needs to sign in, and `google`: whether Google sign-in is switched on in Supabase (read
  from `/auth/v1/settings`, cached 5 min). "Continue with Google" only shows when it is, so
  turning Google on in the dashboard is all it takes to bring the button back.
- `POST /api/member/join` — signed-in user. `{ inviteCode, name }` turns the account into a
  member. Wrong codes are throttled (8 tries / 15 min per account).
- `GET /api/member/me` — member auth. Profile plus activity: `counts` (`joined`, `attended`,
  `upcoming`, `proposed`, `hosted`) and the `joined` / `proposals` lists behind them.
  Joined = RSVP'd going with a seat (not waitlisted) on a live or completed Circle; hosted =
  their own proposal that went live and has taken place.
- `POST /api/member/me` — member auth. Profile: any of `{ name, roles, state, city, photo, notify }`.
  `notify` is `{ rsvp, listing, newEvents, reminders, surveys }`, booleans only (any subset); all default
  to on and come back in the profile as `member.notify`.
  `roles` ⊂ fighter / caregiver / practitioner / leader / public (Mental health fighter, Caregiver,
  Practitioner, Community leader / volunteer, General public);
  `state` is a Malaysian state/FT or "Outside Malaysia"; `photo` is a JPG/PNG/WebP data URL
  (the page square-crops it to 400px) or `null` to remove. Name + a role + a state make the
  profile complete; the page asks new members to fill it in right after joining (skippable).
  Other members only ever see name and photo; role and location are for the member and admins.
- `GET /api/harmoni/photos/:key` — **no auth**. A profile photo, by a random key that changes
  with every upload (never the member id).
- `GET /api/harmoni/events` — member auth. Approved events only, as an **attendee view**: when,
  where, price, what you'll do, what you'll leave with, what to bring (Participant-provided
  items), accessibility notes, host first name, RSVP counts, the payment link, and a per-viewer
  `mine` block (hosting? RSVP? payment status?). The host's facilitation plan (flow,
  instructions, prompts, intention, costs, attachments, notes) and contact details are never
  sent to members.
- `GET /api/harmoni/events/:id/cover` — **no auth** (image tags can't send a token). The event's
  cover picture for live events only: the host's cover upload, else their first image
  attachment. Served with the allow-listed image type, never sniffed.
- `POST /api/harmoni/draft` — member auth. `{ field, answers }` → a DeepSeek-written draft for
  one proposal question ("✨ Write a draft for me"), built on what the member has written so far.
  `{ text }`, or `{ lines }` for list questions. 40 per member per hour.
- `POST /api/harmoni/events` — member auth. Submits a Circle proposal. The server validates
  every field (future date, capacity 1–200, itemised costs, safeguarding acknowledgment,
  up to 3 image/PDF attachments ≤ ~1MB each) and computes the financial snapshot itself —
  projected revenue, cost, profit, and the fixed facilitator/WIP split. Status starts at
  `under_review`.
  The proposer's account is recorded as `data.createdBy` and gets a "Submitted, in review" email. Optional `coverImage` (PNG/JPG/WebP/GIF
  data URL, ≤ ~1MB; the form shrinks photos first) becomes the event cover once approved.
- `GET /api/harmoni/events/:id/edit` / `PUT /api/harmoni/events/:id` — member auth, proposer
  only (`data.createdBy.id`), and only while the proposal is `needs_revision`. `GET` returns the
  stored answers plus the admin's note and `revision` (below); `PUT` takes the same body as a new
  proposal, validates it the same way, keeps RSVPs/comments/payment link, records what the host
  changed in `revision.hostChanges`, and puts it back to `under_review`. The page's "Review
  changes & resubmit" button in My Circles uses these, and the form shows each WIP edit and
  flagged field on its question.
- `POST /api/harmoni/events/:id/rsvp` — member auth. `{ status: going|maybe, pax }`; the name
  comes from the account. One RSVP per member (a new one replaces it); `going` is capped at
  capacity with overflow flagged waitlisted. `DELETE` withdraws it. On a paid Circle, `going`
  needs the admin's payment link to exist; the seat is held as `paymentStatus: "pending"` and
  the response carries `paymentUrl` for the page to open. There is no payment-provider webhook:
  an admin marks it paid.
- `POST /api/harmoni/events/:id/comments` — member auth, `{ text }` ≤ 280 chars.
- `GET /api/admin/harmoni/members` — admin auth. Every member with their activity counts.
- `POST /api/admin/harmoni/events/:id/payment` — admin auth. `{ paymentUrl }` (https, any
  provider; empty clears it).
- `POST /api/admin/harmoni/events/:id/rsvp` — admin auth. `{ key, action: paid|unpaid|remove }`,
  where `key` is the RSVP's member id (or `name:<name>` for pre-account RSVPs).
- `GET /api/admin/harmoni/events` / `POST /api/admin/harmoni/events/:id/status` — admin auth.
  Review queue: list everything, then approve / request changes / reject / complete / cancel.
  Statuses: `under_review`, `needs_revision` ("To revise": the admin's note says what to change
  and the host can edit and resubmit), `approved`, `rejected`, `completed`, `cancelled`.
- `POST /api/admin/harmoni/events/:id/request-changes` — admin auth, for proposals in
  `under_review` or `needs_revision`. `{ note, edits: { field: value }, flags: { field: "what to
  change" } }`. Edits are applied to the proposal straight away (re-validated like the host's own
  form) and the host accepts them by resubmitting; flags ask the host to rework a field
  themselves. Stored as `data.revision` `{ requestedAt, note, changes: [{ field, label, from, to }],
  flags: [{ field, label, note }] }` and listed in the "To revise" email. The admin page's
  "Request changes…" button opens this as an editable form.
- `GET /api/cron/reminders` — `Authorization: Bearer $CRON_SECRET`. The daily job: reminders and
  post-Circle survey emails (see "Member emails").
- `GET /api/member/progress` — member auth. "My progress": the member's **own** survey responses
  only (matched on `data.memberId`), each with its date, Circle and 1-5 scores from
  `stats.personalScores` (the Wellbeing Index for that response plus the before/after scales the
  dashboards already use). Never transcripts, free text or anyone else's answers.
- `GET /api/survey/link?m=<token>` — public. What a signed survey link is about (Circle title and
  date), for the bot page's "Sharing about…" note.

### Post-Circle survey and My progress

Under "Circles you've been to", each Circle the member had a seat at shows **Share how it went**,
which opens the impact survey bot at `/bot/?program=wip-harmoni-circle&event=<id>&m=<token>`. The
token is an HMAC over member id, event id and a 30-day expiry (key from `SURVEY_LINK_SECRET`,
falling back to the Supabase service key). The bot answers the programme question for them and
sends the token back with the finished survey; `/api/chat` verifies it and stores `memberId` and
`eventId` on `responses.data`. Ids written by the chat itself are always discarded, so a response
can only be tied to a member through a valid link. Once a response exists for that Circle the
button reads "Survey done ✓". Surveys taken without a link stay anonymous, as before.

### Member emails

Sent through Resend's HTTP API (`notify.js`) after the change is saved; a failed or skipped
email never fails the member's request. Each member chooses which they get under "Email
notifications" in their profile (`data.notify`, all on by default):

- **RSVPs** (`rsvp`) — going / maybe / waitlisted confirmation with seats, date and time
  (Malaysia time), venue, and the payment link when a confirmed seat is payment pending. A short
  note when they withdraw.
- **My proposals** (`listing`) — to the proposer: submitted / resubmitted (in review), live,
  to revise (with the admin's note), not approved, cancelled. Only when the status actually
  changes; a re-open after "completed" sends nothing.
- **New Circles** (`newEvents`) — to every opted-in member except the host, the first time a
  Circle goes live (`data.announcedAt` stops repeats).
- **How was it?** (`surveys`) — the same daily job emails a signed survey link to members who had
  a seat at a Circle that started 2 to 50 hours earlier, unless they've already answered for it.
  `data.surveyInvitesSent` keeps it to once.
- **Reminders** (`reminders`) — Vercel Cron calls `/api/cron/reminders` daily at 01:00 UTC
  (9am in Malaysia; `crons` in `vercel.json`). Members with a seat (going, not waitlisted) at a
  live Circle starting in the next 48 hours get one reminder; `data.remindersSent` records who,
  so re-runs never send twice.

Events and member profiles live in the same dual-store setup as responses (Redis or local
`data/*.json` primary, Supabase mirror) under separate `events` / `members` keys, and
`GET /api/admin/storage` reports counts for responses and events.

RSVPs and comments made before member accounts existed only carry a typed name, so they
aren't linked to anyone and don't count toward a member's totals.

### Member logins (Supabase Auth)

Logins stay off (the hub explains why) until all of this is in place:

1. **Supabase project** with `supabase/schema.sql` run in it, including the `members`
   table. The app only turns logins on once it can see that table, so it can never sign
   members up into another of the org's Supabase projects.
2. **Env vars** on Vercel and in local `.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_ANON_KEY` (or their `SURVEY_`-prefixed overrides), and `MEMBER_INVITE_CODE`.
3. **Auth → URL Configuration**: set Site URL to the production domain and add
   `https://www.mywiphealing.com/circle/` and `http://localhost:3000/circle/`
   (plus any other local port you use) to Redirect URLs. For Vercel previews add a wildcard
   such as `https://*-<your-team>.vercel.app/circle/**`. Google sign-in, confirmation emails
   and password-reset links all return there; reset links come back as `/circle/?reset=1`, so
   a redirect entry must allow the query string (`/circle/**` does).
4. **Google sign-in**: in Google Cloud Console create an OAuth client (type "Web
   application") with authorised redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`,
   then paste its client ID and secret into Supabase → Auth → Providers → Google.
5. **Email + password**: on by default. Keep "Confirm email" on; Supabase's built-in mailer
   is rate-limited, so set up custom SMTP (Auth → SMTP) before inviting many members.

**Passwords.** "Forgot password?" on the sign-in screen emails a reset link
(`resetPasswordForEmail`, back to `/circle/?reset=1`). Opening it shows "Choose a new password"
(new + confirm, 8+ characters, show/hide), saved with `updateUser`, then signs them in. An
expired or already-used link drops them on the "send a new link" form with a plain message.
Signed-in members can also **Change password** from My Circles, which is also how Google or
magic-link members add a password. The email itself is Supabase's "Reset Password" template
(Auth → Emails / Email Templates), which you can edit there.

A new member signs in (Google or email), enters the invite code once, and from then on just
signs in. Change `MEMBER_INVITE_CODE` any time: existing members are unaffected.

Where members get the code: the "Join our Circle" / "Claim your membership" buttons on
`/wip-harmoni-circle/` go to the RM100 Stripe payment link. Set that link's confirmation
message (Stripe → Payment Links → After payment) to point new members at
`mywiphealing.com/circle/` with the invite code, so only paying members see it.

Site entry points into the hub: a round member icon beside "Request Proposal" in every page
header (a full-width "Member login" button in the mobile menu), a "Members: upcoming Circles"
button in the `/wip-harmoni-circle/` hero, and an "Upcoming Circles / Host your own Circle"
band above that page's "Our events". Styles for all of these live in `public/memberlink.css`,
which each exported page links. `/harmoni-circle.html` and `/members` redirect to `/circle/`.

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
