// Adds this repo's own pages to the mirrored WordPress site, which knows
// nothing about them:
//   - every page: "Our Impact" (/community.html) and "Impact Survey" (/bot/)
//     in the header menu (desktop + mobile drawer) and the footer, plus footer
//     links to the policy pages and the team login, which nothing linked to
//   - homepage: the community dashboard + survey sections after the hero
//     (scripts/home-sections.html)
//
//   node scripts/site-additions.js
//
// Idempotent: everything it adds is wrapped in <!--wip:add:NAME--> markers and
// replaced on each run. The mirror script runs it after every refresh.

const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "public");
const HOME_SECTIONS = path.join(__dirname, "home-sections.html");

// Pages the site owns but WordPress's menus do not list.
const NAV_ITEMS = [
  { href: "/community.html", label: "Our Impact" },
  { href: "/bot/", label: "Impact Survey" },
];
const FOOTER_LEGAL = [
  { href: "/privacy-policy/", label: "Privacy Policy" },
  { href: "/ships-terms-of-service/", label: "SHIPS Terms of Service" },
  { href: "/admin.html", label: "Team login" },
];

// WordPress sized the desktop menu bar (900px) for its own seven items; widen
// it for the two added here, and tighten spacing on narrow desktops so the
// menu stays on one line. Below 1025px Kadence swaps in the mobile drawer.
const NAV_CSS = `<style>
@media (min-width:1025px){
.wp-block-kadence-header .kb-header-container:has(.wip-nav-item),
.wp-block-kadence-header-row .kadence-header-row-inner:has(.wip-nav-item){max-width:1180px}}
@media (min-width:1025px) and (max-width:1279px){.wp-block-kadence-header-row .kadence-header-row-inner:has(.wip-nav-item) .kb-nav-link-content{font-size:15px;--kb-nav-link-padding-left:.3em;--kb-nav-link-padding-right:.3em}}
</style>`;

const wrap = (name, html) => `<!--wip:add:${name}-->${html}<!--/wip:add:${name}-->`;

function strip(html) {
  return html
    .replace(/<!--wip:add:(\w[\w-]*)-->[\s\S]*?<!--\/wip:add:\1-->\n?/g, "")
    // Marker style used before this script covered more than the homepage.
    .replace(/<!-- wip:home-sections:start -->[\s\S]*?<!-- wip:home-sections:end -->\n?/g, "");
}

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

function navItems() {
  const items = NAV_ITEMS.map(
    (i) =>
      `<li class="wp-block-kadence-navigation-link menu-item wip-nav-item"><div class="kb-link-wrap">` +
      `<a class="kb-nav-link-content" href="${i.href}">${i.label}</a></div></li>\n`
  ).join("\n");
  return wrap("nav", items + "\n");
}

// Returns [html, list of additions that could not be placed].
function addToPage(html, { home }) {
  const missed = [];
  html = strip(html);

  // Header menus (desktop + mobile drawer share the markup): before "About".
  const about = /<li class="wp-block-kadence-navigation-link[^"]*"><div class="kb-link-wrap"><a class="kb-nav-link-content" href="\/about-us\/">/g;
  let navCount = 0;
  html = html.replace(about, (m) => (navCount++, navItems() + m));
  if (!navCount) missed.push("header menu (no About item)");
  else html = html.replace("</head>", wrap("head-style", NAV_CSS) + "\n</head>");

  // Footer "Resources" menu.
  const res = html.indexOf('id="menu-resources"');
  const resEnd = res === -1 ? -1 : html.indexOf("</ul>", res);
  if (resEnd === -1) missed.push("footer Resources menu");
  else {
    const lis = NAV_ITEMS.map((i) => `<li class="menu-item"><a href="${i.href}">${i.label}</a></li>\n`).join("");
    html = html.slice(0, resEnd) + wrap("footer-menu", lis) + html.slice(resEnd);
  }

  // Footer bottom bar, under the copyright line.
  const copy = /All Rights Reserved\.<\/p>/;
  if (!copy.test(html)) missed.push("footer copyright line");
  else {
    const links = FOOTER_LEGAL.map((l) => `<a href="${l.href}">${l.label}</a>`).join(" &middot; ");
    html = html.replace(copy, (m) => m + wrap("footer-legal", `<p class="wip-footer-legal" style="margin-top:6px;font-size:14px">${links}</p>`));
  }

  if (home) {
    // The hero is the first Kadence row inside the page content.
    const content = html.indexOf('<div class="entry-content');
    const hero = content === -1 ? -1 : html.indexOf('<div class="kb-row-layout-wrap', content);
    if (hero === -1) missed.push("homepage hero");
    else {
      const at = closingDivEnd(html, hero);
      const block = wrap("home-sections", "\n" + fs.readFileSync(HOME_SECTIONS, "utf8").trim() + "\n");
      html = html.slice(0, at) + "\n" + block + "\n" + html.slice(at);
    }
  }
  return [html, missed];
}

// Every mirrored WordPress page: public/index.html and public/**/index.html,
// except the survey, which is this repo's own page.
function wordpressPages(dir = PUBLIC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!["bot", "img", "wp-content", "wp-includes"].includes(e.name)) wordpressPages(p, out);
    } else if (e.name === "index.html" && fs.readFileSync(p, "utf8").includes("/wp-content/")) {
      out.push(p);
    }
  }
  return out;
}

function run() {
  const home = path.join(PUBLIC, "index.html");
  for (const file of wordpressPages()) {
    const [html, missed] = addToPage(fs.readFileSync(file, "utf8"), { home: file === home });
    fs.writeFileSync(file, html);
    const rel = path.relative(PUBLIC, file).replace(/\\/g, "/");
    console.log(missed.length ? `${rel}: could not add ${missed.join(", ")}` : `${rel}: ok`);
  }
}

if (require.main === module) run();
module.exports = run;
