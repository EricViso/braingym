// Aggregation layer over stored survey responses.
// Pure functions: every export takes the array returned by storage.loadResponses()
// and returns plain JSON. No I/O, no new storage shape.
//
// Honesty note: metrics the single-session booth survey does not collect
// (NPS, attendance/engagement, sleep, work-focus, per-company before/after)
// are returned as null and rendered by the UI as "Phase 2" placeholders —
// never as fabricated numbers.

const survey = require("./survey");
const impact = require("./impact");

// Matched 1-5 scale fields and their human labels (used by the admin view).
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
  program: "Programme",
  age_group: "Age group",
  gender: "Gender",
  creative_expression: "Creative expression",
  community_role: "Community role",
  booth_experience: "Session experience (A best - E worst)",
};

// Open-text answers eligible to become a public testimonial. Shared by the
// server-side validator and the admin UI so the two cannot disagree.
const QUOTE_FIELDS = [
  "post_strength_lesson",
  "post_self_view_change",
  "personal_experience",
  "emotions_while_creating",
  "significant_moment",
  "suggestions",
  "pre_mood",
];

// Questions each programme asks register themselves here, so a programme's
// own scales, choices and reflections reach the dashboards without this file
// being edited each time.
for (const q of survey.programQuestions()) {
  const label = q.label || q.field;
  if (q.scale && q.label && !SCALE_FIELDS[q.field]) SCALE_FIELDS[q.field] = label;
  if (q.category && !CATEGORY_FIELDS[q.field]) CATEGORY_FIELDS[q.field] = label;
  if (q.quote && !QUOTE_FIELDS.includes(q.field)) QUOTE_FIELDS.push(q.field);
}

// Tick-all-that-apply answers, stored as one comma-separated value.
const MULTI_FIELDS = new Set(survey.programQuestions().filter((q) => q.multi).map((q) => q.field));

// The four positive post-session scales that compose the Wellbeing Index.
const WELLBEING_POST = [
  "post_understand_feelings",
  "post_self_worth",
  "post_mind_lighter",
  "post_mind_peaceful",
];

// Field-name history: every stored response predates the questionnaire
// refactor, so the DB holds the old scale names (pre_self_kind, pre_mind_calm,
// post_mind_calm) while the current schema asks the same constructs as
// pre_self_critical, pre_mind_heavy and post_mind_peaceful. calm↔heavy and
// kind↔critical run in opposite directions, so their 1-5 values are inverted
// (6 - n); post "calm" lines up with "peaceful" as-is. Reading both names keeps
// the historical data in the dashboards instead of dropping it.
const LEGACY_SCALE_FIELDS = {
  pre_self_critical: (d) => invert5(d.pre_self_kind),
  pre_mind_heavy: (d) => invert5(d.pre_mind_calm),
  post_mind_peaceful: (d) => asNumber(d.post_mind_calm),
};
function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function invert5(v) {
  const n = asNumber(v);
  return n === null ? null : 6 - n;
}
// Current field first; legacy name only when the current one has no value.
function resolveScale(d, field) {
  const raw = d[field];
  if (raw !== null && raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  const legacy = LEGACY_SCALE_FIELDS[field];
  return legacy ? legacy(d) : null;
}

// Programme identity. Responses collected before this refactor stored the
// programme's display label ("WIP Harmoni Circle"); new ones store the stable
// id ("wip-harmoni-circle"). Both normalise to the id here so imported
// historical rows keep matching the filters instead of silently dropping out.
const PROGRAM_KEYS = new Map();
for (const p of survey.PROGRAMS) {
  PROGRAM_KEYS.set(p.id.toLowerCase(), p.id);
  PROGRAM_KEYS.set(p.label.toLowerCase(), p.id);
  for (const alias of p.aliases || []) PROGRAM_KEYS.set(alias.toLowerCase(), p.id);
}
function programId(value) {
  if (value === null || value === undefined || value === "") return null;
  const k = String(value).trim().toLowerCase();
  return PROGRAM_KEYS.get(k) || String(value).trim();
}

// ---------- small helpers ----------

const round2 = (n) => Math.round(n * 100) / 100;

function avg(nums) {
  const xs = nums.filter((n) => Number.isFinite(n));
  return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

// Valid 1-5 values for one field across a list of `data` objects. Falls back
// to the pre-refactor field name before giving up on a response.
function scaleVals(datas, field) {
  return datas
    .map((d) => resolveScale(d, field))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
}

// Mean of several scale fields within a single response (equal participant
// weight); legacy-named answers count the same as current ones.
function rowScaleAvg(d, fields) {
  const nums = fields
    .map((f) => resolveScale(d, f))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function distribution(datas, field) {
  const counts = {};
  for (const d of datas) {
    const v = field === "program" ? programId(d[field]) : d[field];
    if (v === null || v === undefined || v === "") continue;
    // A tick-all-that-apply answer counts once under each thing ticked.
    const keys = MULTI_FIELDS.has(field)
      ? (Array.isArray(v) ? v : String(v).split(",")).map((k) => String(k).trim()).filter(Boolean)
      : [String(v)];
    for (const key of keys) counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

// Booth-style experience rating: the current questionnaire stores it as
// booth_experience, the imported historical rows as program_experience. Same
// A-E answer either way.
function boothDistribution(datas) {
  const counts = {};
  for (const d of datas) {
    const v = d.booth_experience || d.program_experience;
    if (v === null || v === undefined || v === "") continue;
    const key = String(v);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sentimentSplit(responses) {
  const s = { positive: 0, mixed: 0, negative: 0 };
  for (const r of responses) {
    const v = r.analysis && r.analysis.sentiment;
    if (v && s[v] !== undefined) s[v]++;
  }
  return s;
}

// Only quotes an admin has explicitly approved (consent gate). Never raw text.
function approvedTestimonials(responses) {
  return responses
    .filter((r) => r.approvedQuote && r.data)
    .map((r) => ({
      text: (r.approvedQuote.text || r.data[r.approvedQuote.field] || "").trim(),
      author: r.approvedQuote.author || "Participant",
    }))
    .filter((t) => t.text);
}

// ---------- admin: full stats (kept compatible with the old computeStats) ----------

function computeStats(responses) {
  const datas = responses.map((r) => r.data).filter(Boolean);

  const averages = {};
  for (const [field, label] of Object.entries(SCALE_FIELDS)) {
    const nums = scaleVals(datas, field);
    averages[field] = { label, average: avg(nums), count: nums.length };
  }

  const distributions = {};
  for (const [field, label] of Object.entries(CATEGORY_FIELDS)) {
    distributions[field] = { label, counts: distribution(datas, field) };
  }

  const flagged = responses.filter(
    (r) => r.analysis && r.analysis.concern_flag
  ).length;

  // Scale averages recomputed within each programme. Programmes share the
  // pre/post batteries but not every question, so a pooled average can hide a
  // difference that only exists in one of them.
  const byProgram = {};
  for (const p of survey.PROGRAMS) {
    const rows = datas.filter((d) => programId(d.program) === p.id);
    if (!rows.length) continue;
    const avgs = {};
    for (const [field, label] of Object.entries(SCALE_FIELDS)) {
      const nums = scaleVals(rows, field);
      if (nums.length) avgs[field] = { label, average: avg(nums), count: nums.length };
    }
    byProgram[p.id] = { label: p.label, count: rows.length, averages: avgs };
  }

  // Responses collected before the programme question existed.
  const unattributed = datas.filter((d) => !d.program).length;

  return {
    total: responses.length,
    flagged,
    averages,
    distributions,
    byProgram,
    unattributed,
  };
}

// ---------- per-programme panels (public, aggregate only) ----------

// A sensitive breakdown is held back until this many people have answered it,
// so a public chart can never point at one or two individuals.
const MIN_N = 5;

function publicLabel(q) {
  const label = q.label || SCALE_FIELDS[q.field] || CATEGORY_FIELDS[q.field] || q.text.split(" / ")[0];
  return label.replace(/^(Seni Scape |Circle: |Healing: )/, "").replace(/ \(you can choose more than one\)/, "");
}

// The stored answer to a choice question. The session-experience rating also
// lives under its pre-refactor name on imported rows.
function choiceValue(d, field) {
  const raw = field === "booth_experience" ? d.booth_experience || d.program_experience : d[field];
  if (raw === null || raw === undefined || raw === "") return null;
  return (Array.isArray(raw) ? raw.join(", ") : String(raw)).trim();
}

// Answers to a choice question, in the order the options are asked. A stored
// value counts under every option it names: the English half of the option,
// its leading letter ("A"), or - for zones, whose names have changed between
// events - its zone number. Older responses hold several choices in one
// value, so this matches inside the value rather than splitting it. A value
// naming no option (a typed "Other") is pooled.
function optionCounts(q, datas) {
  const opts = q.options.map((opt) => {
    const en = opt.split(" / ")[0].trim();
    return {
      en,
      letter: (en.match(/^([A-Z]) - /) || [])[1],
      zone: (en.match(/^Zone (\d)/) || [])[1],
      count: 0,
    };
  });
  let other = 0;
  let n = 0;
  for (const d of datas) {
    const v = choiceValue(d, q.field);
    if (v === null) continue;
    n++;
    const zones = new Set((v.match(/Zone\s*[\d\s&]+/g) || []).join(" ").match(/\d/g) || []);
    const hits = opts.filter((o) => (o.letter && v === o.letter) || v.includes(o.en) || (o.zone && zones.has(o.zone)));
    if (hits.length) for (const o of hits) o.count++;
    else other++;
  }
  const items = opts.map((o) => ({ label: o.letter ? o.en.replace(/^[A-Z] - /, "") : o.en, count: o.count }));
  if (other) {
    const slot = items.find((i) => /^other$/i.test(i.label));
    if (slot) slot.count += other;
    else items.push({ label: "Other", count: other });
  }
  return { n, items };
}

// A few short points per programme, written from its own numbers, so a reader
// gets the story before the charts. One fact per point, so it scans easily.
// Only states what the data shows.
function narrative(p) {
  if (!p.count) return ["No responses yet for this programme."];
  const parts = [`${p.count} ${p.count === 1 ? "person has" : "people have"} completed this survey.`];
  const worth = p.shift.find((s) => s.before !== null && s.after !== null);
  if (worth) parts.push(`${worth.label.replace(/ \(.*/, "")} moved from ${worth.before} before the session to ${worth.after} after (out of 5).`);
  const rated = p.groups.flatMap((g) => g.items).filter((i) => !/^Pre: /.test(i.label));
  if (rated.length > 1) {
    const top = rated.slice().sort((a, b) => b.average - a.average)[0];
    const low = rated.slice().sort((a, b) => a.average - b.average)[0];
    parts.push(
      top.average === low.average
        ? `Every rated statement averages ${top.average} / 5.`
        : `Highest rated: "${top.label}", at ${top.average} out of 5.`
    );
    if (top.average !== low.average) parts.push(`Lowest rated: "${low.label}", at ${low.average} out of 5.`);
  } else if (rated.length === 1) {
    parts.push(`"${rated[0].label}" averages ${rated[0].average} / 5.`);
  }
  for (const c of p.charts.filter((c) => c.n >= MIN_N).slice(0, 2)) {
    const top = c.items.slice().sort((a, b) => b.count - a.count)[0];
    if (top && top.count) parts.push(`${c.label.replace(/\?$/, "")}: the most common answer was "${top.label}" (${top.count} of ${c.n} people).`);
  }
  return parts;
}

// What a participant said about the session, for reading impact themes:
// their reflection answers (not the pre-session mood or suggestions), the
// next step Seni Scape asks about, and the themes read from their answers.
const REFLECTION_SKIP = new Set(["suggestions", "pre_mood"]);
function reflectionTexts(r) {
  const d = r.data || {};
  const fields = [...QUOTE_FIELDS.filter((f) => !REFLECTION_SKIP.has(f)), "seni_next_step"];
  const texts = fields.map((f) => d[f]).filter((v) => v !== null && v !== undefined && v !== "").map((v) => (Array.isArray(v) ? v.join(", ") : String(v)));
  const themes = r.analysis && Array.isArray(r.analysis.themes) ? r.analysis.themes.map(String) : [];
  return [...texts, ...themes];
}

// One panel per programme, built from that programme's own questionnaire in
// survey.js: its rating questions grouped by section, its choice questions as
// breakdowns, and a before -> after shift where the programme collects one.
function programPanels(responses) {
  return survey.PROGRAMS.map((p) => {
    const rs = responses.filter((r) => r.data && programId(r.data.program) === p.id);
    const datas = rs.map((r) => r.data);
    const sections = survey.sectionsFor(p.id);

    const groups = sections
      .map((sec) => {
        const items = sec.questions
          .filter((q) => q.scale)
          .map((q) => {
            const nums = scaleVals(datas, q.field);
            return { label: publicLabel(q), average: avg(nums), count: nums.length };
          })
          .filter((i) => i.count);
        return { title: sec.title.split(" / ")[0].replace(/^Section \w+ - /, ""), average: avg(items.map((i) => i.average)), items };
      })
      .filter((g) => g.items.length);

    // Headline: each person's mean across the programme's outcome ratings.
    // "Before the session" items and the understanding scale are left out -
    // they are not outcomes on the same footing.
    const outcomeFields = sections
      .flatMap((sec) => sec.questions)
      .filter((q) => q.scale && q.scale !== survey.SCALE_UNDERSTANDING && !q.field.startsWith("pre_"))
      .map((q) => q.field);

    const charts = sections
      .flatMap((sec, i) => sec.questions.filter((q) => q.options && !q.scale && (i > 0 || q.insight)))
      .map((q) => ({ label: publicLabel(q), multi: Boolean(q.multi), minN: q.insight ? MIN_N : 1, ...optionCounts(q, datas) }))
      .filter((c) => c.n >= c.minN)
      .map(({ minN, ...c }) => c);

    const shift = [
      { label: "Sense of self-worth (1-5)", before: avg(scaleVals(datas, "pre_self_worth")), after: avg(scaleVals(datas, "post_self_worth")) },
      { label: "Mind state (1-5)", before: avg(scaleVals(datas, "pre_mind_heavy")), after: avg(scaleVals(datas, "post_mind_peaceful")), note: "before = heaviness, after = calm" },
    ].filter((s) => s.before !== null || s.after !== null);

    const panel = {
      id: p.id,
      label: p.label,
      count: rs.length,
      outcome: avg(datas.map((d) => rowScaleAvg(d, outcomeFields))),
      sentiment: sentimentSplit(rs),
      shift,
      groups,
      charts,
      // Approved quotes only, from this programme's participants.
      testimonials: approvedTestimonials(rs),
      // The programme's intended outcomes, counted in participants' own words.
      impact: impact.impactWords(p.id, rs.map((r) => ({ texts: reflectionTexts(r) }))),
    };
    panel.narrativePoints = narrative(panel);
    panel.narrative = panel.narrativePoints.join(" ");
    return panel;
  });
}

// ---------- community (public, anonymised, aggregate only) ----------

function communityStats(responses) {
  const datas = responses.map((r) => r.data).filter(Boolean);
  const total = responses.length;

  // Wellbeing Index: per-response mean of the positive post scales, averaged.
  const wb = avg(datas.map((d) => rowScaleAvg(d, WELLBEING_POST)));
  const wellbeingIndex = wb;                       // 1-5
  const wellbeingIndex10 = wb !== null ? round2(wb * 2) : null; // 0-10 framing

  // Honest mind-state story (different scales — UI labels them explicitly).
  const preHeavy = avg(scaleVals(datas, "pre_mind_heavy"));     // higher = heavier
  const postPeace = avg(scaleVals(datas, "post_mind_peaceful")); // higher = calmer

  // Self-worth shift (one truly matched pre/post pair).
  const preWorth = avg(scaleVals(datas, "pre_self_worth"));
  const postWorth = avg(scaleVals(datas, "post_self_worth"));

  const understanding = avg(scaleVals(datas, "mental_health_understanding"));

  // Program effectiveness (1-5) and NPS (0-10) exist on the imported
  // historical rows (program_effectiveness / would_recommend). Stored 0s mean
  // "not collected", so they are skipped, and a metric only reports from
  // 3+ real answers — below that it stays an honest "pending".
  const effVals = scaleVals(datas, "program_effectiveness");
  const effectiveness = avg(effVals);
  const effectivenessCount = effVals.length;
  const effectivenessDist = {};
  for (const v of effVals) effectivenessDist[v] = (effectivenessDist[v] || 0) + 1;

  const npsScores = datas
    .map((d) => Number(d.would_recommend))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
  const nps = npsScores.length >= 3
    ? round2(
        (npsScores.filter((n) => n >= 9).length / npsScores.length -
          npsScores.filter((n) => n <= 6).length / npsScores.length) *
          100
      )
    : null;

  // Theme word cloud: AI themes + short pre-session mood words.
  const wordCounts = {};
  for (const r of responses) {
    const themes = r.analysis && Array.isArray(r.analysis.themes) ? r.analysis.themes : [];
    for (const t of themes) {
      const k = String(t).trim().toLowerCase();
      if (k) wordCounts[k] = (wordCounts[k] || 0) + 1;
    }
  }
  for (const d of datas) {
    const w = (d.pre_mood || "").trim();
    if (w && w.split(/\s+/).length <= 2) {
      const k = w.toLowerCase();
      wordCounts[k] = (wordCounts[k] || 0) + 1;
    }
  }
  const words = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([text, count]) => ({ text, count }));

  return {
    total,
    wellbeingIndex,
    wellbeingIndex10,
    preHeavy,
    postPeace,
    preWorth,
    postWorth,
    understanding,
    effectiveness,
    effectivenessCount,
    effectivenessDist,
    nps,
    npsCount: npsScores.length,
    sentiment: sentimentSplit(responses),
    booth: boothDistribution(datas),
    words,
    testimonials: approvedTestimonials(responses),
    programs: programPanels(responses),
    // Phase 2 — not yet collected by the survey:
    engagementRate: null,
  };
}

// ---------- corporate (admin, filterable, team-level only) ----------

function corporateStats(responses, filters = {}) {
  const { program, company, from, to } = filters;

  let rs = responses.slice();
  if (from) rs = rs.filter((r) => r.submittedAt && r.submittedAt >= from);
  if (to) rs = rs.filter((r) => r.submittedAt && r.submittedAt <= to);
  if (program)
    rs = rs.filter(
      (r) => r.data && programId(r.data.program) === programId(program)
    );
  if (company)
    rs = rs.filter(
      (r) => r.data && (r.data.company || "").toLowerCase() === company.toLowerCase()
    );

  const datas = rs.map((r) => r.data).filter(Boolean);

  const preWorth = avg(scaleVals(datas, "pre_self_worth"));
  const postWorth = avg(scaleVals(datas, "post_self_worth"));
  const preHeavy = avg(scaleVals(datas, "pre_mind_heavy"));
  const postPeace = avg(scaleVals(datas, "post_mind_peaceful"));
  const postLighter = avg(scaleVals(datas, "post_mind_lighter"));
  const postUnderstand = avg(scaleVals(datas, "post_understand_feelings"));

  // Matched, same-direction pairs we can show honestly as before → after.
  const pairs = [
    { label: "Sense of self-worth", before: preWorth, after: postWorth },
    {
      label: "Mind state",
      before: preHeavy,
      after: postPeace,
      note: "before = heaviness, after = calm (different scales)",
    },
  ];

  const after = avg([postWorth, postPeace, postLighter, postUnderstand]);

  return {
    filters: { program: program || null, company: company || null, from: from || null, to: to || null },
    count: rs.length,
    pairs,
    afterWellbeing: after,
    afterWellbeing10: after !== null ? round2(after * 2) : null,
    booth: boothDistribution(datas),
    sentiment: sentimentSplit(rs),
    testimonials: approvedTestimonials(rs),
    hasCompanyField: datas.some((d) => d.company),
    programsPresent: [...new Set(datas.map((d) => d.program).filter(Boolean))],
    // Phase 2 — require survey extension:
    nps: null,
    wantContinue: null,
    attendanceRate: null,
    workFocusDelta: null,
  };
}

// ---------- one member's own progress (private) ----------

// The 1-5 scales a member sees on their own progress page, in plain words.
// Higher is better on all of them except the "before" heavy-mind scale,
// which is flagged so the page can say so.
const PERSONAL_SCALES = [
  ["pre_happy_safe", "Before: felt happy and safe to be myself"],
  ["pre_mind_heavy", "Before: mind felt heavy or stressed", true],
  ["pre_self_worth", "Before: knew I am important"],
  ["post_self_worth", "After: saw that I am valuable and strong"],
  ["post_mind_lighter", "After: mind felt lighter"],
  ["post_mind_peaceful", "After: mind felt peaceful"],
  ["post_understand_feelings", "After: understood my feelings better"],
  ["circle_safe_to_share", "Felt safe to share in the circle"],
  ["circle_connection", "Felt connected to others"],
];

// Scores from a single response, using the same scales (and legacy field
// names) as the dashboards. wellbeing is the Wellbeing Index for this one
// response: the mean of the positive post-session scales, 1-5.
function personalScores(d) {
  const data = d || {};
  const wb = rowScaleAvg(data, WELLBEING_POST);
  const scales = [];
  for (const [field, label, lowerIsBetter] of PERSONAL_SCALES) {
    const v = resolveScale(data, field);
    if (Number.isFinite(v) && v >= 1 && v <= 5) scales.push({ field, label, value: v, lowerIsBetter: Boolean(lowerIsBetter) });
  }
  return { wellbeing: wb === null ? null : round2(wb), scales };
}

// ---------- participant grouping (internal) ----------

function decorate(group) {
  const times = group.responses
    .map((r) => r.submittedAt)
    .filter(Boolean)
    .sort();
  return {
    ...group,
    count: group.responses.length,
    firstAt: times[0] || null,
    lastAt: times[times.length - 1] || null,
  };
}

// Groups responses by a stable identity (email > name) when present; each
// anonymous response becomes its own singleton group.
function groupByParticipant(responses) {
  const groups = new Map();
  const out = [];

  responses.forEach((r, i) => {
    const d = r.data || {};
    const email = (d.email || "").trim().toLowerCase();
    const name = (d.name || "").trim().toLowerCase();
    const key = email || name || null;
    if (!key) {
      out.push(decorate({ key: "anon-" + (r.id || i), label: "Anonymous", anonymous: true, responses: [r] }));
      return;
    }
    if (!groups.has(key)) groups.set(key, { key, label: d.name || d.email, responses: [] });
    groups.get(key).responses.push(r);
  });

  for (const g of groups.values()) out.push(decorate(g));
  return out.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
}

module.exports = {
  SCALE_FIELDS,
  CATEGORY_FIELDS,
  QUOTE_FIELDS,
  programId,
  computeStats,
  communityStats,
  corporateStats,
  groupByParticipant,
  personalScores,
};
