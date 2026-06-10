# Seni Scape Impact Survey 🤍

Mobile-friendly conversational survey app. A DeepSeek-powered AI assistant ("Seni")
asks the compiled bilingual (EN/BM) survey questions in a chat, stores each completed
response, auto-analyzes it (sentiment, themes, wellbeing shift, follow-up flags),
and a password-protected admin dashboard shows the analytics.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Open `.env` and set your values:
   - `DEEPSEEK_API_KEY` — your DeepSeek API key (https://platform.deepseek.com)
   - `ADMIN_PASSWORD` — password for the admin dashboard
3. Start:
   ```
   npm start
   ```

## URLs

- Survey (share this with participants): `http://localhost:3000/`
- Admin dashboard: `http://localhost:3000/admin.html`

## How it works

- `POST /api/chat` — relays the conversation to DeepSeek with a system prompt that
  contains the full compiled survey (demographics, pre-session check-in, reflection
  & impact, post-session SERATS scale, program feedback). When every question is
  answered the model emits a hidden `<survey_complete>{...json...}</survey_complete>`
  block; the server extracts it, runs a second DeepSeek call to analyze the response,
  and saves both to `data/responses.json`.
- `POST /api/admin/login` — exchanges the admin password for a session token.
- `GET /api/admin/data` — stats (scale averages, category distributions, flags) +
  all individual responses with their AI analysis.
- `POST /api/admin/insights` — on-demand DeepSeek report across the whole dataset.

Data is stored in `data/responses.json` (git-ignored).
