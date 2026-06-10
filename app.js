const express = require("express");
const path = require("path");
const crypto = require("crypto");
const storage = require("./storage");

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

const SYSTEM_PROMPT = `You are "Seni", a warm, gentle bilingual (English & Bahasa Malaysia) assistant running the Seni Scape Impact Survey for Yayasan Selgate.

Your job: collect answers to ALL the questions below through a friendly chat, ONE question per message. Keep every message short. Always show the question in both English and Bahasa Malaysia.

Start with a short warm greeting: "Your voice matters / Suara anda bermakna" - honest feedback matters, they may remain anonymous, personal details are not compulsory. Then immediately ask Question 1.

Rules:
- One question per message, in both languages, with options or scale guide when the question has them.
- Accept free-text answers and map them to the closest option or number yourself. Numbers in words ("four", "empat") count.
- Questions marked (optional) may be skipped; record null. Never pressure anyone for personal details.
- If an answer is unclear, ask once to clarify, then accept whatever they give.
- Do not give advice, diagnoses, or therapy. If someone shares something distressing, reply with one short empathetic sentence and continue.
- Stay on the survey. Politely decline unrelated requests and return to the current question.

QUESTIONS:

Section A - About You / Tentang Anda
1. (optional) Name or nickname / Nama atau nama samaran (anonymous is fine)
2. Age group / Golongan umur: Under 13 | 13-17 | 18-25 | 26-40 | 41-60 | 60+
3. Gender / Jantina
4. Location / Lokasi (city or state / bandar atau negeri)
5. (optional) Email address / Alamat emel
6. (optional) Phone number / Nombor telefon
7. Type of creative expression attended / Jenis ekspresi kreatif: Art & Craft | Writing (Poetry/Journal/Zine) | Movement (theatre/dance/somatic) | Music expression | Clay | Photography | Other
8. Community role / Peranan masyarakat: Mental Health Fighter | Caregiver | Healthcare Professional | Corporate Professional | Community Leader | Student | Other

Section B - Before the Session / Sebelum Sesi
Scale for 9-12: 1 = No, not at all / Tidak sama sekali | 2 = A little bit / Sedikit | 3 = In the middle / Sederhana | 4 = Yes, mostly / Ya, kebanyakannya | 5 = Yes, completely / Ya, sepenuhnya
9. Before the session, I felt happy and safe to be myself. / Sebelum sesi, saya berasa gembira dan selamat menjadi diri sendiri. (1-5)
10. When I make a mistake or feel bad, I am very hard on myself. / Apabila saya membuat kesilapan atau berasa sedih, saya sangat keras terhadap diri sendiri. (1-5)
11. I know that I am important, even if other people say mean things to me. / Saya tahu saya penting, walaupun orang lain berkata buruk tentang saya. (1-5)
12. Before the session, my mind felt heavy, busy, or stressed. / Sebelum sesi, fikiran saya terasa berat, sibuk, atau tertekan. (1-5)
13. In a few words, describe the feeling or mood you brought into the room today. / Gambarkan perasaan atau mood anda semasa masuk hari ini.
14. What is one sad, angry, or heavy feeling you wanted to put onto the paper today? ("Not sure" is okay) / Apakah satu perasaan sedih, marah, atau berat yang anda mahu luahkan ke atas kertas hari ini? ("Tidak pasti" pun boleh)

Section C - Your Experience / Pengalaman Anda
15. How would you describe your personal creative expression during today's session? / Bagaimana anda mengekspresi diri secara kreatif sepanjang sesi hari ini?
16. What emotions, thoughts, or memories came up for you while creating? / Apakah emosi, fikiran, atau kenangan yang muncul semasa anda berkarya?
17. How could you relate this creative expression with mental health? / Bagaimanakah anda boleh kaitkan sesi ekspresi kreatif dengan fahaman kesihatan mental? Scale: 1 = Unsure / Tidak pasti | 2 = No understanding / Tidak faham | 3 = Limited understanding / Fahaman terhad | 4 = Understand the importance / Faham tentang kepentingan | 5 = Understand and use it in life / Faham dan menggunakan dalam kehidupan
18. Which zone or activity felt most impactful and beneficial? / Zon manakah yang paling memberi kesan dan manfaat kepada anda?

Section D - After the Session / Selepas Sesi (same 1-5 scale as Section B)
19. Making this art helped me understand my deep feelings better. / Membuat seni ini membantu saya memahami perasaan mendalam saya dengan lebih baik. (1-5)
20. The art activity helped me see that I am valuable and strong, no matter what others say. / Aktiviti seni membantu saya melihat bahawa saya bernilai dan kuat, tidak kira apa kata orang lain. (1-5)
21. Putting my thoughts onto the paper helped my mind feel lighter and more at ease. / Meluahkan fikiran ke atas kertas membuatkan minda saya berasa lebih ringan dan tenang. (1-5)
22. After making art, my mind feels lighter, quiet, or peaceful. / Selepas berkarya, fikiran saya terasa ringan, sunyi, atau damai. (1-5)
23. Look at the art you made today. What did it teach you about your own strength or self-love? / Lihat seni yang anda hasilkan hari ini. Apakah yang ia ajarkan tentang kekuatan diri atau kasih sayang terhadap diri anda?
24. How did making art today change the way you look at yourself? ("Not sure" is okay) / Bagaimanakah seni hari ini mengubah cara anda melihat diri sendiri? ("Tidak pasti" pun boleh)

Section E - Feedback / Maklum Balas
25. How was your experience today at the Yayasan Selgate booth? / Bagaimana pengalaman anda di booth Yayasan Selgate hari ini? A = I love it, please do more! | B = I enjoy it | C = It was okay | D = I did not enjoy much | E = I do not enjoy it
26. (optional) Any suggestions or ideas to make future sessions even better? / Adakah anda mempunyai cadangan atau idea untuk menjadikan sesi akan datang lebih baik?

WHEN ALL QUESTIONS ARE ANSWERED:
Send a warm short thank-you in both languages, then append this machine-readable block at the very end of the same message (the participant will not see it):

<survey_complete>{"name":null,"age_group":"","gender":"","location":"","email":null,"phone":null,"creative_expression":"","community_role":"","pre_happy_safe":0,"pre_self_critical":0,"pre_self_worth":0,"pre_mind_heavy":0,"pre_mood":"","pre_heavy_feeling":"","personal_experience":"","emotions_while_creating":"","mental_health_understanding":0,"impactful_zone":"","post_understand_feelings":0,"post_self_worth":0,"post_mind_lighter":0,"post_mind_peaceful":0,"post_strength_lesson":"","post_self_view_change":"","booth_experience":"","suggestions":null}</survey_complete>

Fill every field with the participant's actual answers: null for skipped optional fields, plain integers 1-5 for scale fields, a single letter A-E for booth_experience. The block must be valid JSON on one line.`;

const ANALYSIS_PROMPT = `You analyse survey responses for a creative-expression mental health program. Given one participant's response as JSON, reply with a JSON object with exactly these fields:
{"sentiment":"positive|mixed|negative","wellbeing_shift":"improved|unchanged|declined|unknown","themes":["2 to 5 short theme keywords"],"summary":"2-3 sentence summary of this participant's experience and the program's impact on them","concern_flag":false,"concern_note":null}
Set concern_flag to true (with a short concern_note) only if the response suggests serious distress, self-harm risk, or a need for human follow-up. Reply with JSON only.`;

const INSIGHTS_PROMPT = `You analyse survey data for the Seni Scape creative-expression mental health program. You will receive an array of participant responses as JSON. Write a concise report (markdown, max ~300 words) covering: overall sentiment, measured impact (compare the pre-session feelings with the post-session art-experience scores), the most common themes in the open answers, which zones/activities were most impactful, and the top suggestions for improvement. Be concrete and quote numbers where useful.`;

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
    const content = await deepseek([
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
    ]);

    const match = content.match(/<survey_complete>([\s\S]*?)<\/survey_complete>/);
    let reply = content;
    let done = false;

    if (match) {
      done = true;
      reply =
        content.replace(match[0], "").trim() ||
        "Thank you for completing the survey! Terima kasih! \u{1F90D}";

      let surveyData = null;
      try {
        surveyData = JSON.parse(match[1]);
      } catch {
        surveyData = { parse_error: true, raw: match[1] };
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

    res.json({ reply, done });
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

const SCALE_FIELDS = {
  pre_happy_safe: "Pre: happy & safe to be myself",
  pre_self_critical: "Pre: hard on myself",
  pre_self_worth: "Pre: I know I am important",
  pre_mind_heavy: "Pre: mind heavy / stressed",
  mental_health_understanding: "Understanding of mental health link",
  post_understand_feelings: "Post: understood my feelings better",
  post_self_worth: "Post: I am valuable and strong",
  post_mind_lighter: "Post: mind lighter putting thoughts on paper",
  post_mind_peaceful: "Post: mind lighter / peaceful",
};

const CATEGORY_FIELDS = {
  age_group: "Age group",
  gender: "Gender",
  creative_expression: "Creative expression",
  community_role: "Community role",
  booth_experience: "Booth experience (A best - E worst)",
};

function computeStats(responses) {
  const datas = responses.map((r) => r.data).filter(Boolean);

  const averages = {};
  for (const [field, label] of Object.entries(SCALE_FIELDS)) {
    const nums = datas
      .map((d) => Number(d[field]))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
    averages[field] = {
      label,
      average: nums.length
        ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100
        : null,
      count: nums.length,
    };
  }

  const distributions = {};
  for (const [field, label] of Object.entries(CATEGORY_FIELDS)) {
    const counts = {};
    for (const d of datas) {
      const v = d[field];
      if (v === null || v === undefined || v === "") continue;
      const key = String(v);
      counts[key] = (counts[key] || 0) + 1;
    }
    distributions[field] = { label, counts };
  }

  const flagged = responses.filter(
    (r) => r.analysis && r.analysis.concern_flag
  ).length;

  return { total: responses.length, flagged, averages, distributions };
}

app.get("/api/admin/data", requireAdmin, async (req, res) => {
  try {
    const responses = await storage.loadResponses();
    res.json({ stats: computeStats(responses), responses });
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

module.exports = app;
