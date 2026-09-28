// Inserts scripts/home-sections.html (community dashboard + impact survey
// promos) into the mirrored homepage, directly after the hero row.
//
//   node scripts/inject-home-sections.js
//
// Idempotent: a previously injected block is replaced, not duplicated. The
// mirror script runs this automatically after refreshing the homepage.

const fs = require("fs");
const path = require("path");

const HOME = path.join(__dirname, "..", "public", "index.html");
const PARTIAL = path.join(__dirname, "home-sections.html");
const START = "<!-- wip:home-sections:start -->";
const END = "<!-- wip:home-sections:end -->";

// Index just past the </div> that closes the <div> opening at `from`.
function closingDivEnd(html, from) {
  const tag = /<div\b[^>]*>|<\/div>/gi;
  tag.lastIndex = from;
  let depth = 0;
  let m;
  while ((m = tag.exec(html))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return tag.lastIndex;
  }
  throw new Error("Unbalanced markup after the hero");
}

function inject(html, block) {
  const s = html.indexOf(START);
  if (s !== -1) {
    const e = html.indexOf(END, s) + END.length;
    return html.slice(0, s) + block + html.slice(e);
  }
  // The hero is the first Kadence row inside the page content.
  const content = html.indexOf('<div class="entry-content');
  const hero = html.indexOf('<div class="kb-row-layout-wrap', content);
  if (content === -1 || hero === -1) throw new Error("Homepage hero row not found");
  const at = closingDivEnd(html, hero);
  return html.slice(0, at) + "\n" + block + "\n" + html.slice(at);
}

function run() {
  const block = `${START}\n${fs.readFileSync(PARTIAL, "utf8").trim()}\n${END}`;
  fs.writeFileSync(HOME, inject(fs.readFileSync(HOME, "utf8"), block));
  console.log("home sections injected into public/index.html");
}

if (require.main === module) run();
module.exports = run;
