// Aggregation layer over stored survey responses.
// Pure functions: every export takes the array returned by storage.loadResponses()
// and returns plain JSON. No I/O, no new storage shape.
//
// Honesty note: metrics the single-session booth survey does not collect
// (NPS, attendance/engagement, sleep, work-focus, per-company before/after)
// are returned as null and rendered by the UI as "Phase 2" placeholders —
// never as fabricated numbers.

const survey = require("./survey");

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
  booth_experience: "Booth experience (A best - E worst)",
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

// The four positive post-session scales that compose the Wellbeing Index.
const WELLBEING_POST = [
  "post_understand_feelings",
  "post_self_worth",
  "post_mind_lighter",
  "post_mind_peaceful",
];

// ---------- small helpers ----------

const round2 = (n) => Math.round(n * 100) / 100;

function avg(nums) {
  const xs = nums.filter((n) => Number.isFinite(n));
  return xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

// Valid 1-5 values for one field across a list of `data` objects.
function scaleVals(datas, field) {
  return datas
    .map((d) => Number(d[field]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
}

// Mean of several scale fields within a single response (equal participant weight).
function rowScaleAvg(d, fields) {
  const nums = fields
    .map((f) => Number(d[f]))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 5);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function distribution(datas, field) {
  const counts = {};
  for (const d of datas) {
    const v = d[field];
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
    const rows = datas.filter((d) => d.program === p.id);
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
    sentiment: sentimentSplit(responses),
    booth: distribution(datas, "booth_experience"),
    words,
    testimonials: approvedTestimonials(responses),
    // Phase 2 — not yet collected by the survey:
    nps: null,
    engagementRate: null,
  };
}

// ---------- corporate (admin, filterable, team-level only) ----------

function corporateStats(responses, filters = {}) {
  const { program, company, from, to } = filters;

  let rs = responses.slice();
  if (from) rs = rs.filter((r) => r.submittedAt && r.submittedAt >= from);
  if (to) rs = rs.filter((r) => r.submittedAt && r.submittedAt <= to);
  if (program) rs = rs.filter((r) => r.data && r.data.program === program);
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
    booth: distribution(datas, "booth_experience"),
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
  computeStats,
  communityStats,
  corporateStats,
  groupByParticipant,
};
