// Adds this repo's own pages to the mirrored WordPress site, which knows
// nothing about them:
//   - every page: a header bar trimmed to Our Solution, Peer Stories, About and
//     Contact (desktop + mobile drawer), with "For Corporate" moved under the
//     Our Solution dropdown; "Our Impact" (/community.html) and "Impact
//     Survey" (/bot/) in the footer, plus footer links to the policy pages
//     and the team login, which nothing linked to
//   - homepage: the community dashboard + survey sections after the hero
//     (scripts/home-sections.html)
//   - /the-art-of-healing-2026/: the festival details after the hero
//     (scripts/art-of-healing-2026.html), replacing WordPress's Canva embed
//
//   node scripts/site-additions.js
//
// Idempotent: everything it adds is wrapped in <!--wip:add:NAME--> markers and
// replaced on each run. The mirror script runs it after every refresh.

const fs = require("fs");
const path = require("path");

const PUBLIC = path.join(__dirname, "..", "public");

// Sections injected after a page's hero, keyed by path under public/. `drop`
// removes the WordPress row whose markup matches it (the content the section
// replaces); `after` places the section after the row whose markup matches it
// instead of after the hero; `rewrite` is a list of [pattern, replacement]
// edits to WordPress's own copy; `description` replaces the page's meta
// descriptions.
const PAGE_SECTIONS = {
  "index.html": { name: "home-sections", file: "home-sections.html" },
  "corporate/index.html": {
    name: "corporate-sections",
    file: "corporate-sections.html",
    // After the three "Well-being as risk mitigation" cards, before "How
    // myWIPHealing supports long-term organizational success".
    after: /Retaining talent is challenging/,
    // "How myWIPHealing supports long-term organizational success" and its
    // three module rows (Stress Management, Trust-Centered Communication,
    // Collaboration across functions): merged into the section's "How it
    // works" curriculum.
    drop: [
      /<div class="kb-row-layout-wrap kb-row-layout-id873_b11d08-49 /,
      /<div class="kb-row-layout-wrap kb-row-layout-id873_178e15-33 /,
      /<div class="kb-row-layout-wrap kb-row-layout-id873_c79218-bc /,
      /<div class="kb-row-layout-wrap kb-row-layout-id873_a89ede-2a /,
    ],
    rewrite: [
      [
        />Professionally guided mental health programs designed to reduce burnout, strengthen engagement, and support sustainable workforce performance\.</,
        ">Creative expression therapy that lowers stress, lifts productivity and helps every employee understand how they work best, with a training dashboard that shows you it&rsquo;s working.<",
      ],
    ],
    description:
      "Creative expression therapy for corporate teams: a stress audit and 6-month wellbeing programme, a 4-hour Self-Discovery Assessment " +
      "of personality and intelligence types, and a Corporate Training Dashboard that tracks programme effectiveness.",
  },
  "the-art-of-healing-2026/index.html": {
    name: "aoh-2026",
    file: "art-of-healing-2026.html",
    drop: /canva\.com\/design\//,
    description:
      "The Art of Healing '26 #back2roots: Saturday 10 October 2026, 11am-5pm at Mika Coffee Roaster, Ara Damansara. " +
      "Free entry: community weaving art, mental health coffee talk, congkak, ASWARA performance and open mic.",
  },
};

// Pages the site owns but WordPress's menus do not list. Linked from the
// footer (and the homepage sections), not the header.
const NAV_ITEMS = [
  { href: "/community.html", label: "Our Impact" },
  { href: "/bot/", label: "Impact Survey" },
];
const FOOTER_LEGAL = [
  { href: "/privacy-policy/", label: "Privacy Policy" },
  { href: "/ships-terms-of-service/", label: "SHIPS Terms of Service" },
  { href: "/admin.html", label: "Team login" },
];

// Secondary links that live under the header's "Our Solution" dropdown rather
// than on the bar itself. For Corporate is a WordPress menu item, moved here.
const SOLUTION_ITEMS = [
  { href: "/corporate/", label: "For Corporate" },
];

// With only four items on the bar, give them a little breathing room on
// desktop. Below 1025px Kadence swaps in the mobile drawer, which aligns each
// WordPress item through its kb-nav-link-* class; Peer Stories (rewritten
// below) has none, so it gets the same left alignment here.
const NAV_CSS = `<style>
@media (min-width:1025px){.wp-block-kadence-header-row .kadence-header-row-inner:has(.wip-nav-item) .menu-container > .menu > .wp-block-kadence-navigation-link{margin:0 .5em}}
@media (max-width:767px){.kb-navigation > .menu-item:not([class*="kb-nav-link-"]) > .kb-link-wrap.kb-link-wrap.kb-link-wrap.kb-link-wrap{--kb-nav-link-align:left;--kb-nav-link-flex-justify:start;--kb-nav-link-media-container-align-self:start}}
</style>`;

const TAB_CSS = `<style>
.wip-tab-links{display:flex;align-items:center;gap:4px;margin-right:8px;font-family:var(--global-heading-font-family,inherit)}
.wip-tab-links a{color:#1d1d1f;text-decoration:none;font-size:16px;padding:6px 10px;border-radius:100px;white-space:nowrap}
.wip-tab-links a:hover{background:rgba(29,29,31,.06)}
.wip-tab-links a.wip-tab-cta{background:#d5fc4b;border:1px solid #1d1d1f;padding:7px 16px;margin-left:6px}
.wip-tab-links a.wip-tab-cta:hover{background:#ef6442;color:#fff}
@media (max-width:767px){.wip-tab-links{gap:0;margin-right:6px}.wip-tab-links a{font-size:14px;padding:6px 8px}.wip-tab-links a.wip-tab-cta{padding:6px 12px;margin-left:2px}.wip-tab-links .wip-tab-wide{display:none}}
@media (max-width:359px){.wip-tab-links a:not(.wip-tab-cta){display:none}}
</style>`;

// Tablet/phone header bar: a few of the desktop menu words beside the menu
// button, so the bar isn't just a logo and a hamburger. The full menu stays in
// the drawer; phones keep only the words that fit (.wip-tab-wide hides).
const TAB_LINKS =
  `<nav class="wip-tab-links" aria-label="Quick links">` +
  `<a class="wip-tab-wide" href="/ships-peer-stories/">Peer Stories</a>` +
  `<a href="/about-us/">About</a>` +
  `<a class="wip-tab-wide" href="/contact/">Contact</a>` +
  `<a class="wip-tab-cta" href="#tally-open=Y5GB6q&#038;tally-layout=modal&#038;tally-width=390&#038;tally-emoji-text=👋&#038;tally-emoji-animation=wave">Request Proposal</a>` +
  `</nav>`;

// Homepage testimonials: the bottom-right card's only content was a background
// photo (uploads/2026/01/Testimonial-side.webp) that was deleted from WordPress,
// leaving an empty box. Hide that column while it is empty and let the
// Anonymous quote take the full row. Keyed on :empty, so if the card gets
// content in WordPress again it reappears on the next mirror.
const HOME_CSS = `<style>
.wp-block-kadence-column.kadence-column1204_b826b1-7f:has(> .kt-inside-inner-col:empty){display:none!important}
.kb-row-layout-wrap.kb-row-layout-id1204_0e2fb7-2d > .kt-row-column-wrap:has(> .kadence-column1204_b826b1-7f > .kt-inside-inner-col:empty){grid-template-columns:minmax(0,1fr)}
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
  const items = SOLUTION_ITEMS.map(
    (i) =>
      `<li class="wp-block-kadence-navigation-link menu-item wip-nav-item"><div class="kb-link-wrap">` +
      `<a class="kb-nav-link-content" href="${i.href}">${i.label}</a></div></li>\n`
  ).join("\n");
  return wrap("nav", items + "\n");
}

// Returns [html, list of additions that could not be placed].
function addToPage(html, { sections }) {
  const missed = [];
  html = strip(html);

  // Header "Resources" dropdown holds only Peer Stories: make it a plain link.
  // Rewrites WordPress's markup in place (not marker-wrapped), so re-runs find
  // nothing to do.
  const resDrop = /<li class="wp-block-kadence-navigation-link[^"]*menu-item-has-children[^"]*"><div class="kb-link-wrap"><a class="kb-nav-link-content" role="button">Resources<\/a>[\s\S]*?<\/ul><\/li>/g;
  html = html.replace(resDrop,
    `<li class="wp-block-kadence-navigation-link menu-item"><div class="kb-link-wrap"><a class="kb-nav-link-content" href="/ships-peer-stories/">Peer Stories</a></div></li>`);

  // WordPress's top-level "For Corporate" item: dropped here and re-added under
  // Our Solution below (marker-wrapped, so re-runs don't duplicate it).
  const corporate = /<li class="wp-block-kadence-navigation-link[^"]*"><div class="kb-link-wrap"><a class="kb-nav-link-content" href="\/corporate\/">For Corporate<\/a><\/div><\/li>\n*/g;
  html = html.replace(corporate, "");

  // Header menus (desktop + mobile drawer share the markup): at the end of the
  // "Our Solution" dropdown. Its sub-items hold no lists, so the first
  // </ul></li> after the label closes the dropdown.
  const solution = /(<a class="kb-nav-link-content" role="button">Our Solution<\/a>[\s\S]*?)(<\/ul><\/li>)/g;
  let navCount = 0;
  html = html.replace(solution, (m, head, end) => (navCount++, head + navItems() + end));
  if (!navCount) missed.push("header menu (no Our Solution dropdown)");
  else html = html.replace("</head>", wrap("head-style", NAV_CSS) + "\n</head>");

  // Tablet/phone header: quick links just before the off-canvas menu button.
  const tabRight = /(<div class="wp-block-kadence-header-column wp-block-kadence-header-column-tablet-right">[\s\S]*?)(<button class="wp-block-kadence-off-canvas-trigger)/;
  if (!tabRight.test(html)) missed.push("tablet header quick links");
  else {
    html = html.replace(tabRight, (m, head, btn) => head + wrap("tab-links", TAB_LINKS) + "\n" + btn);
    html = html.replace("</head>", wrap("tab-style", TAB_CSS) + "\n</head>");
  }

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

  if (sections) {
    // The hero is the first Kadence row inside the page content.
    const content = html.indexOf('<div class="entry-content');
    const hero = content === -1 ? -1 : html.indexOf('<div class="kb-row-layout-wrap', content);
    if (hero === -1) missed.push(`${sections.name} (no hero)`);
    else {
      for (const drop of [].concat(sections.drop || [])) {
        // Removes WordPress markup in place (not marker-wrapped), so re-runs
        // find nothing to do. Never the hero itself.
        const m = drop.exec(html.slice(hero));
        const row = m ? html.lastIndexOf('<div class="kb-row-layout-wrap', hero + m.index) : -1;
        if (row > hero) html = html.slice(0, row) + html.slice(closingDivEnd(html, row)).replace(/^\n+/, "");
      }
      for (const [pattern, replacement] of sections.rewrite || []) {
        // In place (not marker-wrapped): once rewritten the pattern no longer
        // matches, so re-runs find nothing to do.
        html = html.replace(pattern, replacement);
      }
      let at = closingDivEnd(html, hero);
      if (sections.after) {
        // Step through the top-level rows after the hero (rows nest, so the
        // nearest row start before the match may be an inner one) until one
        // contains the match.
        const m = sections.after.exec(html.slice(hero));
        const target = m ? hero + m.index : -1;
        let end = at;
        while (target > end) {
          const row = html.indexOf('<div class="kb-row-layout-wrap', end);
          if (row === -1) break;
          end = closingDivEnd(html, row);
        }
        if (target !== -1 && target < end) at = end;
        else missed.push(`${sections.name} (no row matching ${sections.after}; placed after the hero)`);
      }
      const block = wrap(sections.name, "\n" + fs.readFileSync(path.join(__dirname, sections.file), "utf8").trim() + "\n");
      // No newline after the block: strip() removes the one that follows it,
      // so adding one here would grow the page by a blank line per run.
      html = html.slice(0, at) + "\n" + block + html.slice(at);
    }
    if (sections.name === "home-sections") {
      html = html.replace("</head>", wrap("home-style", HOME_CSS) + "\n</head>");
    }
    if (sections.description) {
      const d = sections.description.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
      html = html.replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*"/g, `$1${d}"`);
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
  for (const file of wordpressPages()) {
    const rel = path.relative(PUBLIC, file).replace(/\\/g, "/");
    const [html, missed] = addToPage(fs.readFileSync(file, "utf8"), { sections: PAGE_SECTIONS[rel] });
    fs.writeFileSync(file, html);
    console.log(missed.length ? `${rel}: could not add ${missed.join(", ")}` : `${rel}: ok`);
  }
}

if (require.main === module) run();
module.exports = run;
