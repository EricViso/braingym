const fs = require("fs");
const path = require("path");
const supabase = require("./supabase");

// On Vercel the filesystem is ephemeral, so responses live in Redis.
// Two Redis flavours are supported, picked by which env vars exist:
//   - Upstash REST (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN)
//   - Standard Redis via TCP (REDIS_URL - what Vercel's "Redis" marketplace
//     store injects)
// Locally, without any Redis env vars, we fall back to a plain JSON file.

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

const KEY = "responses";

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

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "responses.json");

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveFile(responses) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(responses, null, 2));
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

async function primaryLoad() {
  if (useUpstash) {
    const items = await upstash.lrange(KEY, 0, -1);
    return items.map(parseItem);
  }
  if (useNodeRedis) {
    const client = await getNodeRedis();
    const items = await client.lRange(KEY, 0, -1);
    return items.map(parseItem);
  }
  return loadFile();
}

// Reads prefer the primary store, but fall through to the Supabase mirror in
// the two cases that actually lose data in practice: the primary erroring, and
// the primary coming back empty because a Redis store was recycled, swapped or
// never provisioned. An empty primary with a populated mirror means the mirror
// is the truth.
async function loadResponses() {
  if (!hasPrimary) {
    const mirrored = await supabase.loadResponses();
    return mirrored || [];
  }

  let primary = null;
  try {
    primary = await primaryLoad();
  } catch (e) {
    console.error("Primary store read failed, trying Supabase:", e.message);
    const mirrored = await supabase.loadResponses();
    if (mirrored) return mirrored;
    throw e;
  }

  if (primary && primary.length) return primary;

  const mirrored = await supabase.loadResponses();
  if (mirrored && mirrored.length) {
    console.warn(
      `Primary store empty but Supabase holds ${mirrored.length} response(s); serving the mirror.`
    );
    return mirrored;
  }
  return primary || [];
}

// Returns the index of the appended record so it can be updated later.
// Mirrors to Supabase as well; the mirror keys on record.id, not the index.
async function appendResponse(record) {
  if (record && record.schema_version === undefined) {
    record.schema_version = supabase.SCHEMA_VERSION;
  }

  let index = -1;
  let primaryError = null;
  if (hasPrimary) {
    try {
      index = await primaryAppend(record);
    } catch (e) {
      primaryError = e;
      console.error("Primary store write failed:", e.message);
    }
  }

  const mirrored = await supabase.saveResponse(record);

  // Only a total loss is fatal. If either store took the response, the
  // participant's answers survive and the survey completes normally.
  if (primaryError && !mirrored) throw primaryError;
  if (!hasPrimary && !mirrored) {
    throw new Error("Supabase write failed and no other store is configured.");
  }
  return index;
}

async function primaryAppend(record) {
  if (useUpstash) {
    const length = await upstash.rpush(KEY, record);
    return length - 1;
  }
  if (useNodeRedis) {
    const client = await getNodeRedis();
    const length = await client.rPush(KEY, JSON.stringify(record));
    return length - 1;
  }
  const all = loadFile();
  all.push(record);
  saveFile(all);
  return all.length - 1;
}

// index addresses the Redis list position; Supabase upserts on record.id, so
// an index of -1 (primary write failed, or Supabase-only) still updates cleanly.
async function updateResponse(index, record) {
  if (hasPrimary && index >= 0) {
    try {
      await primaryUpdate(index, record);
    } catch (e) {
      console.error("Primary store update failed:", e.message);
    }
  }
  await supabase.saveResponse(record);
}

async function primaryUpdate(index, record) {
  if (useUpstash) {
    await upstash.lset(KEY, index, record);
    return;
  }
  if (useNodeRedis) {
    const client = await getNodeRedis();
    await client.lSet(KEY, index, JSON.stringify(record));
    return;
  }
  const all = loadFile();
  if (index >= 0 && index < all.length) {
    all[index] = record;
    saveFile(all);
  }
}

// Counts held by each store, so a silently-empty primary is visible.
async function health() {
  const info = backends();
  let primaryCount = null;
  if (hasPrimary) {
    try {
      primaryCount = (await primaryLoad()).length;
    } catch (e) {
      info.primaryError = e.message;
    }
  }
  return {
    ...info,
    primaryCount,
    supabaseCount: supabase.enabled ? await supabase.count() : null,
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
  backends,
  health,
  SCHEMA_VERSION: supabase.SCHEMA_VERSION,
  ready,
  reason,
};
