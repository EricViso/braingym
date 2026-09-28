// Snapshots the myWIPhealing WordPress site (mywiphealing.com) into public/ as
// static files, so the whole site is served from this repo. The survey lives at
// /bot; every WordPress page keeps its original path.
//
//   node scripts/mirror-wordpress.js [origin]
//
// Re-run to refresh the snapshot after editing content in WordPress. It only
// writes WordPress paths (pages + /wp-content, /wp-includes assets) and never
// touches the survey or dashboard files.

const fs = require("fs");
const path = require("path");

const ORIGIN = (process.argv[2] || "https://mywiphealing.com").replace(/\/$/, "");
const HOST = new URL(ORIGIN).host.replace(/^www\./, "");
const OUT = path.join(__dirname, "..", "public");

// Absolute links to the site in any of the forms WordPress emits, including
// the JSON-escaped one (https:\/\/host\/path) inside inline scripts.
const hostRe = HOST.replace(/\./g, "\\.");
const ABS_RE = new RegExp(`(?:https?:)?(\\\\?/\\\\?/)(?:www\\.)?${hostRe}(?=[/\\\\"'\\s)?#]|$)`, "g");

// Linked from the story pages but not listed in the sitemap.
const EXTRA_PAGES = ["/SHIPS/ships/"];

const pages = new Set(EXTRA_PAGES);
const assets = new Set();
const done = new Set();

function localPath(pathname, isPage) {
  const clean = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (isPage) return path.join(OUT, clean, "index.html");
  return path.join(OUT, clean);
}

function isAssetPath(p) {
  return /^\/wp-(content|includes)\//.test(p) || /\.[a-z0-9]{2,5}$/i.test(p);
}

// Resolve a reference found in HTML/CSS to a same-site pathname, or null.
function resolve(ref, base) {
  if (!ref || /^(data:|#|mailto:|tel:|javascript:)/i.test(ref)) return null;
  let u;
  try {
    u = new URL(ref.replace(/\\\//g, "/").replace(/&amp;/g, "&"), base);
  } catch {
    return null;
  }
  if (u.host.replace(/^www\./, "") !== HOST) return null;
  return u.pathname;
}

function collectRefs(text, base, { html }) {
  const found = [];
  const attr = /(?:src|href|data-src|data-lazy-src|data-bg|data-background|poster|content)\s*=\s*["']([^"']+)["']/gi;
  const srcset = /(?:srcset|data-srcset|data-lazy-srcset)\s*=\s*["']([^"']+)["']/gi;
  const cssUrl = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  const cssImport = /@import\s+["']([^"']+)["']/gi;
  let m;
  if (html) {
    while ((m = attr.exec(text))) found.push(m[1]);
    while ((m = srcset.exec(text)))
      for (const part of m[1].split(",")) found.push(part.trim().split(/\s+/)[0]);
    // Absolute asset URLs anywhere else (inline JSON, lazy-load configs).
    const bare = new RegExp(`(?:https?:)?\\\\?/\\\\?/(?:www\\.)?${hostRe}(\\\\?/wp-(?:content|includes)[^"'\\s)<>]*)`, "g");
    while ((m = bare.exec(text))) found.push(ORIGIN + m[1].replace(/\\\//g, "/"));
  }
  while ((m = cssUrl.exec(text))) found.push(m[1]);
  while ((m = cssImport.exec(text))) found.push(m[1]);

  for (const ref of found) {
    const p = resolve(ref, base);
    if (!p || p.startsWith("/wp-admin") || p.startsWith("/wp-json") || p.includes("xmlrpc")) continue;
    // Pages come from the sitemap only; crawling links would pull in feeds,
    // author archives and ?p= permalinks that nobody navigates to.
    if (isAssetPath(p)) assets.add(p);
  }
}

// Root-relative links, and no ?ver= cache-busters (the files are saved without them).
function rewrite(text) {
  return text
    // Head links into WordPress endpoints that do not exist in a static copy.
    .replace(/<link[^>]+(?:\/wp-json\/|\/feed\/|xmlrpc\.php|rel=["']shortlink["'])[^>]*>\s*/gi, "")
    .replace(ABS_RE, "")
    .replace(/((?:\/wp-(?:content|includes)\/|\\\/wp-(?:content|includes)\\\/)[^"'\s)<>?]*)\?[^"'\s)<>]*/g, "$1");
}

async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": "myWIPhealing-mirror/1.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

async function mirrorPage(p) {
  const url = ORIGIN + p;
  const html = await (await get(url)).text();
  collectRefs(html, url, { html: true });
  const file = p === "/" ? path.join(OUT, "index.html") : localPath(p, true);
  write(file, rewrite(html));
  console.log("page ", p);
}

async function mirrorAsset(p) {
  const url = ORIGIN + p;
  const res = await get(url);
  const type = res.headers.get("content-type") || "";
  // WordPress redirects a missing upload to the homepage, which fetch follows
  // to a 200 - without this the "image" would be saved as a copy of the page.
  if (/text\/html/.test(type)) throw new Error(`missing on origin (redirected to ${res.url})`);
  if (/text\/css/.test(type) || p.endsWith(".css")) {
    const css = await res.text();
    collectRefs(css, url, { html: false });
    write(localPath(p), rewrite(css));
  } else if (/javascript/.test(type) || p.endsWith(".js")) {
    write(localPath(p), rewrite(await res.text()));
  } else {
    write(localPath(p), Buffer.from(await res.arrayBuffer()));
  }
}

async function main() {
  const sitemap = await (await get(ORIGIN + "/sitemap.xml")).text();
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const p = resolve(m[1].trim(), ORIGIN);
    if (p) pages.add(p);
  }

  // Pages first (they discover assets), then assets until no new ones appear.
  const failed = [];
  for (;;) {
    const todo = [...pages, ...assets].filter((p) => !done.has(p));
    if (!todo.length) break;
    for (const p of todo) {
      done.add(p);
      try {
        if (pages.has(p) && !isAssetPath(p)) await mirrorPage(p);
        else await mirrorAsset(p);
      } catch (e) {
        failed.push(`${p}  (${e.message})`);
      }
    }
  }
  console.log(`\n${done.size - failed.length} files mirrored, ${failed.length} failed`);
  for (const f of failed) console.log("  failed:", f);

  // Re-add the links and sections that exist only in this repo, not in WordPress.
  require("./site-additions")();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
