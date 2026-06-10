const fs = require("fs");
const path = require("path");

// On Vercel the filesystem is ephemeral, so responses live in Upstash Redis
// (created via Vercel Storage tab, which injects these env vars). Locally,
// without Redis env vars, we fall back to a plain JSON file.

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const useRedis = Boolean(REDIS_URL && REDIS_TOKEN);

const ready = useRedis || !process.env.VERCEL;
const reason = ready
  ? null
  : "Storage is not configured. In the Vercel dashboard: Storage -> Create Database -> Upstash for Redis -> connect it to this project, then redeploy.";

let redis = null;
if (useRedis) {
  const { Redis } = require("@upstash/redis");
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const KEY = "responses";

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

// Upstash SDK serializes objects on write and parses JSON on read,
// but be tolerant of raw strings just in case.
function parseItem(item) {
  if (typeof item !== "string") return item;
  try {
    return JSON.parse(item);
  } catch {
    return { parse_error: true, raw: item };
  }
}

async function loadResponses() {
  if (useRedis) {
    const items = await redis.lrange(KEY, 0, -1);
    return items.map(parseItem);
  }
  return loadFile();
}

// Returns the index of the appended record so it can be updated later.
async function appendResponse(record) {
  if (useRedis) {
    const length = await redis.rpush(KEY, record);
    return length - 1;
  }
  const all = loadFile();
  all.push(record);
  saveFile(all);
  return all.length - 1;
}

async function updateResponse(index, record) {
  if (useRedis) {
    await redis.lset(KEY, index, record);
    return;
  }
  const all = loadFile();
  if (index >= 0 && index < all.length) {
    all[index] = record;
    saveFile(all);
  }
}

module.exports = { loadResponses, appendResponse, updateResponse, ready, reason };
