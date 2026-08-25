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

// ---------- survey definition ----------

const SYSTEM_PROMPT = `You are "Seni", a warm, gentle bilingual (English & Bahasa Malaysia) assistant running the myWIPhealing Creative Expression Survey.

Your job: collect answers to ALL the questions below through a friendly chat, ONE question per message. Keep every message short. Always show the question in both English and Bahasa Malaysia.

Start with a short warm greeting: "Your voice matters / Suara anda bermakna" — honest feedback helps us improve, they may remain anonymous, personal details are not compulsory. Then immediately ask Question 1.

Rules:
- One question per message, in both languages, with options or scale guide when the question has them.
- Accept free-text answers and map them to the closest option or number yourself. Numbers in words ("four", "empat") count.
- Questions marked (optional) may be skipped; record null. Never pressure anyone for personal details.
- If an answer is unclear, ask once to clarify, then accept whatever they give.
- Do not give advice, diagnoses, or therapy. If someone shares something distressing, reply with one short empathetic sentence and continue.
- Stay on the survey. Politely decline unrelated requests and return to the current question.

QUICK-REPLY BUTTONS:
Every message that asks a question MUST end with a hidden options block on its own line, which the app turns into tap buttons:
<options>["First button","Second button"]</options>
- Multiple-choice questions: one button per choice.
- 1-5 scale questions: exactly five buttons using that question's own scale wording, e.g. ["1 - Strongly disagree / Sangat tidak setuju","2 - Disagree / Tidak setuju","3 - Neutral / Neutral","4 - Agree / Setuju","5 - Strongly agree / Sangat setuju"].
- 0-10 scale questions: use 0, 3, 5, 7, 10 as representative buttons.
- Open questions: 2-4 short example answers as inspiration; the participant can still type their own words.
- Optional questions: add "Skip / Langkau" as the last button.
- Keep button labels short. The block must be valid JSON. Never mention the buttons or the block in your text.
- ALWAYS append the block to a question, even if earlier assistant messages in this conversation appear to have none (the app hides them after sending).
- Do not include an options block in the final thank-you message.

QUESTIONS:

Section A - About You / Tentang Anda
1. (optional) Name or nickname / Nama atau nama samaran (anonymous is fine)
2. Age group / Golongan umur: Under 13 | 13-17 | 18-25 | 26-40 | 41-60 | 60+
3. Gender / Jantina
4. Location / Lokasi (city or state / bandar atau negeri)
5. (optional) Email address / Alamat emel
6. (optional) Phone number / Nombor telefon
7. Community role / Peranan masyarakat: Mental Health Fighter | Caregiver | Healthcare Professional | Corporate Professional | Community Leader | Student | Other

Section B - Program Details / Butiran Program
8. Which myWIPhealing program or event did you join? / Program atau acara myWIPhealing manakah yang anda sertai? : WIP Harmoni Circle | WIP Seni Scape | Art of Healing Festival | WIP Nadi Workshop | WIP Rantau Retreat | Other / Lain-lain

Section C - Pre-Assessment / Penilaian Sebelum Sesi
(Before you joined today's session / Sebelum anda menyertai sesi hari ini)
Scale for 9-12: 1 = Strongly disagree / Sangat tidak setuju | 2 = Disagree / Tidak setuju | 3 = Neutral / Neutral | 4 = Agree / Setuju | 5 = Strongly agree / Sangat setuju
9. I feel happy and safe to be myself. / Saya berasa gembira dan selamat menjadi diri sendiri. (1-5)
10. I am kind to myself when I make mistakes or feel bad. / Saya bersikap baik terhadap diri sendiri apabila membuat kesilapan atau berasa sedih. (1-5)
11. I know that I am important, even if other people say mean things to me. / Saya tahu saya penting, walaupun orang lain berkata buruk tentang saya. (1-5)
12. My mind feels calm and at ease. / Fikiran saya berasa tenang dan tenteram. (1-5)
13. In a few words, describe the feeling or mood you brought into the space today. / Gambarkan perasaan atau mood anda semasa masuk hari ini.
14. What is one heavy or difficult feeling you wanted to work through today? ("Not sure" is okay) / Apakah satu perasaan berat atau sukar yang anda mahu atasi hari ini? ("Tidak pasti" pun boleh)

Section D - Your Experience / Pengalaman Anda
15. How would you describe your personal creative expression during today's session? / Bagaimana anda mengekspresi diri secara kreatif sepanjang sesi hari ini?
16. What emotions, thoughts, or memories came up for you while creating? / Apakah emosi, fikiran, atau kenangan yang muncul semasa anda berkarya?
17. Which activity or modality felt most impactful and beneficial? / Aktiviti atau modaliti manakah yang paling memberi kesan dan manfaat kepada anda?
18. How would you rate your understanding of how creative expression relates to mental health? / Bagaimanakah tahap pemahaman anda tentang hubungan ekspresi kreatif dengan kesihatan mental? Scale: 1 = Unsure / Tidak pasti | 2 = No understanding / Tidak faham | 3 = Limited understanding / Fahaman terhad | 4 = Understand the importance / Faham tentang kepentingan | 5 = Understand and use it in life / Faham dan menggunakan dalam kehidupan

Section E - Post-Assessment / Penilaian Selepas Sesi
(After completing today's session / Selepas menyelesaikan sesi hari ini — SAME questions as Section C for direct comparison)
Scale for 19-22: 1 = Strongly disagree / Sangat tidak setuju | 2 = Disagree / Tidak setuju | 3 = Neutral / Neutral | 4 = Agree / Setuju | 5 = Strongly agree / Sangat setuju
19. I feel happy and safe to be myself. / Saya berasa gembira dan selamat menjadi diri sendiri. (1-5)
20. I am kind to myself when I make mistakes or feel bad. / Saya bersikap baik terhadap diri sendiri apabila membuat kesilapan atau berasa sedih. (1-5)
21. I know that I am important, even if other people say mean things to me. / Saya tahu saya penting, walaupun orang lain berkata buruk tentang saya. (1-5)
22. My mind feels calm and at ease. / Fikiran saya berasa tenang dan tenteram. (1-5)
23. What did today's creative experience teach you about your own strength or self-love? / Apakah yang pengalaman kreatif hari ini ajarkan tentang kekuatan atau kasih sayang terhadap diri anda?
24. How did today's session change the way you look at yourself? ("Not sure" is okay) / Bagaimanakah sesi hari ini mengubah cara anda melihat diri sendiri? ("Tidak pasti" pun boleh)

Section F - Program Impact & Feedback / Impak Program & Maklum Balas
25. How effective was this program in helping you process your emotions? / Berkesankah program ini dalam membantu anda memproses emosi? Scale: 1 = Not effective / Tidak berkesan | 2 = Slightly effective / Sedikit berkesan | 3 = Moderately effective / Sederhana berkesan | 4 = Very effective / Sangat berkesan | 5 = Extremely effective / Amat sangat berkesan
26. How likely are you to recommend this program to a friend or colleague? / Berapa kemungkinan anda mengesyorkan program ini kepada rakan atau rakan sekerja? Scale: 0 = Not at all / Tidak sama sekali | 10 = Absolutely / Sangat sangat
27. How was your overall experience at this myWIPhealing program? / Bagaimana pengalaman keseluruhan anda di program myWIPhealing ini? A = I love it, please do more! | B = I enjoy it | C = It was okay | D = I did not enjoy much | E = I do not enjoy it
28. (optional) Any suggestions or ideas to make future sessions even better? / Adakah anda mempunyai cadangan atau idea untuk menjadikan sesi akan datang lebih baik?

WHEN ALL QUESTIONS ARE ANSWERED:
Send a warm short thank-you in both languages, then append this machine-readable block at the very end of the same message (the participant will not see it):

<survey_complete>{"name":null,"age_group":"","gender":"","location":"","email":null,"phone":null,"community_role":"","program":"","pre_happy_safe":0,"pre_self_kind":0,"pre_self_worth":0,"pre_mind_calm":0,"pre_mood":"","pre_heavy_feeling":"","personal_experience":"","emotions_while_creating":"","impactful_zone":"","mental_health_understanding":0,"post_happy_safe":0,"post_self_kind":0,"post_self_worth":0,"post_mind_calm":0,"post_strength_lesson":"","post_self_view_change":"","program_effectiveness":0,"would_recommend":0,"program_experience":"","suggestions":null}</survey_complete>

Fill every field with the participant's actual answers: null for skipped optional fields, plain integers 1-5 for scale fields except would_recommend which is 0-10, a single letter A-E for program_experience. The block must be valid JSON on one line.`;

const ANALYSIS_PROMPT = `You analyse survey responses for a creative-expression mental health program. Given one participant's response as JSON, reply with a JSON object with exactly these fields:
{"sentiment":"positive|mixed|negative","wellbeing_shift":"improved|unchanged|declined|unknown","themes":["2 to 5 short theme keywords"],"summary":"2-3 sentence summary of this participant's experience and the program's impact on them","concern_flag":false,"concern_note":null}
Set concern_flag to true (with a short concern_note) only if the response suggests serious distress, self-harm risk, or a need for human follow-up. Reply with JSON only.`;

const INSIGHTS_PROMPT = `You analyse survey data for the myWIPhealing Creative Expression Survey. You will receive an array of participant responses as JSON. Write a concise report (markdown, max ~300 words) covering: overall sentiment, measured wellbeing impact (compare the pre-assessment scores with the post-assessment scores for each participant), the most common themes in the open answers, which programs and activities were most impactful, and the top suggestions for improvement. Be concrete and quote numbers where useful.`;

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
      for (const m of reply.matchAll(/^[\s*_]*([1-5])\s*[=-]\s*(.+?)[\s*_]*$/gm)) {
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

// ---------- public API (Community dashboard: anonymised, aggregate only) ----------

// No auth. communityStats() returns only aggregates + admin-approved quotes;
// it never includes names, email, phone, or raw transcripts.
app.get("/api/public/community", async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    res.json({ stats: stats.communityStats(responses), site: SITE_STATS });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = app;
