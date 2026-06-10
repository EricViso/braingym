const fs = require("fs");
const path = require("path");

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

const ready = useUpstash || useNodeRedis || !process.env.VERCEL;
const reason = ready
  ? null
  : "Storage is not configured. In the Vercel dashboard: Storage -> Create Database -> Redis (or Upstash for Redis) -> connect it to this project, then redeploy.";

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

async function loadResponses() {
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

// Returns the index of the appended record so it can be updated later.
async function appendResponse(record) {
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

async function updateResponse(index, record) {
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

module.exports = { loadResponses, appendResponse, updateResponse, ready, reason };
