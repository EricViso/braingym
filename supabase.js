// Supabase mirror for survey responses, over the PostgREST HTTP API.
//
// No SDK dependency: Node 18+ has global fetch and the app already calls
// DeepSeek the same way, so this keeps the install surface unchanged.
//
// Every export swallows its own errors and reports success as a boolean.
// The mirror must never take the survey down - a booth participant losing
// their answers because a backup write failed would be strictly worse than
// having no backup at all.

// Deliberately NOT the bare SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY names.
// Those are already set ambiently in this org's environments and point at the
// Treelance recruitment database. Survey responses silently mirroring into that
// project would be a serious data-mixing incident, so this store requires its
// own explicitly-named variables and stays off until they are set.
const URL_BASE = (process.env.SURVEY_SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SURVEY_SUPABASE_SERVICE_ROLE_KEY;

const enabled = Boolean(URL_BASE && SERVICE_KEY);

const TABLE = "responses";
const REST = `${URL_BASE}/rest/v1/${TABLE}`;

// Current questionnaire revision. Bump this whenever questions are added,
// removed or reworded so downstream stats can segment instead of blending
// answers to questions that no longer mean the same thing.
const SCHEMA_VERSION = Number(process.env.SURVEY_SCHEMA_VERSION || 1);

function headers(extra = {}) {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(url, opts = {}, timeoutMs = 8000) {
  // Serverless functions have a hard wall-clock budget, so a hanging mirror
  // write must not eat the request's remaining time.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, headers: headers(opts.headers), signal: ac.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase ${res.status}: ${body.slice(0, 300)}`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// The app's in-memory record is camelCase; the table is snake_case.
function toRow(record) {
  return {
    id: record.id,
    submitted_at: record.submittedAt || new Date().toISOString(),
    schema_version: record.schema_version ?? SCHEMA_VERSION,
    data: record.data ?? {},
    analysis: record.analysis ?? null,
    transcript: record.transcript ?? null,
    approved_quote: record.approvedQuote ?? null,
  };
}

function fromRow(row) {
  const record = {
    id: row.id,
    submittedAt: row.submitted_at,
    schema_version: row.schema_version,
    data: row.data,
    analysis: row.analysis,
    transcript: row.transcript,
  };
  // Kept absent rather than null: the approve-quote endpoint deletes the key,
  // and stats.js tests for its presence.
  if (row.approved_quote) record.approvedQuote = row.approved_quote;
  return record;
}

// Upsert on the record's uuid, so this doubles as both insert and update.
async function saveResponse(record) {
  if (!enabled || !record || !record.id) return false;
  try {
    await request(`${REST}?on_conflict=id`, {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(toRow(record)),
    });
    return true;
  } catch (e) {
    console.error("Supabase mirror write failed:", e.message);
    return false;
  }
}

// Ordered by insertion so positions line up with the Redis list.
async function loadResponses() {
  if (!enabled) return null;
  try {
    const res = await request(
      `${REST}?select=*&order=seq.asc`,
      { method: "GET" },
      15000
    );
    const rows = await res.json();
    return Array.isArray(rows) ? rows.map(fromRow) : null;
  } catch (e) {
    console.error("Supabase read failed:", e.message);
    return null;
  }
}

// Cheap liveness probe for the admin storage-health endpoint.
async function count() {
  if (!enabled) return null;
  try {
    const res = await request(`${REST}?select=id`, {
      method: "HEAD",
      headers: { Prefer: "count=exact", Range: "0-0" },
    });
    const range = res.headers.get("content-range") || "";
    const total = range.split("/")[1];
    return total && total !== "*" ? Number(total) : null;
  } catch (e) {
    console.error("Supabase count failed:", e.message);
    return null;
  }
}

module.exports = { enabled, saveResponse, loadResponses, count, SCHEMA_VERSION };
