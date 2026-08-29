// The questionnaire, as data rather than one long prompt string.
//
// Questions change between programmes and between phases, and previously that
// meant editing a ~70-line template literal and then hunting down every field
// name it implied across stats.js and the dashboards. Defining them here means
// question numbering, quick-reply buttons, the completion JSON template and the
// dashboard field labels are all generated from one place.
//
// Field names are the keys stored in `data`. Adding one needs no database
// migration - responses are stored as jsonb - and the admin table and CSV
// export pick it up automatically.

const SCALE_AGREE = [
  "1 - Strongly disagree / Sangat tidak setuju",
  "2 - Disagree / Tidak setuju",
  "3 - Neutral / Berkecuali",
  "4 - Agree / Setuju",
  "5 - Strongly agree / Sangat setuju",
];

const SCALE_EFFECTIVE = [
  "1 - Not effective / Tidak berkesan",
  "2 - Slightly / Sedikit",
  "3 - Moderately / Sederhana",
  "4 - Very / Sangat",
  "5 - Extremely / Amat sangat",
];

// Programmes offered. `id` is stored in data.program and is what the corporate
// dashboard filters on, so keep these stable once responses exist. `label` is
// what the participant taps.
const PROGRAMS = [
  { id: "wip-harmoni-circle", label: "WIP Harmoni Circle" },
  { id: "wip-seni-scape", label: "WIP Seni Scape" },
  { id: "art-of-healing-festival", label: "Art of Healing Festival" },
  { id: "wip-nadi-workshop", label: "WIP Nadi Workshop" },
  { id: "wip-rantau-retreat", label: "WIP Rantau Retreat" },
  { id: "other", label: "Other" },
];

// ---- Section A: about you ----
const SECTION_A = {
  title: "Section A - About You / Tentang Anda (quick!)",
  questions: [
    { field: "name", optional: true, text: "Name or nickname / Nama atau nama samaran" },
    { field: "age_group", text: "Age group / Golongan umur", options: ["Under 13", "13-17", "18-25", "26-40", "41-60", "60+"] },
    { field: "gender", text: "Gender / Jantina", options: ["Female / Perempuan", "Male / Lelaki", "Prefer not to say / Pilih untuk tidak menyatakan"] },
    { field: "location", text: "Location (city/state) / Lokasi (bandar/negeri)" },
    { field: "email", optional: true, text: "Email / Alamat emel" },
    { field: "phone", optional: true, text: "Phone / Nombor telefon" },
    { field: "community_role", text: "Community role / Peranan", options: ["Mental Health Fighter", "Caregiver", "Healthcare Professional", "Corporate Professional", "Community Leader", "Student", "Other"] },
  ],
};

// ---- Section B: which programme. The answer selects Section F below. ----
const SECTION_B = {
  title: "Section B - Program / Program",
  questions: [
    { field: "program", text: "Which myWIPhealing program? / Program myWIPhealing manakah?", options: PROGRAMS.map((p) => p.label), branch: true },
  ],
};

// ---- Sections C and D: the matched pre/post battery. Identical wording on
// both sides so the before/after comparison is like-for-like. Shared by every
// programme - this is what keeps scores comparable across them. ----
const MATCHED_ITEMS = [
  { key: "happy_safe", text: "I feel happy and safe to be myself. / Saya berasa gembira dan selamat menjadi diri sendiri." },
  { key: "self_kind", text: "I am kind to myself when I make mistakes. / Saya bersikap baik terhadap diri sendiri apabila membuat kesilapan." },
  { key: "self_worth", text: "I know that I am important. / Saya tahu saya penting." },
  { key: "mind_calm", text: "My mind feels calm and at ease. / Fikiran saya berasa tenang dan tenteram." },
  { key: "social_connection", text: "I have people I can talk to when I need support. / Saya mempunyai orang yang boleh saya berbual apabila memerlukan sokongan." },
];

const SECTION_C = {
  title: "Section C - \u{1F7E1} BEFORE / SEBELUM (Scale: 1=Strongly disagree to 5=Strongly agree)",
  intro: '\u{1F7E1} "Before we begin - how are you feeling right now? / Sebelum mula - bagaimana perasaan anda sekarang?"',
  questions: [
    ...MATCHED_ITEMS.map((i) => ({ field: `pre_${i.key}`, scale: SCALE_AGREE, text: i.text })),
    { field: "pre_mood", text: "In a few words, how would you describe your mood right now? / Gambarkan mood anda sekarang dalam beberapa perkataan.", examples: ["Calm / Tenang", "Tired / Penat", "Stressed / Tertekan"] },
  ],
};

const SECTION_D = {
  title: "Section D - \u{1F535} AFTER / SELEPAS (Same 5 questions for direct comparison!)",
  intro: '\u{1F535} "Now that the session is complete - let\'s check in again! / Sekarang sesi telah selesai - mari kita semak semula!"',
  questions: MATCHED_ITEMS.map((i) => ({ field: `post_${i.key}`, scale: SCALE_AGREE, text: i.text })),
};

// ---- Section E: programme impact. Shared. ----
const SECTION_E = {
  title: "Section E - Program Impact / Impak Program",
  questions: [
    { field: "program_effectiveness", scale: SCALE_EFFECTIVE, text: "How effective was this program? / Berkesankah program ini?" },
    {
      field: "would_recommend",
      text: "How likely are you to recommend this program? / Berapa kemungkinan anda mengesyorkan program ini? (0-10)",
      options: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
      note: "Store a plain integer 0-10.",
    },
    {
      field: "program_experience",
      text: "Overall experience? / Pengalaman keseluruhan?",
      options: ["A - Love it", "B - Enjoy", "C - Okay", "D - Not much", "E - Didn't enjoy"],
      note: "Store a single letter A-E.",
    },
  ],
};

// ---- Section F: reflection. THIS is the part that differs by programme.
// Everything above is asked of everyone. ----
const SECTION_F_TITLE = "Section F - Reflection / Refleksi";

// What every programme except those listed in PROGRAM_REFLECTION gets.
const DEFAULT_REFLECTION = [
  { field: "post_strength_lesson", text: "What did you learn about yourself today? / Apakah yang anda pelajari tentang diri anda hari ini?" },
];

// Programme-specific reflection blocks. WIP Harmoni Circle runs a guided
// reflection (Personal Experience / Emotional & Cognitive Awareness / Insight
// & Integration) in place of the single generic learning question.
const PROGRAM_REFLECTION = {
  "wip-harmoni-circle": [
    { field: "personal_experience", text: "How would you describe your personal creative expression during today's session? / Bagaimana anda mengekspresi diri secara kreatif sepanjang sesi hari ini?" },
    { field: "emotions_while_creating", text: "What emotions, thoughts, or memories came up for you while creating? / Apakah emosi, fikiran, atau kenangan yang muncul semasa anda berkarya?" },
    { field: "significant_moment", text: "What part of the session felt most significant or meaningful, and why? / Bahagian manakah dalam sesi ini yang terasa paling bermakna atau penting kepada anda, dan mengapa?" },
  ],
};

// Asked of everyone, after whichever reflection block applies.
const SECTION_F_SHARED = [
  { field: "suggestions", optional: true, text: "Do you have any suggestions or ideas for how we could make future sessions even better? / Adakah anda mempunyai cadangan atau idea untuk menjadikan sesi akan datang lebih baik?" },
];

function reflectionFor(programId) {
  return [...(PROGRAM_REFLECTION[programId] || DEFAULT_REFLECTION), ...SECTION_F_SHARED];
}

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

function renderSection(sec, start) {
  const lines = [sec.title];
  if (sec.intro) lines.push(sec.intro);
  let n = start;
  for (const q of sec.questions) lines.push(renderQuestion(q, n++));
  return { text: lines.join("\n"), next: n };
}

// All questions for one programme, in the order they are asked.
function questionsFor(programId) {
  return [
    ...SECTION_A.questions,
    ...SECTION_B.questions,
    ...SECTION_C.questions,
    ...SECTION_D.questions,
    ...SECTION_E.questions,
    ...reflectionFor(programId),
  ];
}

// The <survey_complete> template for one programme.
function completionTemplate(programId) {
  const out = {};
  for (const q of questionsFor(programId)) {
    if (q.field === "program") out.program = programId;
    else if (q.scale || q.field === "would_recommend") out[q.field] = 0;
    else if (q.optional) out[q.field] = null;
    else out[q.field] = "";
  }
  return JSON.stringify(out);
}

function buildSystemPrompt() {
  const a = renderSection(SECTION_A, 1);
  const b = renderSection(SECTION_B, a.next);
  const c = renderSection(SECTION_C, b.next);
  const d = renderSection(SECTION_D, c.next);
  const e = renderSection(SECTION_E, d.next);

  // Section F is rendered once per distinct reflection block.
  const harmoni = PROGRAMS.find((p) => PROGRAM_REFLECTION[p.id]);
  const others = PROGRAMS.filter((p) => !PROGRAM_REFLECTION[p.id]);

  const branchLines = [];
  for (const p of PROGRAMS.filter((x) => PROGRAM_REFLECTION[x.id])) {
    let n = e.next;
    branchLines.push(
      `>>> IF the participant chose "${p.label}":`,
      ...reflectionFor(p.id).map((q) => renderQuestion(q, n++)),
      "",
      `When answered, end with EXACTLY these fields:`,
      `<survey_complete>${completionTemplate(p.id)}</survey_complete>`,
      ""
    );
  }
  // The remaining programmes share one reflection block, so they share one
  // template. Its program field is a placeholder rather than a real id: a
  // concrete id here gets copied verbatim and silently mislabels the response,
  // and unlike a label/id mismatch a wrong id cannot be recovered later.
  let n = e.next;
  const otherTemplate = completionTemplate(others[0].id).replace(
    `"program":"${others[0].id}"`,
    '"program":"<PROGRAM_ID>"'
  );
  branchLines.push(
    `>>> IF the participant chose any OTHER programme (${others.map((p) => p.label).join(", ")}):`,
    ...reflectionFor(others[0].id).map((q) => renderQuestion(q, n++)),
    "",
    `When answered, end with EXACTLY these fields. Replace <PROGRAM_ID> (keeping the quotes) with the id for the programme they actually chose:`,
    ...others.map((p) => `   ${p.label} -> ${p.id}`),
    `<survey_complete>${otherTemplate}</survey_complete>`
  );

  return `You are "Seni", a warm, gentle bilingual (English & Bahasa Malaysia) assistant for the myWIPhealing Community Health Survey.

Your job: guide participants through a friendly chat survey - ONE short question per message. Always show both languages. Keep messages brief and warm.

OPENING GREETING (message 1 only):
"Konnichiwa! Welcome to myWIPhealing ✨

Your voice matters / Suara anda bermakna. This quick check-in helps us understand how our creative expression programs support your wellbeing. You may stay anonymous - only share what you're comfortable with.

Let's begin! / Mari mula!"

Then ask Question 1 immediately.

SECTION TRANSITIONS - use these exact phrases so participants know where they are:
- Before Section C: "\u{1F7E1} BEFORE THE PROGRAM / SEBELUM PROGRAM - Let's check in on how you're feeling right now."
- Before Section D: "\u{1F535} AFTER THE PROGRAM / SELEPAS PROGRAM - Now let's see how you're feeling after the session. Same questions so we can compare!"
- Before final: "\u{1F389} Almost done! / Hampir selesai!"

Rules:
- One question per message. Both languages. Short.
- Accept free-text and map to closest option/number. Words count ("four", "empat").
- Optional questions may be skipped -> record null. Never pressure for personal details.
- Unclear answer? Ask once to clarify, then accept whatever they give.
- No advice, diagnoses, or therapy. Distress? One short empathetic sentence, then continue.
- Stay on survey. Decline off-topic requests politely.

QUICK-REPLY BUTTONS:
Every question MUST end with a hidden options block: <options>["Btn1","Btn2"]</options>
- Each question below lists its exact buttons. Use them verbatim.
- Open questions with no listed buttons: 2-4 short examples as inspiration.
- Keep labels short. Valid JSON. Never mention buttons in text.
- ALWAYS append block to every question.
- No options block in final thank-you.

QUESTIONS - ask these of EVERYONE, in this order:

${a.text}

${b.text}

${c.text}

${d.text}

${e.text}

BRANCHING - Question ${SECTION_A.questions.length + 1} decides the final section.
The participant has named their programme. Ask ONLY that programme's reflection
questions below, and ignore the other branch completely. Never mention
branching, other programmes, or that questions differ.

${SECTION_F_TITLE}

${branchLines.join("\n")}

WHEN THE CHOSEN BRANCH IS COMPLETE:
Send the final message in both languages:
"Thank you for sharing your voice with us! / Terima kasih kerana berkongsi suara anda dengan kami! \u{1F331}
Every response helps us grow our healing community. / Setiap maklum balas membantu kami membesarkan komuniti penyembuhan."

Then append that branch's machine-readable block at the very end of the same message (the participant will NOT see it).
Fill every field with the participant's actual answers: null for skipped optional fields, plain integers for scale fields, a single letter A-E for program_experience. The "program" field must be the exact id for the programme they chose. The block must be valid JSON on one line.`;
}

// Field -> human label, for the admin table and CSV export. Generated so a new
// question cannot be silently missing from the dashboard.
function fieldLabels() {
  const seen = {};
  const pretty = (f) => f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  for (const p of PROGRAMS) for (const q of questionsFor(p.id)) if (!seen[q.field]) seen[q.field] = q.label || pretty(q.field);
  return seen;
}

function allFields() {
  return Object.keys(fieldLabels());
}

module.exports = {
  PROGRAMS,
  PROGRAM_REFLECTION,
  MATCHED_ITEMS,
  SCALE_AGREE,
  buildSystemPrompt,
  questionsFor,
  completionTemplate,
  fieldLabels,
  allFields,
};
