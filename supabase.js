// Supabase mirror for survey responses and Harmoni Circle events, over the
// PostgREST HTTP API.
//
// No SDK dependency: Node 18+ has global fetch and the app already calls
// DeepSeek the same way, so this keeps the install surface unchanged.
//
// Every export swallows its own errors and reports success as a boolean.
// The mirror must never take the survey down - a booth participant losing
// their answers because a backup write failed would be strictly worse than
// having no backup at all.

// Vercel's Supabase integration injects SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// automatically, so those are accepted. SURVEY_-prefixed names win when both
// exist, for the case where a project is linked to more than one database.
//
// The bare names are not safe on their own: they are also set in some of this
// org's other environments, where they resolve to the Treelance recruitment
// database. Mirroring survey responses there would mix two sensitive datasets.
// preflight() below is the actual guard - it refuses to write to any database
// that does not already have the table being written to.
const URL_BASE = (
  process.env.SURVEY_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/+$/, "");

const SERVICE_KEY =
  process.env.SURVEY_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// Optional belt-and-braces pin: set to the project ref (the subdomain) to
// hard-refuse any other project, whatever the URL variable happens to say.
const EXPECTED_REF = process.env.SURVEY_SUPABASE_PROJECT_REF;

function projectRef(url) {
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\./i.exec(url);
  return m ? m[1] : null;
}

const ref = projectRef(URL_BASE);
const refMismatch = Boolean(EXPECTED_REF && ref && ref !== EXPECTED_REF);
if (refMismatch) {
  console.error(
    `Supabase mirror disabled: SURVEY_SUPABASE_PROJECT_REF is "${EXPECTED_REF}" but the configured URL points at "${ref}".`
  );
}

const enabled = Boolean(URL_BASE && SERVICE_KEY && !refMismatch);

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

// One PostgREST table client. `mappers` converts between the app's camelCase
// records and the table's snake_case rows. Each table gets its own preflight
// cache so probing one table never blesses another.
function makeTable(table, mappers = {}) {
  const REST = `${URL_BASE}/rest/v1/${table}`;
  const toRow = mappers.toRow || ((record) => record);
  const fromRow = mappers.fromRow || ((row) => row);

  // One-time check that this database is actually the survey's: the table
  // must already exist. Any other project (an unrelated database that happens
  // to be what SUPABASE_URL resolves to) 404s here and the mirror stays off,
  // rather than every single write failing separately against the wrong
  // target. Cached across warm invocations; a failed probe retries next time.
  let preflightPromise = null;
  function preflight() {
    if (!enabled) return Promise.resolve(false);
    if (!preflightPromise) {
      preflightPromise = request(`${REST}?select=id&limit=1`, { method: "GET" })
        .then(() => true)
        .catch((e) => {
          preflightPromise = null;
          if (/\b404\b/.test(e.message)) {
            console.error(
              `Supabase mirror disabled: project "${ref || URL_BASE}" has no "${table}" table. ` +
                `Run supabase/schema.sql there, and confirm the URL points at the survey project.`
            );
          } else {
            console.error("Supabase preflight failed:", e.message);
          }
          return false;
        });
    }
    return preflightPromise;
  }

  // Upsert on the record's uuid, so this doubles as both insert and update.
  async function save(record) {
    if (!enabled || !record || !record.id) return false;
    if (!(await preflight())) return false;
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
  async function load() {
    if (!enabled) return null;
    if (!(await preflight())) return null;
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
    if (!(await preflight())) return null;
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

  return { save, load, count, preflight };
}

// ---- responses ----

// The app's in-memory record is camelCase; the table is snake_case.
function responseToRow(record) {
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

function responseFromRow(row) {
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

// ---- events (WIP Harmoni Circle proposals) ----

function eventToRow(record) {
  return {
    id: record.id,
    submitted_at: record.submittedAt || new Date().toISOString(),
    status: record.status || "under_review",
    data: record.data ?? {},
    admin_note: record.adminNote ?? null,
    decided_at: record.decidedAt ?? null,
    decided_by: record.decidedBy ?? null,
  };
}

function eventFromRow(row) {
  const record = {
    id: row.id,
    submittedAt: row.submitted_at,
    status: row.status,
    data: row.data || {},
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
  };
  if (row.admin_note) record.adminNote = row.admin_note;
  return record;
}

// ---- members (WIP Harmoni Circle accounts) ----

// One row per memberSHIPS account. `id` is the Supabase Auth user id; the row
// only exists once that user has entered the invite code.
function memberToRow(record) {
  return {
    id: record.id,
    email: record.email || null,
    name: record.name || "",
    provider: record.provider || null,
    joined_at: record.joinedAt || new Date().toISOString(),
    data: record.data ?? {},
  };
}

function memberFromRow(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    provider: row.provider,
    joinedAt: row.joined_at,
    data: row.data || {},
  };
}

const responses = makeTable("responses", {
  toRow: responseToRow,
  fromRow: responseFromRow,
});
const events = makeTable("events", { toRow: eventToRow, fromRow: eventFromRow });
const members = makeTable("members", { toRow: memberToRow, fromRow: memberFromRow });

// ---- auth (memberSHIPS logins via Supabase Auth) ----

// The anon key is public by design: the browser needs it to sign in. The
// Vercel integration exposes it under both names below.
const ANON_KEY =
  process.env.SURVEY_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

// Logins are only switched on when the `members` table preflight passes, for
// the same reason the mirror has one: a bare SUPABASE_URL can resolve to
// another of the org's projects, and members must never end up signing up
// into that project's user list.
async function authReady() {
  if (!enabled || !ANON_KEY) return false;
  return members.preflight();
}

function authReason() {
  if (!URL_BASE || !SERVICE_KEY) {
    return "Member login needs Supabase: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.";
  }
  if (!ANON_KEY) return "Member login needs the Supabase anon key: set SUPABASE_ANON_KEY.";
  return "Member login is off: the Supabase project has no `members` table. Run supabase/schema.sql there.";
}

// Verified users by access token, so each API call doesn't round-trip to
// Supabase. Short TTL: a signed-out token stops working within a minute.
const userCache = new Map();
const USER_TTL_MS = 60_000;

// Returns the signed-in user, or null for a missing/expired/invalid token.
// Throws on a network failure, so a Supabase hiccup reads as "try again"
// rather than signing everyone out.
async function getUser(accessToken) {
  if (!accessToken || !URL_BASE || !ANON_KEY) return null;
  const hit = userCache.get(accessToken);
  if (hit && hit.exp > Date.now()) return hit.user;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  let res;
  try {
    res = await fetch(`${URL_BASE}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${accessToken}` },
      signal: ac.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Supabase auth ${res.status}`);

  const u = await res.json();
  const meta = u.user_metadata || {};
  const user = u && u.id
    ? {
        id: u.id,
        email: u.email || "",
        name: meta.full_name || meta.name || "",
        provider: (u.app_metadata && u.app_metadata.provider) || "email",
      }
    : null;
  if (userCache.size > 1000) userCache.clear();
  userCache.set(accessToken, { user, exp: Date.now() + USER_TTL_MS });
  return user;
}

module.exports = {
  enabled,
  ref,
  saveResponse: responses.save,
  loadResponses: responses.load,
  count: responses.count,
  preflight: responses.preflight,
  events,
  members,
  auth: {
    url: URL_BASE,
    anonKey: ANON_KEY,
    ready: authReady,
    reason: authReason,
    getUser,
  },
  SCHEMA_VERSION,
};
