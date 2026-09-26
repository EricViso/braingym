// Emotion reading for the survey chat, powered by TypeSafe's Jev model
// (https://docs.typesafe.ai). Each participant message gets one Jev request
// that asks, in parallel, how strongly each core emotion is present and which
// feeling on the emotion wheel fits best. The page accumulates those answers
// into a heatmap over the wheel as the conversation goes on.
//
// The wheel below is the single source of truth: the server builds Jev's
// questions from it and the page draws the wheel from it (GET /api/emotion/wheel),
// so a relabelled wedge can never desync the heatmap from the model's options.

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.TYPESAFE_MODEL || "jev-latest";

// Transcribed from the Junto Institute "Emotion & Feeling Wheel", in clockwise
// order starting from Anger at the top. Each middle feeling has two outer ones.
const WHEEL = [
  { core: "Anger", color: "#F08DB4", feelings: [
    ["Rage", ["Hate", "Hostile"]],
    ["Exasperated", ["Agitated", "Frustrated"]],
    ["Irritable", ["Annoyed", "Aggravated"]],
    ["Envy", ["Resentful", "Jealous"]],
    ["Disgust", ["Contempt", "Revolted"]],
  ]},
  { core: "Sadness", color: "#AEB4E2", feelings: [
    ["Suffering", ["Agony", "Hurt"]],
    ["Sadness", ["Depressed", "Sorrow"]],
    ["Disappointed", ["Dismayed", "Displeased"]],
    ["Shameful", ["Regretful", "Guilty"]],
    ["Neglected", ["Isolated", "Lonely"]],
    ["Despair", ["Grief", "Powerless"]],
  ]},
  { core: "Surprise", color: "#A6DDE3", feelings: [
    ["Stunned", ["Shocked", "Dismayed"]],
    ["Confused", ["Disillusioned", "Perplexed"]],
    ["Amazed", ["Astonished", "Awe-struck"]],
    ["Overcome", ["Speechless", "Astounded"]],
    ["Moved", ["Stimulated", "Touched"]],
  ]},
  { core: "Joy", color: "#B5DE98", feelings: [
    ["Content", ["Pleased", "Satisfied"]],
    ["Happy", ["Amused", "Delighted"]],
    ["Cheerful", ["Jovial", "Blissful"]],
    ["Proud", ["Triumphant", "Illustrious"]],
    ["Optimistic", ["Eager", "Hopeful"]],
    ["Enthusiastic", ["Excited", "Zeal"]],
    ["Elation", ["Euphoric", "Jubilation"]],
    ["Enthralled", ["Enchanted", "Rapture"]],
  ]},
  { core: "Love", color: "#F3E98C", feelings: [
    ["Affectionate", ["Romantic", "Fondness"]],
    ["Longing", ["Sentimental", "Attracted"]],
    ["Desire", ["Passion", "Infatuation"]],
    ["Tenderness", ["Caring", "Compassionate"]],
    ["Peaceful", ["Relieved", "Satisfied"]],
  ]},
  { core: "Fear", color: "#F8A98C", feelings: [
    ["Scared", ["Frightened", "Helpless"]],
    ["Terror", ["Panic", "Hysterical"]],
    ["Insecure", ["Inferior", "Inadequate"]],
    ["Nervous", ["Worried", "Anxious"]],
    ["Horror", ["Mortified", "Dread"]],
  ]},
];

const NONE = "No clear emotion";

// Flat, addressable lists. Choice option keys must be unique, and two outer
// words appear twice on the wheel (Satisfied, Dismayed), so an outer key gets
// its middle feeling appended only when the bare word would collide.
function flatten() {
  const middle = [];
  const outer = [];
  const seen = new Map();
  for (const w of WHEEL) for (const [, leaves] of w.feelings) {
    for (const leaf of leaves) seen.set(leaf, (seen.get(leaf) || 0) + 1);
  }
  WHEEL.forEach((w, ci) => {
    for (const [mid, leaves] of w.feelings) {
      const mi = middle.length;
      middle.push({ key: mid, label: mid, core: ci });
      for (const leaf of leaves) {
        const key = seen.get(leaf) > 1 ? `${leaf} (${mid.toLowerCase()})` : leaf;
        outer.push({ key, label: leaf, core: ci, middle: mi });
      }
    }
  });
  return { middle, outer };
}

const FLAT = flatten();

// ---------- the questions ----------

function coreId(core) {
  return "core_" + core.toLowerCase();
}

function buildQuestions() {
  const questions = {};

  for (const w of WHEEL) {
    const examples = w.feelings.map(([m]) => m.toLowerCase()).join(", ");
    questions[coreId(w.core)] = {
      type: "noul",
      instructions:
        `Does \`participant_message\` show the participant feeling ${w.core.toLowerCase()} ` +
        `(for example: ${examples})? Count feelings they express in how they write and ` +
        `feelings they report having, now or earlier. Do not count feelings of other people, ` +
        `and use \`recent_conversation\` only to understand what the message is answering.`,
      criteria: {
        true: `The participant's own ${w.core.toLowerCase()} is expressed or reported`,
        false: `No ${w.core.toLowerCase()} from the participant is present`,
      },
    };
  }

  const middleCriteria = { [NONE]: "Neutral, factual or purely logistical; no feeling is expressed" };
  for (const m of FLAT.middle) {
    const leaves = FLAT.outer.filter((o) => o.middle === FLAT.middle.indexOf(m)).map((o) => o.label.toLowerCase());
    middleCriteria[m.key] = `${WHEEL[m.core].core} family; includes ${leaves.join(" and ")}`;
  }
  questions.feeling = {
    type: "choice",
    instructions:
      "Which feeling best describes what the participant expresses or reports in `participant_message`?",
    criteria: middleCriteria,
  };

  const outerCriteria = { [NONE]: "Neutral, factual or purely logistical; no feeling is expressed" };
  for (const o of FLAT.outer) {
    outerCriteria[o.key] = `${WHEEL[o.core].core} > ${FLAT.middle[o.middle].label}`;
  }
  questions.feeling_specific = {
    type: "choice",
    instructions:
      "Which specific feeling word best matches what the participant expresses or reports in `participant_message`?",
    criteria: outerCriteria,
  };

  questions.intensity = {
    type: "score",
    instructions: "How emotionally intense is `participant_message`?",
    criteria: [
      "No emotion: a neutral, factual or one-tap answer",
      "Mild: a feeling is present but understated",
      "Clear: the feeling is plainly expressed",
      "Strong: vivid, charged or deeply felt",
    ],
  };

  return questions;
}

const QUESTIONS = buildQuestions();

// Survey bot turns carry hidden <options>/<survey_complete> blocks; Jev only
// needs the words a person would see.
function visibleText(s) {
  return String(s || "")
    .replace(/<survey_complete>[\s\S]*?<\/survey_complete>/g, "")
    .replace(/<options>[\s\S]*?<\/options>/g, "")
    .trim()
    .slice(0, 1200);
}

function buildState(message, context) {
  return {
    setting:
      "A participant is answering a wellbeing impact survey after a creative-expression " +
      "mental health workshop, chatting with a survey bot called Seni. They may write in " +
      "English or Bahasa Malaysia. Short answers like '4 - Good' are quick-reply buttons they tapped.",
    recent_conversation: (Array.isArray(context) ? context : [])
      .slice(-6)
      .map((m) => ({
        speaker: m && m.role === "user" ? "participant" : "Seni",
        text: visibleText(m && m.content),
      }))
      .filter((m) => m.text),
    participant_message: String(message).slice(0, 4000),
  };
}

// ---------- the call ----------

async function analyze(message, context) {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw Object.assign(new Error("TYPESAFE_API_KEY is not set"), { status: 503 });

  const body = JSON.stringify({ model: MODEL, state: buildState(message, context), questions: QUESTIONS });
  const started = Date.now();
  let res;
  // 429 and 529 are TypeSafe's "back off and retry" statuses.
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body,
    });
    if (res.status !== 429 && res.status !== 529) break;
    await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`TypeSafe API error ${res.status}: ${text.slice(0, 300)}`), { status: 502 });
  }
  const data = await res.json();
  const a = data.answers || {};

  // Re-key everything by wheel position so the page never has to parse
  // option labels back into wedges.
  const core = WHEEL.map((w) => (a[coreId(w.core)] ? a[coreId(w.core)].noul : 0));
  const pick = (answer, list) => ({
    probs: list.map((item) => (answer && answer.probabilities ? answer.probabilities[item.key] || 0 : 0)),
    none: answer && answer.probabilities ? answer.probabilities[NONE] || 0 : 0,
    choice: answer ? answer.choice : null,
    confidence: answer ? answer.confidence : null,
  });

  return {
    model: data.model,
    usage: data.usage,
    ms: Date.now() - started,
    core,
    middle: pick(a.feeling, FLAT.middle),
    outer: pick(a.feeling_specific, FLAT.outer),
    intensity: a.intensity
      ? { score: a.intensity.score, max: QUESTIONS.intensity.criteria.length - 1, confidence: a.intensity.confidence }
      : null,
    raw: data,
  };
}

// What the page needs to draw the wheel.
function wheel() {
  return {
    core: WHEEL.map((w) => ({ label: w.core, color: w.color })),
    middle: FLAT.middle.map(({ label, core }) => ({ label, core })),
    outer: FLAT.outer.map(({ label, core, middle }) => ({ label, core, middle })),
  };
}

module.exports = {
  enabled: () => Boolean(process.env.TYPESAFE_API_KEY),
  analyze,
  wheel,
  QUESTIONS,
};
