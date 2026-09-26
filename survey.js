// The questionnaire, as data rather than one long prompt string.
//
// Questions change between programmes and between phases, and previously that
// meant editing a ~40-line template literal and then hunting down every field
// name it implied across stats.js and the dashboards. Defining them here means
// question numbering, quick-reply buttons, the completion JSON template and the
// dashboard field labels are all generated from one place.
//
// Field names are the keys stored in `data`. Adding one needs no database
// migration - responses are stored as jsonb - but DO add a label in
// admin.html's FIELD_LABELS so it appears in the UI and the CSV export.

const SCALE_1_5 = [
  "1 - No, not at all / Tidak sama sekali",
  "2 - A little bit / Sedikit",
  "3 - In the middle / Sederhana",
  "4 - Yes, mostly / Ya, kebanyakannya",
  "5 - Yes, completely / Ya, sepenuhnya",
];

const SCALE_UNDERSTANDING = [
  "1 - Unsure / Tidak pasti",
  "2 - No understanding / Tidak faham",
  "3 - Limited understanding / Fahaman terhad",
  "4 - Understand the importance / Faham tentang kepentingan",
  "5 - Understand and use it in life / Faham dan menggunakan dalam kehidupan",
];

// Programmes offered. `id` is what gets stored in data.program and what the
// corporate dashboard filters on, so keep these stable once responses exist.
// The label is what the participant taps, in both languages.
const PROGRAMS = [
  { id: "seni-scape", label: "Seni Scape" },
  { id: "wip-harmoni-circle", label: "WIP Harmoni Circle" },
];

// ---- Section A: asked of everyone, in every programme ----
const SECTION_A = {
  title: "Section A - About You / Tentang Anda",
  questions: [
    { field: "name", optional: true, text: "Name or nickname / Nama atau nama samaran (anonymous is fine)" },
    { field: "age_group", text: "Age group / Golongan umur", options: ["Under 13", "13-17", "18-25", "26-40", "41-60", "60+"] },
    { field: "gender", text: "Gender / Jantina" },
    { field: "location", text: "Location / Lokasi (city or state / bandar atau negeri)" },
    { field: "email", optional: true, text: "Email address / Alamat emel" },
    { field: "phone", optional: true, text: "Phone number / Nombor telefon" },
    {
      field: "creative_expression",
      text: "Type of creative expression attended / Jenis ekspresi kreatif",
      options: ["Art & Craft", "Writing (Poetry/Journal/Zine)", "Movement (theatre/dance/somatic)", "Music expression", "Clay", "Photography", "Other"],
    },
    // Q8. The answer selects which programme-specific questions follow.
    {
      field: "program",
      text: "Which myWIPhealing program are you joining? / Program myWIPhealing manakah yang anda sertai?",
      options: PROGRAMS.map((p) => p.label),
      branch: true,
    },
    {
      field: "community_role",
      text: "Community role / Peranan masyarakat",
      options: ["Mental Health Fighter", "Caregiver", "Healthcare Professional", "Corporate Professional", "Community Leader", "Student", "Other"],
    },
  ],
};

// ---- Section B: before the session. Shared, so pre/post scores stay
// comparable across programmes. ----
const SECTION_B = {
  title: "Section B - Before the Session / Sebelum Sesi",
  questions: [
    { field: "pre_happy_safe", scale: SCALE_1_5, text: "Before the session, I felt happy and safe to be myself. / Sebelum sesi, saya berasa gembira dan selamat menjadi diri sendiri." },
    { field: "pre_self_critical", scale: SCALE_1_5, text: "When I make a mistake or feel bad, I am very hard on myself. / Apabila saya membuat kesilapan atau berasa sedih, saya sangat keras terhadap diri sendiri." },
    { field: "pre_self_worth", scale: SCALE_1_5, text: "I know that I am important, even if other people say mean things to me. / Saya tahu saya penting, walaupun orang lain berkata buruk tentang saya." },
    { field: "pre_mind_heavy", scale: SCALE_1_5, text: "Before the session, my mind felt heavy, busy, or stressed. / Sebelum sesi, fikiran saya terasa berat, sibuk, atau tertekan." },
    { field: "pre_mood", text: "In a few words, describe the feeling or mood you brought into the room today. / Gambarkan perasaan atau mood anda semasa masuk hari ini.", examples: ["Not sure / Tidak pasti", "Calm / Tenang", "Stressed / Tertekan"] },
    { field: "pre_heavy_feeling", text: 'What is one sad, angry, or heavy feeling you wanted to put onto the paper today? ("Not sure" is okay) / Apakah satu perasaan sedih, marah, atau berat yang anda mahu luahkan ke atas kertas hari ini? ("Tidak pasti" pun boleh)' },
  ],
};

// ---- Section C: the experience itself. The first three are shared; the
// closing question is programme-specific (see PROGRAM_QUESTIONS). ----
const SECTION_C_SHARED = [
  { field: "personal_experience", text: "How would you describe your personal creative expression during today's session? / Bagaimana anda mengekspresi diri secara kreatif sepanjang sesi hari ini?" },
  { field: "emotions_while_creating", text: "What emotions, thoughts, or memories came up for you while creating? / Apakah emosi, fikiran, atau kenangan yang muncul semasa anda berkarya?" },
  { field: "mental_health_understanding", scale: SCALE_UNDERSTANDING, text: "How could you relate this creative expression with mental health? / Bagaimanakah anda boleh kaitkan sesi ekspresi kreatif dengan fahaman kesihatan mental?" },
];

// ---- Section D: after the session. Shared. ----
const SECTION_D = {
  title: "Section D - After the Session / Selepas Sesi",
  questions: [
    { field: "post_understand_feelings", scale: SCALE_1_5, text: "Making this art helped me understand my deep feelings better. / Membuat seni ini membantu saya memahami perasaan mendalam saya dengan lebih baik." },
    { field: "post_self_worth", scale: SCALE_1_5, text: "The art activity helped me see that I am valuable and strong, no matter what others say. / Aktiviti seni membantu saya melihat bahawa saya bernilai dan kuat, tidak kira apa kata orang lain." },
    { field: "post_mind_lighter", scale: SCALE_1_5, text: "Putting my thoughts onto the paper helped my mind feel lighter and more at ease. / Meluahkan fikiran ke atas kertas membuatkan minda saya berasa lebih ringan dan tenang." },
    { field: "post_mind_peaceful", scale: SCALE_1_5, text: "After making art, my mind feels lighter, quiet, or peaceful. / Selepas berkarya, fikiran saya terasa ringan, sunyi, atau damai." },
    { field: "post_strength_lesson", text: "Look at the art you made today. What did it teach you about your own strength or self-love? / Lihat seni yang anda hasilkan hari ini. Apakah yang ia ajarkan tentang kekuatan diri atau kasih sayang terhadap diri anda?" },
    { field: "post_self_view_change", text: 'How did making art today change the way you look at yourself? ("Not sure" is okay) / Bagaimanakah seni hari ini mengubah cara anda melihat diri sendiri? ("Tidak pasti" pun boleh)' },
  ],
};

// ---- The bits that actually differ by programme ----
// Everything above is asked of everyone. These are appended to Section C and
// Section E respectively, based on the answer to Q8.
const PROGRAM_QUESTIONS = {
  "seni-scape": {
    sectionC: [
      { field: "impactful_zone", text: "Which zone or activity felt most impactful and beneficial? / Zon manakah yang paling memberi kesan dan manfaat kepada anda?" },
    ],
    sectionE: [
      {
        field: "booth_experience",
        text: "How was your experience today at the Yayasan Selgate booth? / Bagaimana pengalaman anda di booth Yayasan Selgate hari ini?",
        options: [
          "A - I love it, please do more!",
          "B - I enjoy it",
          "C - It was okay",
          "D - I did not enjoy much",
          "E - I do not enjoy it",
        ],
        note: "Store a single letter A-E.",
      },
    ],
  },
  "wip-harmoni-circle": {
    sectionC: [
      // Harmoni Circle's "Insight & Integration" question. Replaces the
      // booth-specific zone question with an open reflection.
      { field: "significant_moment", text: "What part of the session felt most significant or meaningful, and why? / Bahagian manakah dalam sesi ini yang terasa paling bermakna atau penting kepada anda, dan mengapa?" },
    ],
    sectionE: [],
  },
};

// ---- Section E: feedback. `suggestions` is shared by every programme. ----
const SECTION_E_SHARED = [
  { field: "suggestions", optional: true, text: "Do you have any suggestions or ideas for how we could make future sessions even better? / Adakah anda mempunyai cadangan atau idea untuk menjadikan sesi akan datang lebih baik?" },
];

// ---------- rendering ----------

function buttonsFor(q) {
  if (q.scale) return q.scale;
  if (q.options) return q.options;
  const base = q.examples || [];
  return q.optional ? [...base, "Skip / Langkau"] : base;
}

function renderQuestion(q, n) {
  const parts = [`${n}.${q.optional ? " (optional)" : ""} ${q.text}`];
  if (q.scale) parts.push(`   Scale: ${q.scale.join(" | ")}`);
  else if (q.options) parts.push(`   Options: ${q.options.join(" | ")}`);
  if (q.note) parts.push(`   ${q.note}`);
  const btns = buttonsFor(q);
  if (btns.length) parts.push(`   Buttons: <options>${JSON.stringify(btns)}</options>`);
  return parts.join("\n");
}

// All questions for one programme, in the order they are asked.
function questionsFor(programId) {
  const extra = PROGRAM_QUESTIONS[programId] || { sectionC: [], sectionE: [] };
  return [
    ...SECTION_A.questions,
    ...SECTION_B.questions,
    ...SECTION_C_SHARED,
    ...extra.sectionC,
    ...SECTION_D.questions,
    ...SECTION_E_SHARED,
    ...extra.sectionE,
  ];
}

// The <survey_complete> template for one programme: every field it asks,
// defaulted to the right empty value for its type.
function completionTemplate(programId) {
  const out = {};
  for (const q of questionsFor(programId)) {
    if (q.field === "program") out.program = programId;
    else if (q.scale) out[q.field] = 0;
    else if (q.optional) out[q.field] = null;
    else out[q.field] = "";
  }
  return JSON.stringify(out);
}

function renderProgramBranch(program) {
  const extra = PROGRAM_QUESTIONS[program.id] || { sectionC: [], sectionE: [] };
  const shared = SECTION_A.questions.length + SECTION_B.questions.length;
  const lines = [`>>> IF the participant chose "${program.label}":`];

  let n = shared + 1;
  lines.push("", "Section C - Your Experience / Pengalaman Anda");
  for (const q of [...SECTION_C_SHARED, ...extra.sectionC]) lines.push(renderQuestion(q, n++));

  lines.push("", `${SECTION_D.title} (1-5 scale as in Section B)`);
  for (const q of SECTION_D.questions) lines.push(renderQuestion(q, n++));

  lines.push("", "Section E - Feedback / Maklum Balas");
  for (const q of [...SECTION_E_SHARED, ...extra.sectionE]) lines.push(renderQuestion(q, n++));

  lines.push(
    "",
    `When every question above is answered, end with EXACTLY these fields:`,
    `<survey_complete>${completionTemplate(program.id)}</survey_complete>`
  );
  return lines.join("\n");
}

function buildSystemPrompt() {
  let n = 1;
  const sectionA = SECTION_A.questions.map((q) => renderQuestion(q, n++)).join("\n");
  const sectionB = SECTION_B.questions.map((q) => renderQuestion(q, n++)).join("\n");
  const branches = PROGRAMS.map(renderProgramBranch).join("\n\n");

  return `You are "Seni", a warm, gentle bilingual (English & Bahasa Malaysia) assistant running the myWIPhealing impact survey for Yayasan Selgate.

Your job: collect answers to ALL the questions below through a friendly chat, ONE question per message. Keep every message short. Always show the question in both English and Bahasa Malaysia.

Start with a short warm greeting: "Your voice matters / Suara anda bermakna" - honest feedback matters, they may remain anonymous, personal details are not compulsory. Then immediately ask Question 1.

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
- Each question below lists its exact buttons. Use them verbatim.
- Open questions with no listed buttons: offer 2-4 short example answers as inspiration; the participant can still type their own words.
- Keep button labels short. The block must be valid JSON. Never mention the buttons or the block in your text.
- ALWAYS append the block to a question, even if earlier assistant messages in this conversation appear to have none (the app hides them after sending).
- Do not include an options block in the final thank-you message.

QUESTIONS - ask these of EVERYONE, in this order:

${SECTION_A.title}
${sectionA}

${SECTION_B.title}
${sectionB}

BRANCHING - Question 8 decides what comes next.
After Question 8 the participant has named their programme. Continue with ONLY
that programme's questions below, and ignore the other branches completely.
Never mention branching, other programmes, or that questions differ.

${branches}

WHEN ALL QUESTIONS FOR THE CHOSEN PROGRAMME ARE ANSWERED:
Send a warm short thank-you in both languages, then append that programme's machine-readable block at the very end of the same message (the participant will not see it).
Fill every field with the participant's actual answers: null for skipped optional fields, plain integers 1-5 for scale fields. The "program" field must keep the exact id shown in the template. The block must be valid JSON on one line.`;
}

// Field -> human label, for the admin table and CSV export. Generated so a new
// question cannot be silently missing from the dashboard.
function fieldLabels() {
  const seen = {};
  const pretty = (f) => f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  for (const p of PROGRAMS) for (const q of questionsFor(p.id)) if (!seen[q.field]) seen[q.field] = q.label || pretty(q.field);
  return seen;
}

// Every field any programme can produce.
function allFields() {
  return Object.keys(fieldLabels());
}

module.exports = {
  PROGRAMS,
  PROGRAM_QUESTIONS,
  SCALE_1_5,
  SCALE_UNDERSTANDING,
  buildSystemPrompt,
  questionsFor,
  completionTemplate,
  fieldLabels,
  allFields,
};
