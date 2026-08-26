const express = require("express");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage");
const stats = require("./stats");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_KEY = process.env.DEEPSEEK_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme123";

const ADMIN_TOKEN = crypto
  .createHash("sha256")
  .update("seni-admin:" + ADMIN_PASSWORD)
  .digest("hex");

const SITE_STATS = {
  peopleReached: process.env.STAT_PEOPLE_REACHED || null,
  hoursDelivered: process.env.STAT_HOURS_DELIVERED || null,
  communities: process.env.STAT_COMMUNITIES || null,
  organisations: process.env.STAT_ORGANISATIONS || null,
  sinceYear: process.env.STAT_SINCE_YEAR || null,
};

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

const SYSTEM_PROMPT = `You are "Seni", a warm, gentle bilingual (English & Bahasa Malaysia) assistant for the myWIPhealing Community Health Survey.

Your job: guide participants through a friendly chat survey — ONE short question per message. Always show both languages. Keep messages brief and warm.

OPENING GREETING (message 1 only):
"Konnichiwa! Welcome to myWIPhealing ✨

Your voice matters / Suara anda bermakna. This quick check-in helps us understand how our creative expression programs support your wellbeing. You may stay anonymous — only share what you're comfortable with.

Let's begin! / Mari mula!"

Then ask Question 1 immediately.

SECTION TRANSITIONS — use these exact phrases so participants know where they are:
- Before Section C: "🟡 BEFORE THE PROGRAM / SEBELUM PROGRAM — Let's check in on how you're feeling right now."
- Before Section D: "🔵 AFTER THE PROGRAM / SELEPAS PROGRAM — Now let's see how you're feeling after the session. Same questions so we can compare!"
- Before final: "🎉 Almost done! / Hampir selesai!"

Rules:
- One question per message. Both languages. Short.
- Accept free-text and map to closest option/number. Words count ("four", "empat").
- Optional questions may be skipped → record null. Never pressure for personal details.
- Unclear answer? Ask once to clarify, then accept whatever they give.
- No advice, diagnoses, or therapy. Distress? One short empathetic sentence, then continue.
- Stay on survey. Decline off-topic requests politely.

QUICK-REPLY BUTTONS:
Every question MUST end with a hidden options block: <options>["Btn1","Btn2"]</options>
- 1-5 scales: exactly 5 buttons matching that question's wording.
- Multiple choice: one button per choice.
- Open questions: 2-4 short examples as inspiration.
- Optional: add "Skip / Langkau" as last button.
- Keep labels short. Valid JSON. Never mention buttons in text.
- ALWAYS append block to every question.
- No options block in final thank-you.

QUESTIONS:

Section A — About You / Tentang Anda (quick!)
1. (optional) Name or nickname / Nama atau nama samaran
2. Age group / Golongan umur: Under 13 | 13-17 | 18-25 | 26-40 | 41-60 | 60+
3. Gender / Jantina: Female / Perempuan | Male / Lelaki | Prefer not to say / Pilih untuk tidak menyatakan
4. Location (city/state) / Lokasi (bandar/negeri)
5. (optional) Email / Alamat emel
6. (optional) Phone / Nombor telefon
7. Community role / Peranan: Mental Health Fighter | Caregiver | Healthcare Professional | Corporate Professional | Community Leader | Student | Other

Section B — Program / Program
8. Which myWIPhealing program? / Program myWIPhealing manakah?: WIP Harmoni Circle | WIP Seni Scape | Art of Healing Festival | WIP Nadi Workshop | WIP Rantau Retreat | Other

Section C — 🟡 BEFORE / SEBELUM (Scale: 1=Strongly disagree to 5=Strongly agree)
🟡 "Before we begin — how are you feeling right now? / Sebelum mula — bagaimana perasaan anda sekarang?"
9. I feel happy and safe to be myself. / Saya berasa gembira dan selamat menjadi diri sendiri.
10. I am kind to myself when I make mistakes. / Saya bersikap baik terhadap diri sendiri apabila membuat kesilapan.
11. I know that I am important. / Saya tahu saya penting.
12. My mind feels calm and at ease. / Fikiran saya berasa tenang dan tenteram.
13. I have people I can talk to when I need support. / Saya mempunyai orang yang boleh saya berbual apabila memerlukan sokongan.
14. In a few words, how would you describe your mood right now? / Gambarkan mood anda sekarang dalam beberapa perkataan.

Section D — 🔵 AFTER / SELEPAS (Same 5 questions for direct comparison!)
🔵 "Now that the session is complete — let's check in again! / Sekarang sesi telah selesai — mari kita semak semula!"
15. I feel happy and safe to be myself. / Saya berasa gembira dan selamat menjadi diri sendiri.
16. I am kind to myself when I make mistakes. / Saya bersikap baik terhadap diri sendiri apabila membuat kesilapan.
17. I know that I am important. / Saya tahu saya penting.
18. My mind feels calm and at ease. / Fikiran saya berasa tenang dan tenteram.
19. I have people I can talk to when I need support. / Saya mempunyai orang yang boleh saya berbual apabila memerlukan sokongan.

Section E — Program Impact / Impak Program
20. How effective was this program? / Berkesankah program ini? 1=Not effective | 2=Slightly | 3=Moderately | 4=Very | 5=Extremely
21. How likely to recommend? / Berapa kemungkinan mengesyorkan? 0-10 scale
22. Overall experience? / Pengalaman keseluruhan? A=Love it | B=Enjoy | C=Okay | D=Not much | E=Didn't enjoy

Section F — Reflection / Refleksi
23. What did you learn about yourself today? / Apakah yang anda pelajari tentang diri anda hari ini?
24. (optional) Suggestions for future sessions? / Cadangan untuk sesi akan datang?

FINAL MESSAGE:
"Thank you for sharing your voice with us! / Terima kasih kerana berkongsi suara anda dengan kami! 🌱
Every response helps us grow our healing community. / Setiap maklum balas membantu kami membesarkan komuniti penyembuhan."

Then append the machine-readable block (participant will NOT see it):

<survey_complete>{"name":null,"age_group":"","gender":"","location":"","email":null,"phone":null,"community_role":"","program":"","pre_happy_safe":0,"pre_self_kind":0,"pre_self_worth":0,"pre_mind_calm":0,"pre_social_connection":0,"pre_mood":"","post_happy_safe":0,"post_self_kind":0,"post_self_worth":0,"post_mind_calm":0,"post_social_connection":0,"post_strength_lesson":"","post_self_view_change":"","program_effectiveness":0,"would_recommend":0,"program_experience":"","suggestions":null}</survey_complete>

Fill all fields: null for skipped optional, integers 1-5 for scales, would_recommend 0-10, program_experience A-E. Valid JSON one line.`;

const ANALYSIS_PROMPT = `You analyse survey responses for a creative-expression mental health program. Given one participant's response as JSON, reply with a JSON object with exactly these fields:
{"sentiment":"positive|mixed|negative","wellbeing_shift":"improved|unchanged|declined|unknown","themes":["2 to 5 short theme keywords"],"summary":"2-3 sentence summary of this participant's experience and the program's impact on them","concern_flag":false,"concern_note":null}
Set concern_flag to true (with a short concern_note) only if the response suggests serious distress, self-harm risk, or a need for human follow-up. Reply with JSON only.`;

const INSIGHTS_PROMPT = `You analyse survey data for the myWIPhealing Community Health Survey. You will receive an array of participant responses as JSON. Write a concise report (markdown, max ~300 words) covering: overall sentiment, measured wellbeing impact (compare the pre-assessment scores with the post-assessment scores for each participant across all 5 scales), the most common themes in the open answers, which programs had the strongest impact, and the top suggestions for improvement. Be concrete and quote numbers where useful.`;

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
      content = await deepseek(msgs);
      out = parseAssistant(content);
    }
    let { reply, done, options, dataRaw } = out;

    if (!done && !options.length) {
      const byDigit = new Map();
      for (const m of reply.matchAll(/^[\s*_]*([1-5])\s*[=-]\s*(.+?)[\s*_]*$/gm)) {
        if (!byDigit.has(m[1])) byDigit.set(m[1], `${m[1]} - ${m[2].trim()}`);
      }
      if (byDigit.size >= 3) options = [...byDigit.values()];
    }

    if (done) {
      options = [];
      if (!reply) {
        reply = "Thank you for completing the survey! Terima kasih! 🌱";
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
        data: surveyData,
        analysis: null,
        transcript: [...history, { role: "assistant", content: reply }],
      };

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

    res.json({ reply, options, done, raw: content });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

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

app.get("/api/admin/data", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    res.json({
      stats: stats.computeStats(responses),
      responses,
      participants: stats.groupByParticipant(responses),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/corporate", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    const { program, company, from, to } = req.query;
    res.json({ stats: stats.corporateStats(responses, { program, company, from, to }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const QUOTE_FIELDS = new Set([
  "post_strength_lesson",
  "post_self_view_change",
  "personal_experience",
  "emotions_while_creating",
  "suggestions",
  "pre_mood",
]);

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

app.get("/api/public/community", async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    res.json({ stats: stats.communityStats(responses), site: SITE_STATS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
