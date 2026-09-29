const fs = require("fs");
const path = require("path");
const supabase = require("./supabase");

// On Vercel the filesystem is ephemeral, so records live in Redis.
// Two Redis flavours are supported, picked by which env vars exist:
//   - Upstash REST (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
//   - Standard Redis via TCP (REDIS_URL - what Vercel's "Redis" marketplace
//     store injects)
// Locally, without any Redis env vars, we fall back to plain JSON files, one
// per list (`data/responses.json`, `data/events.json`).

const UPSTASH_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const REDIS_TCP_URL = process.env.REDIS_URL;

const useUpstash = Boolean(UPSTASH_URL && UPSTASH_TOKEN);
const useNodeRedis = !useUpstash && Boolean(REDIS_TCP_URL);

// Supabase alone is enough to run: if no Redis is configured it becomes the
// primary store rather than only a mirror.
const ready = useUpstash || useNodeRedis || supabase.enabled || !process.env.VERCEL;
const reason = ready
  ? null
  : "Storage is not configured. Either connect a Redis store (Vercel dashboard: Storage -> Create Database -> Redis) or set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, then redeploy.";

// True when Redis/file handles reads and writes and Supabase is a spare copy.
// False when Supabase is the only store there is.
const hasPrimary = useUpstash || useNodeRedis || !process.env.VERCEL;

// One Redis list per entity. The responses key predates the events feature;
// its name is load-bearing (existing Redis stores hold data under it).
const KEYS = { responses: "responses", events: "events", members: "members" };

let upstash = null;
if (useUpstash) {
  const { Redis } = require("@upstash/redis");
  upstash = new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN });
}

// node-redis client is created lazily and reused across warm serverless
// invocations; a failed connect resets so the next request can retry.
let nodeRedisPromise = null;
function getNodeRedis() {
  if (!nodeRedisPromise) {
    const { createClient } = require("redis");
    const client = createClient({ url: REDIS_TCP_URL });
    client.on("error", (e) => console.error("Redis error:", e.message));
    nodeRedisPromise = client
      .connect()
      .then(() => client)
      .catch((e) => {
        nodeRedisPromise = null;
        throw e;
      });
  }
  return nodeRedisPromise;
}

// DATA_DIR lets a test run point the JSON-file fallback somewhere disposable.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

function fileFor(key) {
  return path.join(DATA_DIR, `${key}.json`);
}

function loadFile(key) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), "utf8"));
  } catch {
    return [];
  }
}

function saveFile(key, records) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(fileFor(key), JSON.stringify(records, null, 2));
}

// Upstash SDK auto-parses JSON on read; node-redis returns raw strings.
function parseItem(item) {
  if (typeof item !== "string") return item;
  try {
    return JSON.parse(item);
  } catch {
    return { parse_error: true, raw: item };
  }
}

async function primaryLoad(key) {
  if (useUpstash) {
    const items = await upstash.lrange(key, 0, -1);
    return items.map(parseItem);
  }
  if (useNodeRedis) {
    const client = await getNodeRedis();
    const items = await client.lRange(key, 0, -1);
    return items.map(parseItem);
  }
  return loadFile(key);
}

// Reads prefer the primary store, but fall through to the Supabase mirror in
// the two cases that actually lose data in practice: the primary erroring, and
// the primary coming back empty because a Redis store was recycled, swapped or
// never provisioned. An empty primary with a populated mirror means the mirror
// is the truth.
async function loadList(key, mirrorLoad) {
  if (!hasPrimary) {
    const mirrored = await mirrorLoad();
    return mirrored || [];
  }

  let primary = null;
  try {
    primary = await primaryLoad(key);
  } catch (e) {
    console.error("Primary store read failed, trying Supabase:", e.message);
    const mirrored = await mirrorLoad();
    if (mirrored) return mirrored;
    throw e;
  }

  if (primary && primary.length) return primary;

  const mirrored = await mirrorLoad();
  if (mirrored && mirrored.length) {
    console.warn(
      `Primary store empty but Supabase holds ${mirrored.length} record(s) in "${key}"; serving the mirror.`
    );
    return mirrored;
  }
  return primary || [];
}

// Returns the index of the appended record so it can be updated later.
// Mirrors to Supabase as well; the mirror keys on record.id, not the index.
async function appendRecord(key, record, mirrorSave) {
  let index = -1;
  let primaryError = null;
  if (hasPrimary) {
    try {
      index = await primaryAppend(key, record);
    } catch (e) {
      primaryError = e;
      console.error("Primary store write failed:", e.message);
    }
  }

  const mirrored = await mirrorSave(record);

  // Only a total loss is fatal. If either store took the record, it survives
  // and the request completes normally.
  if (primaryError && !mirrored) throw primaryError;
  if (!hasPrimary && !mirrored) {
    throw new Error("Supabase write failed and no other store is configured.");
  }
  return index;
}

async function primaryAppend(key, record) {
  if (useUpstash) {
    const length = await upstash.rpush(key, record);
    return length - 1;
  }
  if (useNodeRedis) {
    const client = await getNodeRedis();
    const length = await client.rPush(key, JSON.stringify(record));
    return length - 1;
  }
  const all = loadFile(key);
  all.push(record);
  saveFile(key, all);
  return all.length - 1;
}

// index addresses the Redis list position; Supabase upserts on record.id, so
// an index of -1 (primary write failed, or Supabase-only) still updates
// cleanly.
async function updateRecord(key, index, record, mirrorSave) {
  if (hasPrimary && index >= 0) {
    try {
      await primaryUpdate(key, index, record);
    } catch (e) {
      console.error("Primary store update failed:", e.message);
    }
  }
  await mirrorSave(record);
}

async function primaryUpdate(key, index, record) {
  if (useUpstash) {
    await upstash.lset(key, index, record);
    return;
  }
  if (useNodeRedis) {
    const client = await getNodeRedis();
    await client.lSet(key, index, JSON.stringify(record));
    return;
  }
  const all = loadFile(key);
  if (index >= 0 && index < all.length) {
    all[index] = record;
    saveFile(key, all);
  }
}

// ---------- survey responses ----------

const loadResponses = () => loadList(KEYS.responses, supabase.loadResponses);
const appendResponse = (record) => {
  if (record && record.schema_version === undefined) {
    record.schema_version = supabase.SCHEMA_VERSION;
  }
  return appendRecord(KEYS.responses, record, supabase.saveResponse);
};
const updateResponse = (index, record) =>
  updateRecord(KEYS.responses, index, record, supabase.saveResponse);

// ---------- Harmoni Circle events ----------

const loadEvents = () => loadList(KEYS.events, supabase.events.load);
const appendEvent = (record) =>
  appendRecord(KEYS.events, record, supabase.events.save);
const updateEvent = (index, record) =>
  updateRecord(KEYS.events, index, record, supabase.events.save);

// ---------- Harmoni Circle member accounts ----------

const loadMembers = () => loadList(KEYS.members, supabase.members.load);
const appendMember = (record) =>
  appendRecord(KEYS.members, record, supabase.members.save);
const updateMember = (index, record) =>
  updateRecord(KEYS.members, index, record, supabase.members.save);

// Whether a record submitted right now could actually be stored. `ready` is a
// config-level check; this one confirms the store will really accept a write.
// Without it, a Supabase-only deployment whose table is missing would look fine
// until the final step lost every answer. Cached by supabase preflight per
// table, so this is cheap after the first call. Returns null when there is
// nothing to add beyond `ready`.
async function writable() {
  if (hasPrimary) return null; // Redis or the local file will take the write.
  if (!supabase.enabled) return null; // `ready`/`reason` already covers this.
  const ok = await supabase.preflight();
  return ok
    ? null
    : "Supabase is the only configured store and its `responses` table is missing. Run supabase/schema.sql in that project, then redeploy.";
}

async function writableEvents() {
  if (hasPrimary) return null;
  if (!supabase.enabled) return null;
  const ok = await supabase.events.preflight();
  return ok
    ? null
    : "Supabase is the only configured store and its `events` table is missing. Run supabase/schema.sql in that project, then redeploy.";
}

// Counts held by each store, so a silently-empty primary is visible.
async function health() {
  const info = backends();
  let primaryCount = null;
  let eventsCount = null;
  if (hasPrimary) {
    try {
      primaryCount = (await primaryLoad(KEYS.responses)).length;
    } catch (e) {
      info.primaryError = e.message;
    }
    try {
      eventsCount = (await primaryLoad(KEYS.events)).length;
    } catch (e) {
      info.eventsError = e.message;
    }
  }
  return {
    ...info,
    primaryCount,
    eventsCount,
    supabaseCount: supabase.enabled ? await supabase.count() : null,
    supabaseEventsCount: supabase.enabled ? await supabase.events.count() : null,
  };
}

// Which stores are live, for the admin storage-health endpoint.
function backends() {
  return {
    primary: useUpstash
      ? "upstash-redis"
      : useNodeRedis
      ? "redis-tcp"
      : hasPrimary
      ? "json-file"
      : null,
    supabase: supabase.enabled,
    schemaVersion: supabase.SCHEMA_VERSION,
  };
}

module.exports = {
  loadResponses,
  appendResponse,
  updateResponse,
  loadEvents,
  appendEvent,
  updateEvent,
  loadMembers,
  appendMember,
  updateMember,
  backends,
  health,
  writable,
  writableEvents,
  SCHEMA_VERSION: supabase.SCHEMA_VERSION,
  ready,
  reason,
};
