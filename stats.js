// Aggregation layer over stored survey responses.
// Pure functions: every export takes the array returned by storage.loadResponses()
// and returns plain JSON. No I/O, no new storage shape.

// Matched 1-5 scale fields and their human labels (used by the admin view).
const SCALE_FIELDS = {
  pre_happy_safe: "Pre: happy & safe to be myself",
  pre_self_kind: "Pre: kind to myself",
  pre_self_worth: "Pre: I know I am important",
  pre_mind_calm: "Pre: mind calm & at ease",
  mental_health_understanding: "Understanding of mental health link",
  post_happy_safe: "Post: happy & safe to be myself",
  post_self_kind: "Post: kind to myself",
  post_self_worth: "Post: I know I am important",
  post_mind_calm: "Post: mind calm & at ease",
  program_effectiveness: "Program effectiveness",
};

const CATEGORY_FIELDS = {
  age_group: "Age group",
  gender: "Gender",
  program: "Program joined",
  community_role: "Community role",
  program_experience: "Program experience (A best - E worst)",
};

// The four post-assessment scales that compose the Wellbeing Index.
const WELLBEING_POST = [
  "post_happy_safe",
  "post_self_kind",
  "post_self_worth",
  "post_mind_calm",
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

// ---------- admin: full stats ----------

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

  return { total: responses.length, flagged, averages, distributions };
}

// ---------- community (public, anonymised, aggregate only) ----------

function communityStats(responses) {
  const datas = responses.map((r) => r.data).filter(Boolean);
  const total = responses.length;

  // Wellbeing Index: per-response mean of the post-assessment scales, averaged.
  const wb = avg(datas.map((d) => rowScaleAvg(d, WELLBEING_POST)));
  const wellbeingIndex = wb;                       // 1-5
  const wellbeingIndex10 = wb !== null ? round2(wb * 2) : null; // 0-10 framing

  // Matched pre/post wellbeing pairs (same direction: higher = better).
  const preHappy = avg(scaleVals(datas, "pre_happy_safe"));
  const postHappy = avg(scaleVals(datas, "post_happy_safe"));

  const preKind = avg(scaleVals(datas, "pre_self_kind"));
  const postKind = avg(scaleVals(datas, "post_self_kind"));

  const preWorth = avg(scaleVals(datas, "pre_self_worth"));
  const postWorth = avg(scaleVals(datas, "post_self_worth"));

  const preCalm = avg(scaleVals(datas, "pre_mind_calm"));
  const postCalm = avg(scaleVals(datas, "post_mind_calm"));

  const understanding = avg(scaleVals(datas, "mental_health_understanding"));
  const effectiveness = avg(scaleVals(datas, "program_effectiveness"));

  // NPS: would_recommend is 0-10. Skip 0 values (not collected / default).
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
    preHappy,
    postHappy,
    preKind,
    postKind,
    preWorth,
    postWorth,
    preCalm,
    postCalm,
    understanding,
    effectiveness,
    sentiment: sentimentSplit(responses),
    programExperience: distribution(datas, "program_experience"),
    words,
    testimonials: approvedTestimonials(responses),
    nps,
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

  // Matched pre/post pairs (same direction, higher = better).
  const preHappy = avg(scaleVals(datas, "pre_happy_safe"));
  const postHappy = avg(scaleVals(datas, "post_happy_safe"));

  const preKind = avg(scaleVals(datas, "pre_self_kind"));
  const postKind = avg(scaleVals(datas, "post_self_kind"));

  const preWorth = avg(scaleVals(datas, "pre_self_worth"));
  const postWorth = avg(scaleVals(datas, "post_self_worth"));

  const preCalm = avg(scaleVals(datas, "pre_mind_calm"));
  const postCalm = avg(scaleVals(datas, "post_mind_calm"));

  const pairs = [
    { label: "Happy & safe to be myself", before: preHappy, after: postHappy },
    { label: "Kind to self", before: preKind, after: postKind },
    { label: "Sense of self-worth", before: preWorth, after: postWorth },
    { label: "Mind calm & at ease", before: preCalm, after: postCalm },
  ];

  const after = avg([postHappy, postKind, postWorth, postCalm]);

  // NPS for this filtered group. Skip 0 values (not collected / default).
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

  return {
    filters: { program: program || null, company: company || null, from: from || null, to: to || null },
    count: rs.length,
    pairs,
    afterWellbeing: after,
    afterWellbeing10: after !== null ? round2(after * 2) : null,
    programExperience: distribution(datas, "program_experience"),
    sentiment: sentimentSplit(rs),
    testimonials: approvedTestimonials(rs),
    nps,
    hasCompanyField: datas.some((d) => d.company),
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
  computeStats,
  communityStats,
  corporateStats,
  groupByParticipant,
};
