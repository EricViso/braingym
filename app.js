const express = require("express");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage");
const supabase = require("./supabase");
const stats = require("./stats");
const survey = require("./survey");
const notify = require("./notify");

const app = express();
// 6mb (not the old 1mb): Harmoni Circle proposals carry up to 3 small
// image/PDF attachments as data URLs alongside the form fields.
app.use(express.json({ limit: "6mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";

// Stateless admin token: derived from the password so it survives
// serverless instance recycling (no in-memory session store).
const ADMIN_TOKEN = crypto
  .createHash("sha256")
  .update("seni-admin:" + ADMIN_PASSWORD)
  .digest("hex");

// ---------- WIP Harmoni Circle (member event proposals) ----------

// Members sign in with their own Supabase Auth account (email + password, or
// Google). A new account becomes a member by entering this shared invite code
// once, which keeps the hub members-only. MEMBER_PASSWORD is the old name for
// the same value, from when it was the everyday passcode. CHANGE IT from the
// default.
const MEMBER_INVITE_CODE =
  process.env.MEMBER_INVITE_CODE || process.env.MEMBER_PASSWORD || "changeme123";
// The default is for local development only. In production an unset code
// would let anyone who knows the default join, so joining stays closed
// until a real code is configured.
const INVITE_CODE_MISSING =
  Boolean(process.env.VERCEL) && !process.env.MEMBER_INVITE_CODE && !process.env.MEMBER_PASSWORD;

// Fixed org profit split: the facilitator's share of projected profit, in
// percent. The remainder goes to WIP. Shown read-only in the proposal form.
const FACILITATOR_SHARE = Math.min(
  100,
  Math.max(0, Number(process.env.HARMONI_FACILITATOR_SHARE ?? 60) || 0)
);

// Preset cover personalities for proposals (no image uploads in v1). The
// client sends a cover id; the server only ever serves these fixed values.
const COVERS = [
  // Colours come from the mywiphealing.com palette (see public/circle/index.html).
  { id: "art",    emoji: "🎨", from: "#ef6442", to: "#f5c11f", name: "Art Jam" },
  { id: "water",  emoji: "🖌️", from: "#4F55E2", to: "#BFE6EE", name: "Watercolour" },
  { id: "nature", emoji: "🌿", from: "#2a6f2b", to: "#8ed462", name: "Nature & Calm" },
  { id: "move",   emoji: "🧘", from: "#9769F0", to: "#DFCFFF", name: "Movement & Breath" },
  { id: "words",  emoji: "✍️", from: "#1d1d1f", to: "#ef6442", name: "Words & Journaling" },
  { id: "sound",  emoji: "🎶", from: "#F7A6C8", to: "#ef6442", name: "Sound & Rhythm" },
  { id: "moon",   emoji: "🌙", from: "#2a6f2b", to: "#DEFFA9", name: "Reflection & Rest" },
  { id: "craft",  emoji: "🪢", from: "#DEFFA9", to: "#D5FC4C", name: "Craft & Weaving" },
];

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
// One prompt per language the participant can pick, plus the bilingual one
// for a chat started without a choice.
const SYSTEM_PROMPTS = Object.fromEntries(
  [...Object.keys(survey.LANGS), "both"].map((lang) => [lang, survey.buildSystemPrompt(lang)])
);

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
    const lang = survey.LANGS[req.body.lang] ? req.body.lang : "both";
    const msgs = [{ role: "system", content: SYSTEM_PROMPTS[lang] }, ...history];
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

    // Second safety net: the model asked a question but left the block out.
    if (!done && !options.length) options = survey.buttonsForReply(reply, history, lang);

    if (done) {
      options = [];
      if (!reply) {
        reply = {
          en: "Thank you for completing the survey! \u{1F90D}",
          ms: "Terima kasih kerana melengkapkan tinjauan ini! \u{1F90D}",
        }[lang] || "Thank you for completing the survey! Terima kasih! \u{1F90D}";
      }

      let surveyData = null;
      try {
        surveyData = JSON.parse(dataRaw);
      } catch {
        surveyData = { parse_error: true, raw: dataRaw };
      }
      if (!surveyData || typeof surveyData !== "object") surveyData = { raw: surveyData };
      // Who answered, and about which Circle, only ever comes from a signed
      // survey link (see surveyToken), never from the chat itself.
      delete surveyData.memberId;
      delete surveyData.eventId;
      const link = readSurveyToken(req.body.link);
      if (link) {
        surveyData.memberId = link.memberId;
        surveyData.eventId = link.eventId;
      }
      // Which language the participant answered in, for reading their
      // free-text answers. Stored choices are the same in every language.
      surveyData.language = lang;

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
    res.json({ reply, options, multi: survey.isMultiSelect(options), scale: survey.isLinearScale(options), done, raw: content });
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

// ---------- WIP Harmoni Circle: member event hub ----------

// Signed-in Supabase user, member or not. Sets req.user.
async function requireUser(req, res, next) {
  if (!(await supabase.auth.ready())) {
    return res.status(503).json({ error: supabase.auth.reason() });
  }
  const token = (req.headers.authorization || "").replace("Bearer ", "").trim();
  try {
    const user = await supabase.auth.getUser(token);
    if (!user) return res.status(401).json({ error: "Please sign in again." });
    req.user = user;
    next();
  } catch (e) {
    console.error("Auth check failed:", e.message);
    res.status(503).json({ error: "Couldn't check your login just now. Try again in a moment." });
  }
}

// Signed-in user who has also joined with the invite code. Sets req.member
// (and req.memberIndex, for updates). needsInvite tells the page to show the
// invite step instead of the hub.
function requireMember(req, res, next) {
  requireUser(req, res, async () => {
    try {
      const members = await storage.loadMembers();
      const index = members.findIndex((m) => m.id === req.user.id);
      if (index < 0) {
        return res.status(403).json({ error: "Enter the memberSHIPS invite code to join.", needsInvite: true });
      }
      req.member = members[index];
      req.memberIndex = index;
      next();
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
}

const round2 = (n) => Math.round(n * 100) / 100;

function textField(v, field, min, max) {
  if (typeof v !== "string" || !v.trim()) throw new Error(`${field} is required`);
  const s = v.trim();
  if (s.length < min) throw new Error(`${field} needs at least ${min} characters`);
  if (s.length > max) throw new Error(`${field} is too long (max ${max})`);
  return s;
}

function numField(v, field, min, max, intOnly = false) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${field} must be a number between ${min} and ${max}`);
  }
  return intOnly ? Math.round(n) : round2(n);
}

// Validates a proposal and returns the cleaned record body. The financial
// snapshot is computed HERE from raw numbers - whatever the client shows in
// its live panel is display-only and never trusted.
// Like textField but optional: empty input is stored as "", a filled one must
// fit the max.
function optText(v, field, max) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new Error(`${field} must be text`);
  const s = v.trim();
  if (s.length > max) throw new Error(`${field} is too long (max ${max})`);
  return s;
}

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const FILE_TYPES = new Set([...IMAGE_TYPES, "application/pdf"]);

// One uploaded file, carried as a data URL inside the record, so size is
// capped hard (Vercel's own request cap is 4.5mb anyway). `type` is checked
// against an allow-list and is what the cover route serves it as.
function fileField(f, label, allowed) {
  const name = textField(f && f.name, `${label} name`, 1, 120);
  const type = f && f.type;
  if (!allowed.has(type)) {
    throw new Error(`${label} must be ${allowed.has("application/pdf") ? "PNG, JPG, WebP, GIF or PDF" : "a PNG, JPG, WebP or GIF image"}`);
  }
  const data = typeof (f && f.data) === "string" ? f.data : "";
  if (!data.startsWith(`data:${type};base64,`)) throw new Error(`${label}: file data missing`);
  if (data.length > 1_500_000) throw new Error(`"${name}" is too large — keep each file under ~1MB`);
  return { name, type, data };
}

// Validates a proposal against the WIP Harmoni Circle Session Host Proposal
// Framework (sections 1-9) and returns the cleaned record body. The financial
// snapshot is computed HERE from raw numbers - whatever the client shows in
// its live panel is display-only and never trusted.
function buildProposal(body) {
  // 1. Session Identity
  const title = textField(body.title, "Session title", 3, 120);
  const cover = COVERS.find((c) => c.id === body.coverId);
  if (!cover) throw new Error("Pick a cover for your session");
  const sessionType = textField(body.sessionType, "Session type", 2, 60);
  const audience = textField(body.audience, "Who is this session for", 2, 200);
  const duration = textField(body.duration, "Session duration", 2, 40);
  const when = new Date(body.dateTime);
  if (!body.dateTime || isNaN(when.getTime())) throw new Error("Pick a date and time");
  if (when.getTime() < Date.now()) throw new Error("The date must be in the future");

  // 2. The Activity
  const coreActivity = textField(body.coreActivity, "What participants will do", 20, 2000);
  const reference = optText(body.reference, "Reference link", 300);
  if (reference && !/^https?:\/\//i.test(reference)) {
    throw new Error("Reference link must start with http:// or https://");
  }
  const flow = textField(body.flow, "Session flow", 10, 2000);

  // 3. Location & Logistics
  const venueMode = ["physical", "online", "hybrid"].includes(body.venueMode) ? body.venueMode : "physical";
  const venueName = textField(body.venueName, "Venue name", 2, 120);
  const venueAddress = optText(body.venueAddress, "Venue address", 240);
  const venueNotes = optText(body.venueNotes, "Venue booking notes", 500);
  const minCapacity = numField(body.minCapacity || 1, "Minimum participants", 1, 200, true);
  const capacity = numField(body.capacity, "Maximum participants", 1, 200, true);
  if (minCapacity > capacity) throw new Error("Minimum can't exceed maximum participants");
  const prep = optText(body.prep, "Preparation needed", 1000);

  // 4. Objectives & Intention
  const takeaway = textField(body.takeaway, "What participants walk away with", 10, 1000);
  const intention = textField(body.intention, "The deeper intention", 10, 1500);

  // 5. Psychological Theme (the heart of Harmoni Circle)
  const theme = textField(body.theme, "Psychological / wellness theme", 2, 80);
  const themeExplain = textField(body.themeExplain, "The theme in your own words", 20, 2000);
  const keyMessage = textField(body.keyMessage, "Key message to reflect on", 5, 500);

  // 6. Materials & Resources — who provides each item matters: only
  // Host-provided costs come out of the host's budget and shape the profit
  // split. Circle/Participant-provided items are logistics, not costs.
  if (!Array.isArray(body.costs) || body.costs.length < 1 || body.costs.length > 30) {
    throw new Error("List at least one material/resource line");
  }
  const PROVIDERS = new Set(["host", "circle", "participants"]);
  const costs = body.costs.map((c, i) => {
    const who = PROVIDERS.has(c && c.who) ? c.who : null;
    if (!who) throw new Error(`Material line ${i + 1}: pick who provides it (Host / Circle / Participants)`);
    return {
      item: textField(c && c.item, `Material line ${i + 1} item`, 1, 80),
      who,
      rm: numField(c && c.rm, `Material line ${i + 1} cost (RM)`, 0, 50000),
    };
  });
  const costPerParticipant =
    body.costPerParticipant === undefined || body.costPerParticipant === null || body.costPerParticipant === ""
      ? null
      : numField(body.costPerParticipant, "Estimated cost per participant (RM)", 0, 10000);

  // 7. Facilitation & Flow
  const opening = textField(body.opening, "How you'll open the session", 5, 1000);
  const instructions = textField(body.instructions, "Step-by-step instructions", 20, 3000);
  const closing = textField(body.closing, "How you'll close the session", 5, 1000);

  // 8. Reflection Prompts
  const prompts = textField(body.prompts, "Reflection prompts", 10, 1000);

  // 9. Host's Notes (all optional)
  const help = optText(body.help, "Help needed", 500);
  const accessibility = optText(body.accessibility, "Accessibility considerations", 500);
  const other = optText(body.other, "Anything else", 1000);

  // The numbers that feed the snapshot
  const ticketPrice = numField(body.ticketPrice, "Ticket price (RM)", 0, 10000);
  const projectedAttendees = numField(body.projectedAttendees, "Projected attendees", 1, 10000, true);
  if (projectedAttendees > capacity) {
    throw new Error("Projected attendees can't exceed capacity");
  }

  const contactName = textField(body.contactName, "Your name", 2, 80);
  const contactEmail = textField(body.contactEmail, "Your email", 5, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error("Email doesn't look right");
  if (body.safeguarding !== true) {
    throw new Error("Please confirm the clinical safeguarding acknowledgement");
  }

  // Optional portfolio: images/PDF the host uploads to show their workshop
  // experience. Stored as data URLs inside the record, so count and size are
  // capped hard (Vercel's own request cap is 4.5mb anyway).
  let attachments = [];
  if (body.attachments !== undefined && body.attachments !== null) {
    if (!Array.isArray(body.attachments)) throw new Error("Attachments must be a list");
    if (body.attachments.length > 3) throw new Error("Up to 3 attachments, please");
    attachments = body.attachments.map((a, i) => fileField(a, `Attachment ${i + 1}`, FILE_TYPES));
  }

  // Optional cover photo / poster. Shown as the event's cover once approved
  // (see coverImageOf); the page shrinks it before upload.
  const coverImage =
    body.coverImage === undefined || body.coverImage === null
      ? null
      : fileField(body.coverImage, "Cover photo", IMAGE_TYPES);

  const projectedRevenue = round2(ticketPrice * projectedAttendees);
  const totalCost = round2(costs.filter((c) => c.who === "host").reduce((s, c) => s + c.rm, 0));
  const projectedProfit = round2(projectedRevenue - totalCost);
  const facilitatorPayout = round2((projectedProfit * FACILITATOR_SHARE) / 100);
  const orgPayout = round2(projectedProfit - facilitatorPayout);

  return {
    title,
    cover,
    sessionType,
    audience,
    duration,
    dateTime: when.toISOString(),
    coreActivity,
    reference,
    flow,
    venueMode,
    venueName,
    venueAddress,
    venueNotes,
    minCapacity,
    capacity,
    prep,
    takeaway,
    intention,
    theme,
    themeExplain,
    keyMessage,
    costs,
    costPerParticipant,
    opening,
    instructions,
    closing,
    prompts,
    help,
    accessibility,
    other,
    ticketPrice,
    projectedAttendees,
    contactName,
    contactEmail,
    attachments,
    coverImage,
    financials: {
      projectedRevenue,
      totalCost,
      projectedProfit,
      facilitatorShare: FACILITATOR_SHARE,
      facilitatorPayout,
      orgPayout,
    },
    rsvps: [],
    comments: [],
  };
}

// RSVPs and comments made since member accounts exist carry the member's id.
// Older ones only have the name that was typed in, so they match no one.
const byMember = (memberId) => (r) => Boolean(memberId) && r.memberId === memberId;

// Client-facing view of a live event: only what someone deciding whether to
// come needs. The host's facilitation plan (flow, instructions, prompts,
// intention, costs, attachments, notes) stays between the host and the WIP
// team - it is never sent to members. Member ids aren't sent either; `mine`
// tells the viewer where they stand instead.
function eventView(ev, memberId, photos = new Map()) {
  const d = ev.data || {};
  const rsvps = Array.isArray(d.rsvps) ? d.rsvps : [];
  const active = rsvps.filter((r) => r.status === "going" && !r.waitlisted);
  const maybe = rsvps.filter((r) => r.status === "maybe");
  const goingCount = active.reduce((s, r) => s + r.pax, 0);
  const myRsvp = rsvps.find(byMember(memberId));
  const paid = needsPayment(d);
  return {
    id: ev.id,
    title: d.title,
    cover: d.cover,
    coverImage: coverImageUrl(ev),
    host: d.createdBy ? firstName(d.createdBy.name) : null,
    sessionType: d.sessionType,
    audience: d.audience,
    duration: d.duration,
    dateTime: d.dateTime,
    venueMode: d.venueMode,
    venueName: d.venueName,
    venueAddress: d.venueAddress,
    capacity: d.capacity,
    ticketPrice: d.ticketPrice,
    // Paid events only take "going" RSVPs once the admin has added a link.
    paymentUrl: paid ? d.paymentUrl : null,
    coreActivity: d.coreActivity,
    takeaway: d.takeaway,
    theme: d.theme,
    accessibility: d.accessibility || "",
    whatToBring: (Array.isArray(d.costs) ? d.costs : []).filter((c) => c.who === "participants").map((c) => c.item),
    goingCount,
    maybeCount: maybe.reduce((s, r) => s + r.pax, 0),
    spotsLeft: Math.max(0, d.capacity - goingCount),
    rsvps: rsvps.map((r) => ({
      name: r.name,
      photo: photos.get(r.memberId) || null,
      status: r.status,
      pax: r.pax,
      waitlisted: Boolean(r.waitlisted),
      at: r.at,
    })),
    comments: (Array.isArray(d.comments) ? d.comments : []).map((c) => ({
      name: c.name,
      photo: photos.get(c.memberId) || null,
      text: c.text,
      at: c.at,
    })),
    mine: {
      hosting: Boolean(memberId) && Boolean(d.createdBy) && d.createdBy.id === memberId,
      rsvp: myRsvp ? myRsvp.status : null,
      pax: myRsvp ? myRsvp.pax : null,
      waitlisted: myRsvp ? Boolean(myRsvp.waitlisted) : false,
      paymentStatus: myRsvp ? myRsvp.paymentStatus || null : null,
    },
  };
}

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || null;

// A paid Circle with a payment link: "going" RSVPs owe payment.
const needsPayment = (d) => Number(d.ticketPrice) > 0 && Boolean(d.paymentUrl);

// The event's cover picture: the host's cover upload, else the first image
// among their other attachments. Null means use the colour preset.
function coverImageOf(d) {
  if (d.coverImage && IMAGE_TYPES.has(d.coverImage.type)) return d.coverImage;
  return (Array.isArray(d.attachments) ? d.attachments : []).find((a) => IMAGE_TYPES.has(a.type)) || null;
}

// Served by its own route so lists don't carry megabytes of base64. The
// ?v= changes when the picture does, so browsers can cache it hard.
function coverImageUrl(ev) {
  const img = coverImageOf(ev.data || {});
  return img ? `/api/harmoni/events/${ev.id}/cover?v=${img.data.length.toString(36)}` : null;
}

// The admin's note on a proposal. Approving without a note used to store the
// text "undefined"; records saved before that fix still carry it.
const adminNote = (ev) => (ev.adminNote && ev.adminNote !== "undefined" ? ev.adminNote : null);

// A member's own track record, for their "My Circles" page.
//   joined   - Circles they RSVP'd "going" to and got a seat (not waitlisted)
//   proposed - every proposal they submitted, whatever its status
//   hosted   - their proposals that went live and have now taken place
function memberActivity(events, memberId, surveyed = new Set()) {
  const now = Date.now();
  const joined = [];
  const proposals = [];
  for (const ev of events) {
    const d = ev.data || {};
    const when = new Date(d.dateTime).getTime();
    const past = ev.status === "completed" || (Number.isFinite(when) && when < now);
    const live = ev.status === "approved" || ev.status === "completed";
    const card = {
      id: ev.id,
      title: d.title,
      cover: d.cover,
      dateTime: d.dateTime,
      venueName: d.venueName,
      status: ev.status,
      past,
      coverImage: live ? coverImageUrl(ev) : null,
    };

    if (d.createdBy && d.createdBy.id === memberId) {
      const going = (Array.isArray(d.rsvps) ? d.rsvps : [])
        .filter((r) => r.status === "going" && !r.waitlisted)
        .reduce((s, r) => s + r.pax, 0);
      const rev = ev.status === "needs_revision" && d.revision ? d.revision : null;
      const toRevise = rev ? (rev.flags || []).length + (rev.changes || []).length : 0;
      proposals.push({ ...card, submittedAt: ev.submittedAt, goingCount: going, adminNote: adminNote(ev), toRevise });
    }

    const r = live && (Array.isArray(d.rsvps) ? d.rsvps : []).find(byMember(memberId));
    if (r) {
      joined.push({
        ...card,
        rsvp: r.status,
        waitlisted: Boolean(r.waitlisted),
        pax: r.pax,
        paymentStatus: r.paymentStatus || null,
        paymentUrl: r.paymentStatus === "pending" && needsPayment(d) ? d.paymentUrl : null,
        // Circles they had a seat at and that have happened can be reviewed
        // in the impact survey, once.
        surveyDone: surveyed.has(ev.id),
        surveyUrl: past && r.status === "going" && !r.waitlisted && !surveyed.has(ev.id) ? surveyPath(memberId, ev.id) : null,
      });
    }
  }

  const byDate = (a, b) => new Date(a.dateTime) - new Date(b.dateTime);
  joined.sort(byDate);
  proposals.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  const seated = joined.filter((j) => j.rsvp === "going" && !j.waitlisted);
  const hosted = proposals.filter((p) => (p.status === "approved" || p.status === "completed") && p.past);
  return {
    counts: {
      joined: seated.length,
      attended: seated.filter((j) => j.past).length,
      upcoming: seated.filter((j) => !j.past).length,
      proposed: proposals.length,
      hosted: hosted.length,
    },
    joined,
    proposals,
  };
}

// Profile choices. Keys are stored; labels are what people see.
const MEMBER_ROLES = {
  fighter: "Mental health fighter",
  caregiver: "Caregiver",
  practitioner: "Practitioner",
  leader: "Community leader / volunteer",
  public: "General public",
};
const MY_STATES = [
  "Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Perak", "Perlis",
  "Pulau Pinang", "Sabah", "Sarawak", "Selangor", "Terengganu",
  "W.P. Kuala Lumpur", "W.P. Labuan", "W.P. Putrajaya", "Outside Malaysia",
];
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

// Profile photos are served by an unguessable key of their own, not the
// member id, so a photo URL shown to other members reveals nothing else.
const photoUrl = (m) => {
  const p = m && m.data && m.data.photo;
  return p ? `/api/harmoni/photos/${p.key}?v=${p.data.length.toString(36)}` : null;
};

// memberId -> photo URL, for avatars on RSVPs and comments.
const photoMap = (members) => new Map(members.filter((m) => m.data && m.data.photo).map((m) => [m.id, photoUrl(m)]));

const memberProfile = (m) => {
  const d = m.data || {};
  const roles = Array.isArray(d.roles) ? d.roles.filter((r) => MEMBER_ROLES[r]) : [];
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    provider: m.provider,
    joinedAt: m.joinedAt,
    roles,
    state: d.state || "",
    city: d.city || "",
    photo: photoUrl(m),
    // Which emails they get: { rsvp, listing, newEvents, reminders }.
    notify: notify.prefs(m),
    // Name, at least one role and a location. The photo stays optional.
    profileComplete: Boolean(m.name && roles.length && d.state),
  };
};

// ---------- post-Circle survey links ----------
//
// "Share how it went" opens the impact survey bot (/bot/) with a signed token
// naming the member and the Circle. The bot sends it back with the finished
// survey and the server attaches memberId/eventId to the stored response, so
// a member's answers feed their own progress view. The token is an HMAC over
// [memberId, eventId, expiry]; a raw member id in a URL is never trusted.

const SURVEY_LINK_KEY = crypto
  .createHash("sha256")
  .update(
    "survey-link:" +
      (process.env.SURVEY_LINK_SECRET ||
        process.env.SURVEY_SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        ADMIN_PASSWORD)
  )
  .digest();
const SURVEY_LINK_DAYS = 30;

function surveyToken(memberId, eventId) {
  const exp = Math.floor(Date.now() / 1000) + SURVEY_LINK_DAYS * 86400;
  const body = Buffer.from(JSON.stringify([memberId, eventId, exp])).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", SURVEY_LINK_KEY).update(body).digest("base64url")}`;
}

// { memberId, eventId } for a valid, unexpired token; null for anything else.
function readSurveyToken(token) {
  if (typeof token !== "string" || token.length > 600) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", SURVEY_LINK_KEY).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const [memberId, eventId, exp] = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof memberId !== "string" || typeof eventId !== "string" || !(exp * 1000 > Date.now())) return null;
    return { memberId, eventId };
  } catch {
    return null;
  }
}

const surveyPath = (memberId, eventId) =>
  `/bot/?program=wip-harmoni-circle&event=${encodeURIComponent(eventId)}&m=${surveyToken(memberId, eventId)}`;

// Event ids this member has already answered the survey for.
const surveyedEvents = (responses, memberId) =>
  new Set(
    responses
      .map((r) => r.data || {})
      .filter((d) => d.memberId === memberId && d.eventId)
      .map((d) => d.eventId)
  );

// Public, for the bot page: what a survey link is about, so it can say
// "Sharing about: <Circle>". Says nothing about the member.
app.get("/api/survey/link", async (req, res) => {
  const link = readSurveyToken(req.query.m);
  if (!link) return res.status(400).json({ error: "This survey link has expired. You can still take the survey, or open a fresh link from My Circles." });
  try {
    const events = await storage.loadEvents();
    const ev = events.find((e) => e.id === link.eventId);
    res.json({ ok: true, title: ev ? ev.data.title : null, dateTime: ev ? ev.data.dateTime : null, program: "WIP Harmoni Circle" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A member's own survey answers over time, for "My progress". Only their own
// responses, and only scores: never transcripts, free-text answers or anyone
// else's data.
app.get("/api/member/progress", requireMember, async (req, res) => {
  try {
    const [responses, events] = await Promise.all([storage.loadResponses(), storage.loadEvents()]);
    const titles = new Map(events.map((e) => [e.id, e.data && e.data.title]));
    const entries = responses
      .filter((r) => r.data && r.data.memberId === req.member.id)
      .map((r) => {
        const { wellbeing, scales } = stats.personalScores(r.data);
        return {
          at: r.submittedAt,
          eventId: r.data.eventId || null,
          circle: titles.get(r.data.eventId) || null,
          wellbeing,
          scales,
        };
      })
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json({ entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Public: tells the page whether logins are on and how to reach Supabase.
// The anon key is meant for browsers; it grants nothing the RLS policies
// don't (and every table here has RLS on with no policies).
app.get("/harmoni-circle.html", (req, res) => res.redirect(301, "/circle/"));

app.get("/api/member/config", async (req, res) => {
  const ready = await supabase.auth.ready();
  res.json(
    ready
      ? {
          auth: true,
          supabaseUrl: supabase.auth.url,
          supabaseAnonKey: supabase.auth.anonKey,
          google: await supabase.auth.googleEnabled(),
        }
      : { auth: false, reason: supabase.auth.reason() }
  );
});

// Best-effort brake on guessing the invite code: per account, per warm
// instance. Accounts themselves are rate limited by Supabase Auth.
const inviteAttempts = new Map();
const INVITE_MAX_TRIES = 8;
const INVITE_WINDOW_MS = 15 * 60_000;

function inviteCodeMatches(code) {
  const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(hash(code.trim()), hash(MEMBER_INVITE_CODE));
}

// First sign-in: turn a Supabase account into a member with the invite code.
app.post("/api/member/join", requireUser, async (req, res) => {
  if (INVITE_CODE_MISSING) {
    console.error("Member join refused: MEMBER_INVITE_CODE is not set.");
    return res.status(503).json({ error: "Joining is paused while the WIP team sets up invite codes. Please try again soon." });
  }
  if (!storage.ready) return res.status(500).json({ error: storage.reason });
  try {
    const members = await storage.loadMembers();
    const existing = members.find((m) => m.id === req.user.id);
    if (existing) return res.json({ ok: true, member: memberProfile(existing) });

    const now = Date.now();
    const tries = (inviteAttempts.get(req.user.id) || []).filter((t) => now - t < INVITE_WINDOW_MS);
    if (tries.length >= INVITE_MAX_TRIES) {
      return res.status(429).json({ error: "Too many tries. Wait 15 minutes, or ask the WIP team for the code." });
    }
    const code = typeof (req.body && req.body.inviteCode) === "string" ? req.body.inviteCode : "";
    if (!inviteCodeMatches(code)) {
      tries.push(now);
      inviteAttempts.set(req.user.id, tries);
      return res.status(400).json({ error: "That invite code isn't right." });
    }
    inviteAttempts.delete(req.user.id);

    const name = textField((req.body && req.body.name) || req.user.name, "Your name", 2, 80);
    const record = {
      id: req.user.id,
      email: req.user.email,
      name,
      provider: req.user.provider,
      joinedAt: new Date().toISOString(),
      data: {},
    };
    await storage.appendMember(record);
    res.json({ ok: true, member: memberProfile(record) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/member/me", requireMember, async (req, res) => {
  try {
    const [events, responses] = await Promise.all([storage.loadEvents(), storage.loadResponses()]);
    res.json({
      member: memberProfile(req.member),
      activity: memberActivity(events, req.member.id, surveyedEvents(responses, req.member.id)),
      profileOptions: { roles: MEMBER_ROLES, states: MY_STATES },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Profile editing: any of { name, roles, state, city, photo, notify } (photo
// null removes it; notify is { rsvp, listing, newEvents, reminders } booleans). Email and sign-in method belong to Supabase Auth. Roles and
// location are only ever shown to the member and admins; name and photo are
// what other members see.
app.post("/api/member/me", requireMember, async (req, res) => {
  try {
    const b = req.body || {};
    const m = req.member;
    const d = (m.data = m.data || {});
    if (b.name !== undefined) m.name = textField(b.name, "Your name", 2, 80);
    if (b.roles !== undefined) {
      if (!Array.isArray(b.roles) || b.roles.some((r) => !MEMBER_ROLES[r])) throw new Error("Pick your community role from the list");
      d.roles = [...new Set(b.roles)];
    }
    if (b.state !== undefined) {
      if (b.state && !MY_STATES.includes(b.state)) throw new Error("Pick your state from the list");
      d.state = b.state || "";
    }
    if (b.city !== undefined) d.city = optText(b.city, "Town or area", 80);
    if (b.photo !== undefined) {
      if (b.photo === null) {
        delete d.photo;
      } else {
        const f = fileField(b.photo, "Profile photo", PHOTO_TYPES);
        if (f.data.length > 400_000) throw new Error("That photo is too large. Try another one.");
        d.photo = { key: crypto.randomUUID(), type: f.type, data: f.data };
      }
    }
    if (b.notify !== undefined) {
      if (!b.notify || typeof b.notify !== "object") throw new Error("Email settings must be a list of on/off choices");
      const next = { ...notify.prefs(m) };
      for (const k of notify.NOTIFY_KEYS) {
        if (b.notify[k] === undefined) continue;
        if (typeof b.notify[k] !== "boolean") throw new Error("Email settings must be on or off");
        next[k] = b.notify[k];
      }
      d.notify = next;
    }
    d.profileUpdatedAt = new Date().toISOString();
    await storage.updateMember(req.memberIndex, m);
    res.json({ ok: true, member: memberProfile(m) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// A member's profile photo, by its own key (see photoUrl). No auth, because
// <img> tags can't send the token; the key is random and changes with every
// new upload.
app.get("/api/harmoni/photos/:key", async (req, res) => {
  try {
    const members = await storage.loadMembers();
    const m = members.find((x) => x.data && x.data.photo && x.data.photo.key === req.params.key);
    if (!m || !PHOTO_TYPES.has(m.data.photo.type)) return res.status(404).end();
    const p = m.data.photo;
    res.set({ "Content-Type": p.type, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
    res.send(Buffer.from(p.data.slice(p.data.indexOf(",") + 1), "base64"));
  } catch (e) {
    res.status(500).end();
  }
});

app.get("/api/harmoni/events", requireMember, async (req, res) => {
  try {
    const [events, members] = await Promise.all([storage.loadEvents(), storage.loadMembers()]);
    const photos = photoMap(members);
    const list = events
      .filter((ev) => ev.status === "approved")
      .map((ev) => eventView(ev, req.member.id, photos))
      .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
    res.json({
      events: list,
      config: { facilitatorShare: FACILITATOR_SHARE, currency: "RM", covers: COVERS },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/harmoni/events", requireMember, async (req, res) => {
  if (!storage.ready) return res.status(500).json({ error: storage.reason });
  const notWritable = await storage.writableEvents();
  if (notWritable) return res.status(500).json({ error: notWritable });

  try {
    const data = buildProposal(req.body || {});
    // Who proposed it, from the login rather than the form, so it can't be
    // put down to someone else. The form's contact name/email stay as typed.
    data.createdBy = { id: req.member.id, name: req.member.name, email: req.member.email };
    const record = {
      id: crypto.randomUUID(),
      submittedAt: new Date().toISOString(),
      status: "under_review",
      data,
      adminNote: null,
      decidedAt: null,
      decidedBy: null,
    };
    await storage.appendEvent(record);
    if (notify.wants(req.member, "listing")) {
      await notify.send(notify.listingStatus(data.createdBy.email, req.member.name, data, "under_review"));
    }
    res.json({ ok: true, id: record.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// The proposer's own proposal, in full, so they can revise it when the WIP
// team asks for changes (status needs_revision).
const REVISABLE = new Set(["needs_revision"]);
const ownedBy = (ev, memberId) => Boolean(ev && ev.data && ev.data.createdBy && ev.data.createdBy.id === memberId);

// Proposal fields the WIP team can edit directly or flag for the host when
// asking for changes, in form order. Labels are what the host reads in My
// Circles and in the email. Fields marked `flagOnly` can be flagged but not
// edited by the admin (files and the materials list stay the host's).
const REVISION_FIELDS = {
  title: "Session title", coverImage: { label: "Cover photo", flagOnly: true }, sessionType: "Session type",
  audience: "Who it's for", dateTime: "Date & time", duration: "Duration",
  coreActivity: "What participants will do", flow: "Session flow", reference: "Reference link",
  attachments: { label: "Photos / PDFs of past work", flagOnly: true },
  venueMode: "In person / online", venueName: "Venue", venueAddress: "Venue address", venueNotes: "Venue booking notes",
  minCapacity: "Smallest group", capacity: "Largest group", prep: "Setup & preparation",
  takeaway: "What people walk away with", intention: "Deeper intention",
  theme: "Theme", themeExplain: "Theme in their words", keyMessage: "Key message",
  costs: { label: "Materials & who provides them", flagOnly: true }, costPerParticipant: "Cost per person (RM)",
  ticketPrice: "Ticket price (RM)", projectedAttendees: "Expected attendees",
  opening: "Opening", instructions: "Step-by-step instructions", closing: "Closing", prompts: "Reflection prompts",
  help: "Help needed", accessibility: "Accessibility", other: "Anything else",
  contactName: "Contact name", contactEmail: "Contact email",
};
const fieldLabel = (k) => (typeof REVISION_FIELDS[k] === "string" ? REVISION_FIELDS[k] : REVISION_FIELDS[k].label);
const revisionValue = (d, k) => (d[k] === null || d[k] === undefined ? "" : k === "dateTime" ? d[k] : String(d[k]));

// What changed between two versions of a proposal, as [{ field, label, from, to }],
// over the fields WIP and the host both edit as text.
function proposalDiff(before, after) {
  return Object.keys(REVISION_FIELDS)
    .filter((k) => typeof REVISION_FIELDS[k] === "string" && revisionValue(before, k) !== revisionValue(after, k))
    .map((k) => ({ field: k, label: fieldLabel(k), from: revisionValue(before, k), to: revisionValue(after, k) }));
}

// A stored proposal back into the shape buildProposal takes, so an edited copy
// goes through exactly the same checks as the host's own submission.
function proposalBody(d) {
  const { rsvps, comments, financials, createdBy, paymentUrl, announcedAt, remindersSent, resubmittedAt, revision, cover, ...rest } = d;
  return { ...rest, coverId: cover && cover.id, safeguarding: true };
}

// Bookkeeping the proposal form doesn't own, carried from the old version.
function carryOver(old, data) {
  data.createdBy = old.createdBy;
  data.rsvps = Array.isArray(old.rsvps) ? old.rsvps : [];
  data.comments = Array.isArray(old.comments) ? old.comments : [];
  for (const k of ["paymentUrl", "announcedAt", "remindersSent", "resubmittedAt", "revision"]) if (old[k]) data[k] = old[k];
  return data;
}

app.get("/api/harmoni/events/:id/edit", requireMember, async (req, res) => {
  try {
    const events = await storage.loadEvents();
    const ev = events.find((e) => e.id === req.params.id);
    if (!ownedBy(ev, req.member.id)) return res.status(404).json({ error: "Proposal not found" });
    if (!REVISABLE.has(ev.status)) return res.status(400).json({ error: "This proposal can't be edited right now" });
    const { rsvps, comments, financials, createdBy, paymentUrl, announcedAt, remindersSent, resubmittedAt, revision, ...proposal } = ev.data;
    res.json({ proposal, adminNote: adminNote(ev), revision: revision || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Resubmit a revised proposal: same validation as a new one, then it goes
// back into the review queue. Bookkeeping the member can't set (who proposed
// it, RSVPs, comments, payment link) carries over from the stored record.
app.put("/api/harmoni/events/:id", requireMember, async (req, res) => {
  try {
    const events = await storage.loadEvents();
    const index = events.findIndex((e) => e.id === req.params.id);
    const record = events[index];
    if (!ownedBy(record, req.member.id)) return res.status(404).json({ error: "Proposal not found" });
    if (!REVISABLE.has(record.status)) return res.status(400).json({ error: "This proposal can't be edited right now" });

    const old = record.data;
    const data = carryOver(old, buildProposal(req.body || {}));
    data.resubmittedAt = new Date().toISOString();
    record.data = data;
    record.status = "under_review";
    // What the host changed on top of the version WIP sent back, so the
    // admin can see whether the flagged points were dealt with.
    if (data.revision) {
      data.revision = { ...data.revision, resubmittedAt: data.resubmittedAt, hostChanges: proposalDiff(old, data) };
    }

    await storage.updateEvent(index, record);
    if (notify.wants(req.member, "listing")) {
      await notify.send(
        notify.listingStatus(data.createdBy.email, req.member.name, data, "under_review", null, { resubmitted: true })
      );
    }
    res.json({ ok: true, id: record.id });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/harmoni/events/:id/rsvp", requireMember, async (req, res) => {
  try {
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });
    const record = events[index];
    if (record.status !== "approved") {
      return res.status(400).json({ error: "RSVPs open once a Circle is approved" });
    }

    const status = req.body && req.body.status === "maybe" ? "maybe" : "going";
    const pax = numField((req.body && req.body.pax) || 1, "Seats", 1, 10, true);

    const d = record.data;
    if (!Array.isArray(d.rsvps)) d.rsvps = [];
    if (status === "going" && Number(d.ticketPrice) > 0 && !d.paymentUrl) {
      return res.status(400).json({ error: "Payment for this Circle isn't open yet. Try Maybe for now; the WIP team will add a way to pay soon." });
    }
    // One RSVP per member: a new one replaces their old one.
    const previous = d.rsvps.find(byMember(req.member.id));
    d.rsvps = d.rsvps.filter((r) => !byMember(req.member.id)(r));

    let waitlisted = false;
    if (status === "going") {
      const goingPax = d.rsvps
        .filter((r) => r.status === "going" && !r.waitlisted)
        .reduce((s, r) => s + r.pax, 0);
      // Full house: keep the RSVP but flag it as waitlisted (Partiful-style).
      waitlisted = goingPax + pax > d.capacity;
    }
    // Paid Circles: a "going" seat is held as payment pending until the admin
    // marks it paid. Already paid for at least this many seats stays paid.
    let paymentStatus = null;
    if (status === "going" && needsPayment(d)) {
      paymentStatus = previous && previous.paymentStatus === "paid" && previous.pax >= pax ? "paid" : "pending";
    }
    const rsvp = {
      memberId: req.member.id,
      name: req.member.name,
      status,
      pax,
      waitlisted,
      paymentStatus,
      at: new Date().toISOString(),
    };
    d.rsvps.push(rsvp);

    await storage.updateEvent(index, record);
    // Waitlisted people don't pay until a seat is theirs.
    const paymentUrl = paymentStatus === "pending" && !waitlisted ? d.paymentUrl : null;
    if (notify.wants(req.member, "rsvp")) {
      await notify.send(notify.rsvpConfirmation(req.member, d, rsvp, paymentUrl));
    }
    res.json({ ok: true, waitlisted, paymentUrl });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- "Write a draft for me" (proposal form helper) ----------

// What each draftable question needs, with the proposal framework's own
// example as the style reference. `lines` fields come back as a list.
const DRAFT_FIELDS = {
  title: { ask: "a session title, 3 to 7 words, warm and specific", example: "Guided Neurographic Lines Session / Journalling for Inner Peace / Batik & Breath Circle" },
  coreActivity: { ask: "what participants will actually do, in 2 to 3 plain sentences", example: "A guided painting session where participants express emotions through neurographic art — drawing free-flow lines, adding colour, and rounding corners to rewire thinking patterns." },
  flow: { ask: "the session flow as 4 to 5 short steps", lines: true, example: "Set an intention — think about a phase of life you tend to control most\nDraw neuro-lines — move pencil freely across paper for 3-5 seconds\nAdd colour — fill the new shapes with markers or paint\nRound the corners — turn sharp X-shapes into soft flowing junctions\nDoodle — add gel pen details to finish" },
  prep: { ask: "setup and preparation needed before the session, one sentence", example: "Arrange chairs in circle, prepare paper + pencils at each seat, test projector for demo video" },
  takeaway: { ask: "what participants will walk away with, one or two sentences", example: "A felt sense of calm, a tool for self-regulation they can use at home, and connection to others through shared creative process." },
  intention: { ask: "why this session matters to the host and to the circle, two sentences in the host's own voice", example: "Because so many of us hold tension in our bodies without a way to release it. Art gives us a non-verbal outlet — and doing it together reminds us we are not alone." },
  theme: { ask: "the core psychological theme, as 'Theme — short subtitle'", example: "Neuroplasticity — Rewiring Thinking with Art" },
  themeExplain: { ask: "how the psychological theme connects to the activity, 2 to 3 plain sentences", example: "When we round sharp corners in neurographic art, we are physically simulating how the brain can bend rigid thought patterns into softer, more adaptive ones. The act of drawing mirrors the process of rewiring." },
  keyMessage: { ask: "one key message or insight for participants to reflect on, one or two sentences", example: "You are not stuck in your current patterns. With intention and practice, your mind can shift — just like the lines on the page." },
  opening: { ask: "how the host will open the session, as a short sequence joined with >", example: "Grounding breath (1 min) > brief intro on neuroplasticity > set intention — invite participants to write a word about an area of life they tend to over-control" },
  instructions: { ask: "step-by-step instructions for the activity, 4 to 6 numbered steps", lines: true, example: "Draw fast squiggly lines across paper (3–5 sec)\nExtend loose ends to page edges\nFill new shapes with colour\nRound all sharp corners with black marker\nAdd doodle details with gel pens" },
  closing: { ask: "how the host will close the session, as a short sequence joined with >", example: "Silent gallery walk > optional sharing circle — anyone can share one word about how they feel now > closing breath" },
  prompts: { ask: "4 open-ended reflection prompts (questions, not yes/no)", lines: true, example: "Where in your life do you hold the tightest control — and what would softening feel like?\nDid you notice any resistance during the process? Where did it show up?\nWhat shifted between the first line you drew and the final piece?\nIf your artwork could speak, what would it say about how you are feeling right now?" },
  accessibility: { ask: "accessibility considerations and adaptations for this activity, one or two sentences", example: "Space is ground floor with ramp access. If participants have limited hand mobility, we can adapt by using larger brushes or finger painting instead of fine pens." },
};

// The answers a draft may lean on, and how they're labelled for the model.
const DRAFT_CONTEXT = {
  title: "Session title", sessionType: "Type of session", audience: "Audience", duration: "Duration",
  coreActivity: "Core activity", flow: "Session flow", venueName: "Venue", theme: "Psychological theme",
  takeaway: "What participants walk away with", instructions: "Instructions",
};

// Per member, per warm instance: drafts cost DeepSeek calls.
const draftCalls = new Map();
const DRAFT_MAX_PER_HOUR = 40;

app.post("/api/harmoni/draft", requireMember, async (req, res) => {
  const field = req.body && req.body.field;
  const spec = DRAFT_FIELDS[field];
  if (!spec) return res.status(400).json({ error: "Nothing to draft for that question" });

  const now = Date.now();
  const calls = (draftCalls.get(req.member.id) || []).filter((t) => now - t < 3600_000);
  if (calls.length >= DRAFT_MAX_PER_HOUR) {
    return res.status(429).json({ error: "That's a lot of drafts for one hour. Try the example, or come back a bit later." });
  }
  calls.push(now);
  draftCalls.set(req.member.id, calls);

  const answers = (req.body && req.body.answers) || {};
  const known = Object.entries(DRAFT_CONTEXT)
    .filter(([k]) => k !== field && typeof answers[k] === "string" && answers[k].trim())
    .map(([k, label]) => `${label}: ${answers[k].trim().slice(0, 600)}`);

  const system =
    "You help members of WIP Harmoni Circle, a peer-led, art-therapy-informed community in Malaysia, fill in a proposal to host a creative wellbeing session. " +
    "Write in plain, warm, everyday English as if you were the host. Keep sentences short and concrete. " +
    "Do not make clinical claims or promise to treat conditions. " +
    "Reply with only the answer text, no preamble, no quotes, no markdown" +
    (spec.lines ? ", one item per line, without numbers or bullets." : ".");
  const user =
    `Write ${spec.ask}.\n\n` +
    (known.length
      ? `What the host has written so far:\n${known.join("\n")}\n\nBuild on this; don't contradict it.`
      : "The host hasn't written anything yet, so suggest a simple, beginner-friendly creative session idea.") +
    `\n\nStyle reference (a different session; match its length and tone, not its content):\n${spec.example}`;

  try {
    const out = (await deepseek([{ role: "system", content: system }, { role: "user", content: user }])).trim();
    if (spec.lines) {
      const lines = out
        .split(/\n+/)
        .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)]|step\s*\d+:?)\s*/i, "").trim())
        .filter(Boolean)
        .slice(0, 6);
      return res.json({ lines });
    }
    res.json({ text: out.replace(/^["']|["']$/g, "").slice(0, 2000) });
  } catch (e) {
    console.error("Draft failed:", e.message);
    res.status(503).json({ error: "Couldn't write a draft just now. Try the example instead." });
  }
});

// The event's cover picture (see coverImageOf). No auth, because <img> tags
// can't send the bearer token: live events only, addressed by their
// unguessable id. The type comes from the upload allow-list, never the
// data itself.
app.get("/api/harmoni/events/:id/cover", async (req, res) => {
  try {
    const events = await storage.loadEvents();
    const ev = events.find((e) => e.id === req.params.id);
    const img = ev && (ev.status === "approved" || ev.status === "completed") && coverImageOf(ev.data || {});
    if (!img) return res.status(404).end();
    res.set({
      "Content-Type": img.type,
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(Buffer.from(img.data.slice(img.data.indexOf(",") + 1), "base64"));
  } catch (e) {
    res.status(500).end();
  }
});

// Withdraw your RSVP. Frees the seat; waitlisted people are not auto-promoted
// (the host or admin sees the waitlist and follows up).
app.delete("/api/harmoni/events/:id/rsvp", requireMember, async (req, res) => {
  try {
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });
    const record = events[index];
    const d = record.data;
    const before = Array.isArray(d.rsvps) ? d.rsvps.length : 0;
    d.rsvps = (d.rsvps || []).filter((r) => !byMember(req.member.id)(r));
    if (d.rsvps.length !== before) {
      await storage.updateEvent(index, record);
      if (notify.wants(req.member, "rsvp")) await notify.send(notify.rsvpWithdrawn(req.member, d));
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/harmoni/events/:id/comments", requireMember, async (req, res) => {
  try {
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });
    const record = events[index];
    if (record.status !== "approved") {
      return res.status(400).json({ error: "Comments open once a Circle is approved" });
    }

    const text = textField(req.body && req.body.text, "Comment", 1, 280);
    const d = record.data;
    if (!Array.isArray(d.comments)) d.comments = [];
    d.comments.push({ memberId: req.member.id, name: req.member.name, text, at: new Date().toISOString() });
    if (d.comments.length > 200) d.comments = d.comments.slice(-200);

    await storage.updateEvent(index, record);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---------- WIP Harmoni Circle: admin review queue ----------

app.get("/api/admin/harmoni/events", requireAdmin, async (req, res) => {
  try {
    const events = await storage.loadEvents();
    res.json({
      events: events
        .map((ev) => ({
          id: ev.id,
          status: ev.status,
          submittedAt: ev.submittedAt,
          adminNote: adminNote(ev),
          decidedAt: ev.decidedAt || null,
          decidedBy: ev.decidedBy || null,
          revision: (ev.data && ev.data.revision) || null,
          data: ev.data,
        }))
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)),
      config: { facilitatorShare: FACILITATOR_SHARE, currency: "RM", covers: COVERS },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Everyone who has joined with the invite code, with their activity counts.
// Payment link members are sent to when they RSVP "going" to a paid Circle
// (any provider: ToyyibPay, Billplz, Stripe payment link...). Empty clears it.
app.post("/api/admin/harmoni/events/:id/payment", requireAdmin, async (req, res) => {
  try {
    const url = optText(req.body && req.body.paymentUrl, "Payment link", 500);
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new Error("Payment link must start with https://");
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });
    events[index].data.paymentUrl = url || null;
    await storage.updateEvent(index, events[index]);
    res.json({ ok: true, paymentUrl: url || null });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Admin bookkeeping on one RSVP: { key, action: paid | unpaid | remove }.
// key is the RSVP's memberId, or "name:<name>" for pre-account RSVPs.
app.post("/api/admin/harmoni/events/:id/rsvp", requireAdmin, async (req, res) => {
  try {
    const { key, action } = req.body || {};
    if (!["paid", "unpaid", "remove"].includes(action)) throw new Error("Unknown action");
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });
    const d = events[index].data;
    const match = (r) => (r.memberId ? r.memberId === key : `name:${r.name}` === key);
    const rsvp = (d.rsvps || []).find(match);
    if (!rsvp) return res.status(404).json({ error: "RSVP not found" });
    if (action === "remove") d.rsvps = d.rsvps.filter((r) => !match(r));
    else rsvp.paymentStatus = action === "paid" ? "paid" : "pending";
    await storage.updateEvent(index, events[index]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get("/api/admin/harmoni/members", requireAdmin, async (req, res) => {
  try {
    const [members, events] = await Promise.all([storage.loadMembers(), storage.loadEvents()]);
    res.json({
      members: members
        .map((m) => ({ ...memberProfile(m), counts: memberActivity(events, m.id).counts }))
        .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt)),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/harmoni/events/:id/status", requireAdmin, async (req, res) => {
  const VALID = new Set(["under_review", "needs_revision", "approved", "rejected", "completed", "cancelled"]);
  const target = req.body && req.body.status;
  if (!VALID.has(target)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  try {
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });

    const record = events[index];
    const previous = record.status;
    record.status = target;
    record.decidedAt = new Date().toISOString();
    record.decidedBy = "admin";
    // No note sent (e.g. a plain Approve) leaves any earlier note alone.
    if (typeof req.body.note === "string") {
      record.adminNote = req.body.note.trim().slice(0, 300) || null;
    }
    // A note-only change request (no edits or flagged fields).
    if (target === "needs_revision") {
      record.data.revision = { requestedAt: record.decidedAt, note: record.adminNote, changes: [], flags: [] };
    }
    // A Circle is announced to members once, the first time it goes live, so
    // a re-open after "completed" or a trip back through review doesn't
    // announce it again.
    const announce = target === "approved" && !record.data.announcedAt && new Date(record.data.dateTime) > new Date();
    if (announce) record.data.announcedAt = new Date().toISOString();

    await storage.updateEvent(index, record);
    const email = previous !== target ? await notifyStatusChange(record, previous, announce) : null;
    res.json({ ok: true, status: record.status, email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// "Request changes" with the proposal in hand: the WIP team edits fields
// directly (applied now, the host reviews and accepts them when resubmitting)
// and/or flags fields for the host to rework, plus an overall note. Body:
// { note, edits: { field: value }, flags: { field: "what to change" } }.
app.post("/api/admin/harmoni/events/:id/request-changes", requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 1000) : "";
    const edits = b.edits && typeof b.edits === "object" ? b.edits : {};
    const flagsIn = b.flags && typeof b.flags === "object" ? b.flags : {};
    for (const k of Object.keys(edits)) {
      if (!REVISION_FIELDS[k] || typeof REVISION_FIELDS[k] !== "string") throw new Error(`"${k}" can't be edited here`);
    }
    const flags = Object.keys(flagsIn).map((k) => {
      if (!REVISION_FIELDS[k]) throw new Error(`"${k}" isn't a proposal field`);
      return { field: k, label: fieldLabel(k), note: typeof flagsIn[k] === "string" ? flagsIn[k].trim().slice(0, 500) : "" };
    });

    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });
    const record = events[index];
    if (!["under_review", "needs_revision"].includes(record.status)) {
      return res.status(400).json({ error: "Only proposals in review can be sent back for changes" });
    }

    const old = record.data;
    let data = old;
    let changes = [];
    if (Object.keys(edits).length) {
      // Same checks as the host's own form, so WIP can't save a proposal the
      // host couldn't have sent.
      data = carryOver(old, buildProposal({ ...proposalBody(old), ...edits }));
      changes = proposalDiff(old, data);
    }
    // Updating a request the host hasn't answered yet: edits made last time
    // are already in the proposal, so keep them listed (from the host's
    // original value) alongside any new ones.
    const pending = record.status === "needs_revision" && old.revision && !old.revision.resubmittedAt ? old.revision.changes || [] : [];
    if (pending.length) {
      const merged = pending.map((c) => {
        const now = changes.find((n) => n.field === c.field);
        return now ? { ...c, to: now.to } : c;
      });
      changes = merged.concat(changes.filter((n) => !pending.some((c) => c.field === n.field))).filter((c) => c.from !== c.to);
    }
    if (!note && !flags.length && !changes.length) {
      return res.status(400).json({ error: "Edit a field, flag one for the host, or add a note so the host knows what to change" });
    }

    const previous = record.status;
    record.data = data;
    record.status = "needs_revision";
    record.decidedAt = new Date().toISOString();
    record.decidedBy = "admin";
    record.adminNote = note || null;
    // Kept inside data: the Supabase mirror only stores the fixed columns.
    data.revision = { requestedAt: record.decidedAt, note: note || null, changes, flags };
    await storage.updateEvent(index, record);
    const email = previous !== "needs_revision" || changes.length || flags.length ? await notifyStatusChange(record, previous, false) : null;
    res.json({ ok: true, status: record.status, changes: changes.length, flags: flags.length, email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Emails for an admin status change, sent after the change is saved. The
// proposer hears about the outcomes that matter to them; members who opted in
// hear about a newly live Circle. Resolves to what happened to the host's
// email ({ sent, to, error } or { skipped }), for the admin page to show.
const LISTING_EMAILS = new Set(["approved", "needs_revision", "rejected", "cancelled"]);

async function notifyStatusChange(record, previous, announce) {
  let email = null;
  try {
    const d = record.data || {};
    const members = await storage.loadMembers();
    const host = d.createdBy && members.find((m) => m.id === d.createdBy.id);
    // A re-open after "completed" isn't news to the host.
    const tellHost = LISTING_EMAILS.has(record.status) && !(record.status === "approved" && previous === "completed");
    // Pre-account proposals have no member record, so no settings to respect.
    if (tellHost && d.createdBy && d.createdBy.email && (!host || notify.wants(host, "listing"))) {
      const revision = record.status === "needs_revision" ? d.revision : null;
      email = await notify.sendReport(notify.listingStatus(d.createdBy.email, d.createdBy.name, d, record.status, adminNote(record), { revision }));
    } else if (tellHost) {
      // Say why in the logs, so a missing email can be traced from Vercel.
      const why = !d.createdBy || !d.createdBy.email
        ? "the proposal has no member account (submitted before logins)"
        : "the host turned off emails about their proposals";
      console.log(`No "${record.status}" email for "${d.title}": ${why}`);
      email = { sent: false, skipped: why };
    }
    if (announce) {
      await notify.sendMany(
        members
          .filter((m) => m.id !== (d.createdBy && d.createdBy.id) && notify.wants(m, "newEvents"))
          .map((m) => notify.newCircle(m, d))
      );
    }
  } catch (e) {
    console.error("Status emails failed:", e.message);
    email = { sent: false, error: e.message };
  }
  return email;
}

// ---------- WIP Harmoni Circle: daily reminders (Vercel Cron) ----------

// Vercel calls this once a day (vercel.json "crons") with
// `Authorization: Bearer $CRON_SECRET`. Members with a seat ("going", not
// waitlisted) at a live Circle starting within the next 48 hours get one
// reminder; data.remindersSent records who has had theirs, so a re-run or a
// second day inside the window sends nothing twice.
const REMINDER_WINDOW_MS = 48 * 3600_000;

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const hash = (s) => crypto.createHash("sha256").update(String(s)).digest();
  return crypto.timingSafeEqual(hash(req.headers.authorization || ""), hash(`Bearer ${secret}`));
}

// After a Circle: one "How was it?" email per member who had a seat, for
// Circles that started between 2 and 50 hours ago (the cron runs daily, so
// each Circle gets one pass). data.surveyInvitesSent keeps it to once, and
// anyone who has already answered for that Circle is skipped.
const SURVEY_AFTER_MS = 2 * 3600_000;
const SURVEY_WINDOW_MS = 50 * 3600_000;

async function sendSurveyInvites(events, byId, now) {
  const report = [];
  let responses = null;
  for (let index = 0; index < events.length; index++) {
    const record = events[index];
    const d = record.data || {};
    const start = new Date(d.dateTime).getTime();
    const ago = now - start;
    if (!["approved", "completed"].includes(record.status) || !(ago >= SURVEY_AFTER_MS && ago <= SURVEY_WINDOW_MS)) continue;

    const already = d.surveyInvitesSent || {};
    const due = (Array.isArray(d.rsvps) ? d.rsvps : [])
      .filter((r) => r.status === "going" && !r.waitlisted && r.memberId && !already[r.memberId])
      .map((r) => byId.get(r.memberId))
      .filter((m) => notify.wants(m, "surveys"));
    if (!due.length) continue;

    if (!responses) responses = await storage.loadResponses();
    const msgs = due
      .filter((m) => !surveyedEvents(responses, m.id).has(record.id))
      .map((m) => ({ ...notify.surveyInvite(m, d, notify.SITE_URL + surveyPath(m.id, record.id)), memberId: m.id }));
    const sent = await notify.sendMany(msgs.map(({ memberId, ...msg }) => msg));
    const sentTo = new Set(sent.map((s) => s.to));
    const reached = msgs.filter((msg) => sentTo.has(msg.to)).map((msg) => msg.memberId);
    if (reached.length) {
      const at = new Date().toISOString();
      d.surveyInvitesSent = { ...already, ...Object.fromEntries(reached.map((id) => [id, at])) };
      await storage.updateEvent(index, record);
    }
    report.push({ id: record.id, due: msgs.length, sent: reached.length });
  }
  return report;
}

app.get("/api/cron/reminders", async (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: "CRON_SECRET is not set" });
  if (!cronAuthorized(req)) return res.status(401).json({ error: "Unauthorized" });
  try {
    const [events, members] = await Promise.all([storage.loadEvents(), storage.loadMembers()]);
    const byId = new Map(members.map((m) => [m.id, m]));
    const now = Date.now();
    const report = [];
    for (let index = 0; index < events.length; index++) {
      const record = events[index];
      const d = record.data || {};
      const start = new Date(d.dateTime).getTime();
      if (record.status !== "approved" || !(start > now && start - now <= REMINDER_WINDOW_MS)) continue;

      const already = d.remindersSent || {};
      const due = (Array.isArray(d.rsvps) ? d.rsvps : [])
        .filter((r) => r.status === "going" && !r.waitlisted && r.memberId && !already[r.memberId])
        .map((r) => ({ r, m: byId.get(r.memberId) }))
        .filter(({ m }) => notify.wants(m, "reminders"));
      if (!due.length) continue;

      const msgs = due.map(({ r, m }) => ({ ...notify.reminder(m, d, r), memberId: m.id }));
      const sent = await notify.sendMany(msgs.map(({ memberId, ...msg }) => msg));
      const sentTo = new Set(sent.map((s) => s.to));
      const at = new Date().toISOString();
      const reached = msgs.filter((msg) => sentTo.has(msg.to)).map((msg) => msg.memberId);
      if (reached.length) {
        d.remindersSent = { ...already, ...Object.fromEntries(reached.map((id) => [id, at])) };
        await storage.updateEvent(index, record);
      }
      report.push({ id: record.id, due: due.length, sent: reached.length });
    }
    const surveys = await sendSurveyInvites(events, byId, now);
    res.json({ ok: true, events: report, surveys });
  } catch (e) {
    console.error("Reminder run failed:", e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
