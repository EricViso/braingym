const express = require("express");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage");
const stats = require("./stats");
const survey = require("./survey");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";

// Stateless admin token: derived from the password so it survives
// serverless instance recycling (no in-memory session store).
const ADMIN_TOKEN = crypto
  .createHash("sha256")
  .update("seni-admin:" + ADMIN_PASSWORD)
  .digest("hex");

// Org-level totals shown on the public Community dashboard. These are NOT
// survey-derived — they are figures the org confirms as real, set via env.
// Left null they render as an "add in config" placeholder (never invented).
const SITE_STATS = {
  peopleReached: process.env.STAT_PEOPLE_REACHED || null,
  hoursDelivered: process.env.STAT_HOURS_DELIVERED || null,
  communities: process.env.STAT_COMMUNITIES || null,
  organisations: process.env.STAT_ORGANISATIONS || null,
  sinceYear: process.env.STAT_SINCE_YEAR || null,
};

// ---------- DeepSeek ----------

async function deepseek(messages, jsonMode = false) {
  if (!API_KEY || API_KEY === "your_deepseek_api_key_here") {
    throw new Error("DEEPSEEK_API_KEY is not set. Add it to the .env file.");
  }
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek API error ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ---------- survey definition (compiled from all three forms) ----------

// Generated from survey.js so question numbering, quick-reply buttons and the
// completion template can never drift apart. Edit the questions there.
const SYSTEM_PROMPT = survey.buildSystemPrompt();

const ANALYSIS_PROMPT = `You analyse survey responses for a creative-expression mental health program. Given one participant's response as JSON, reply with a JSON object with exactly these fields:
{"sentiment":"positive|mixed|negative","wellbeing_shift":"improved|unchanged|declined|unknown","themes":["2 to 5 short theme keywords"],"summary":"2-3 sentence summary of this participant's experience and the program's impact on them","concern_flag":false,"concern_note":null}
Set concern_flag to true (with a short concern_note) only if the response suggests serious distress, self-harm risk, or a need for human follow-up. Reply with JSON only.`;

const INSIGHTS_PROMPT = `You analyse survey data for myWIPhealing, a set of creative-expression mental health programmes. You will receive an array of participant responses as JSON; each has a "program" field naming which programme it came from. Write a concise report (markdown, max ~300 words) covering: overall sentiment, measured impact (compare the pre-session feelings with the post-session scores), the most common themes in the open answers, what participants found most meaningful, and the top suggestions for improvement. Where programmes differ meaningfully, say so per programme rather than pooling them. Be concrete and quote numbers where useful.`;

// ---------- auto-processing ----------

async function analyzeResponse(surveyData) {
  const content = await deepseek(
    [
      { role: "system", content: ANALYSIS_PROMPT },
      { role: "user", content: JSON.stringify(surveyData) },
    ],
    true
  );
  return JSON.parse(content);
}

// ---------- survey chat API ----------

// Splits an assistant message into visible text, quick-reply options,
// and the hidden completed-survey JSON.
function parseAssistant(content) {
  let reply = content;
  let done = false;
  let options = [];
  let dataRaw = null;

  const doneMatch = reply.match(/<survey_complete>([\s\S]*?)<\/survey_complete>/);
  if (doneMatch) {
    done = true;
    dataRaw = doneMatch[1];
    reply = reply.replace(doneMatch[0], "").trim();
  }

  const optMatch = reply.match(/<options>([\s\S]*?)<\/options>/);
  if (optMatch) {
    reply = reply.replace(optMatch[0], "").trim();
    try {
      const parsed = JSON.parse(optMatch[1]);
      if (Array.isArray(parsed)) {
        options = parsed
          .filter((o) => typeof o === "string" && o.trim())
          .slice(0, 12);
      }
    } catch {}
  }

  return { reply, done, options, dataRaw };
}

app.post("/api/chat", async (req, res) => {
  if (!storage.ready) return res.status(500).json({ error: storage.reason });
  // Fail before the first question rather than after the last one.
  const notWritable = await storage.writable();
  if (notWritable) return res.status(500).json({ error: notWritable });

  const history = (Array.isArray(req.body.messages) ? req.body.messages : [])
    .filter(
      (m) =>
        m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .slice(-100);

  try {
    const msgs = [{ role: "system", content: SYSTEM_PROMPT }, ...history];
    let content = await deepseek(msgs);
    let out = parseAssistant(content);
    if (!out.done && !out.reply) {
      // Rare flake: the model emitted only an options block with no text.
      content = await deepseek(msgs);
      out = parseAssistant(content);
    }
    let { reply, done, options, dataRaw } = out;

    // Safety net: if the model wrote a 1-5 scale guide as plain text and
    // forgot the options block, build the buttons from those lines.
    if (!done && !options.length) {
      const byDigit = new Map();
      for (const m of reply.matchAll(/^[\s*_]*([1-5])\s*[=\-]\s*(.+?)[\s*_]*$/gm)) {
        if (!byDigit.has(m[1])) byDigit.set(m[1], `${m[1]} - ${m[2].trim()}`);
      }
      if (byDigit.size >= 3) options = [...byDigit.values()];
    }

    if (done) {
      options = [];
      if (!reply) {
        reply = "Thank you for completing the survey! Terima kasih! \u{1F90D}";
      }

      let surveyData = null;
      try {
        surveyData = JSON.parse(dataRaw);
      } catch {
        surveyData = { parse_error: true, raw: dataRaw };
      }

      const record = {
        id: crypto.randomUUID(),
        submittedAt: new Date().toISOString(),
        // Which questionnaire revision produced these answers. Without it,
        // responses to reworded questions get averaged together silently.
        schema_version: storage.SCHEMA_VERSION,
        data: surveyData,
        analysis: null,
        transcript: [...history, { role: "assistant", content: reply }],
      };

      // Save first so the response survives even if the analysis call
      // fails or the serverless function times out, then attach analysis.
      const index = await storage.appendResponse(record);
      try {
        record.analysis = await analyzeResponse(surveyData);
      } catch (e) {
        record.analysis = { error: e.message };
      }
      try {
        await storage.updateResponse(index, record);
      } catch (e) {
        console.error("Failed to attach analysis:", e);
      }
    }

    // raw keeps the hidden blocks so the model sees its own prior format
    // in the conversation history and stays consistent with it.
    res.json({ reply, options, done, raw: content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---------- admin API ----------

app.post("/api/admin/login", (req, res) => {
  if (req.body && req.body.password === ADMIN_PASSWORD) {
    res.json({ token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ error: "Wrong password" });
  }
});

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  const a = Buffer.from(token);
  const b = Buffer.from(ADMIN_TOKEN);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// Admin hub: full stats + every response (with AI analysis) + participant
// groupings + a hint of which open-text fields can be approved as quotes.
app.get("/api/admin/data", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    res.json({
      stats: stats.computeStats(responses),
      responses,
      participants: stats.groupByParticipant(responses),
      // Sent rather than hardcoded in the page: the dashboard used to keep its
      // own copy of the field list, so a question added to the survey silently
      // vanished from both the detail table and the CSV export.
      fieldLabels: survey.fieldLabels(),
      quoteFields: stats.QUOTE_FIELDS,
      programs: survey.PROGRAMS,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Corporate Impact view: team-level aggregates, filterable. Never per-person.
app.get("/api/admin/corporate", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    const { program, company, from, to } = req.query;
    res.json({ stats: stats.corporateStats(responses, { program, company, from, to }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Consent gate: mark/unmark one response's open-text answer as a public quote.
// Body: { field, author?, text?, approved } — approved:false clears it.
// Open-text answers an admin may approve as a public testimonial. Scale and
// identifying fields are deliberately excluded - a quote must be something the
// participant actually wrote.
const QUOTE_FIELDS = new Set(stats.QUOTE_FIELDS);

app.post("/api/admin/responses/:id/approve-quote", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    const index = responses.findIndex((r) => r.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Response not found" });

    const record = responses[index];
    const { field, author, text, approved } = req.body || {};

    if (approved === false) {
      delete record.approvedQuote;
    } else {
      if (!QUOTE_FIELDS.has(field)) {
        return res.status(400).json({ error: "Invalid quote field" });
      }
      record.approvedQuote = {
        field,
        author: (author || "Participant").slice(0, 80),
        text: text ? String(text).slice(0, 600) : undefined,
      };
    }

    await storage.updateResponse(index, record);
    res.json({ ok: true, approvedQuote: record.approvedQuote || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Where is the data actually going? Reports which stores are live and how many
// responses each holds, so a silently-empty backend is visible before a booth
// session rather than after it.
app.get("/api/admin/storage", requireAdmin, async (req, res) => {
  try {
    res.json(await storage.health());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/insights", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    if (!responses.length) return res.json({ insights: "No responses yet." });
    const insights = await deepseek([
      { role: "system", content: INSIGHTS_PROMPT },
      { role: "user", content: JSON.stringify(responses.map((r) => r.data)) },
    ]);
    res.json({ insights });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- public API (Community dashboard: anonymised, aggregate only) ----------

// No auth. communityStats() returns only aggregates + admin-approved quotes;
// it never includes names, email, phone, or raw transcripts.
// Programme list, for the dashboard filter dropdowns.
app.get("/api/programs", (req, res) => {
  res.json({ programs: survey.PROGRAMS });
});

app.get("/api/public/community", async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    res.json({ stats: stats.communityStats(responses), site: SITE_STATS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
