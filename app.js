const express = require("express");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage");
const supabase = require("./supabase");
const stats = require("./stats");
const survey = require("./survey");

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
    res.json({ reply, options, multi: survey.isMultiSelect(options), done, raw: content });
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
function memberActivity(events, memberId) {
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
      proposals.push({ ...card, submittedAt: ev.submittedAt, goingCount: going, adminNote: adminNote(ev) });
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
    // Name, at least one role and a location. The photo stays optional.
    profileComplete: Boolean(m.name && roles.length && d.state),
  };
};

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
    const events = await storage.loadEvents();
    res.json({
      member: memberProfile(req.member),
      activity: memberActivity(events, req.member.id),
      profileOptions: { roles: MEMBER_ROLES, states: MY_STATES },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Profile editing: any of { name, roles, state, city, photo } (photo null
// removes it). Email and sign-in method belong to Supabase Auth. Roles and
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
    d.rsvps.push({
      memberId: req.member.id,
      name: req.member.name,
      status,
      pax,
      waitlisted,
      paymentStatus,
      at: new Date().toISOString(),
    });

    await storage.updateEvent(index, record);
    // Waitlisted people don't pay until a seat is theirs.
    res.json({ ok: true, waitlisted, paymentUrl: paymentStatus === "pending" && !waitlisted ? d.paymentUrl : null });
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
    if (d.rsvps.length !== before) await storage.updateEvent(index, record);
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
  const VALID = new Set(["under_review", "approved", "rejected", "completed", "cancelled"]);
  const target = req.body && req.body.status;
  if (!VALID.has(target)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  try {
    const events = await storage.loadEvents();
    const index = events.findIndex((ev) => ev.id === req.params.id);
    if (index < 0) return res.status(404).json({ error: "Event not found" });

    const record = events[index];
    record.status = target;
    record.decidedAt = new Date().toISOString();
    record.decidedBy = "admin";
    // No note sent (e.g. a plain Approve) leaves any earlier note alone.
    if (typeof req.body.note === "string") {
      record.adminNote = req.body.note.trim().slice(0, 300) || null;
    }

    await storage.updateEvent(index, record);
    res.json({ ok: true, status: record.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
