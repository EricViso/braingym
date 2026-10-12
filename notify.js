// Member email notifications for WIP Harmoni Circle, over Resend's HTTP API.
//
// No SDK dependency, same as supabase.js: plain fetch against
// https://api.resend.com. Every export swallows its own errors and reports
// how it went as a boolean or a count. An email is a courtesy on top of
// something that already happened (an RSVP saved, a proposal approved), so a
// mail outage must never turn into a failed request for the member.
//
// Without RESEND_API_KEY nothing is sent; each attempt is logged and skipped.

const API_KEY = (process.env.RESEND_API_KEY || "").trim();
// A Resend key is one token like "re_AbC123…". Anything else (a pasted code
// sample, quotes, "Bearer …") would only fail later with a confusing error.
const KEY_PROBLEM = API_KEY && !/^re_[A-Za-z0-9_-]+$/.test(API_KEY)
  ? "RESEND_API_KEY doesn't look like a Resend key. In Vercel it should be only the key, one line starting with re_ (no quotes, spaces or code). "
    + keyHint(API_KEY)
  : null;

// What's wrong with a bad key, without giving the key away.
function keyHint(k) {
  const found = [];
  if (/["'`]/.test(k)) found.push("it contains quotes");
  if (/\s/.test(k)) found.push("it contains spaces or line breaks");
  if (/^bearer/i.test(k)) found.push('it starts with "Bearer"');
  else if (!k.includes("re_")) found.push(`it starts with "${k.slice(0, 6).replace(/[^\x20-\x7e]/g, "?")}…" and has no "re_" in it`);
  else if (!k.startsWith("re_")) found.push('there is something before the "re_"');
  return `The current value is ${k.length} characters long${found.length ? "; " + found.join(", ") : ""}.`;
}
const FROM = process.env.NOTIFY_FROM || "WIP Healing <hello@mywiphealing.com>";
// The www host is the one Supabase Auth redirects back to (see README).
const SITE_URL = (process.env.SITE_URL || "https://www.mywiphealing.com").replace(/\/+$/, "");
const CIRCLE_URL = `${SITE_URL}/circle/`;
const TZ = "Asia/Kuala_Lumpur";

const enabled = Boolean(API_KEY);

// ---------- preferences ----------

// What a member can switch off from their profile. Missing keys mean "on".
const NOTIFY_KEYS = ["rsvp", "listing", "newEvents", "reminders", "surveys"];

function prefs(member) {
  const n = (member && member.data && member.data.notify) || {};
  return Object.fromEntries(NOTIFY_KEYS.map((k) => [k, n[k] !== false]));
}

const wants = (member, kind) => Boolean(member && member.email) && prefs(member)[kind];

// ---------- sending ----------

async function post(path, payload, timeoutMs = 8000) {
  // Serverless functions have a hard wall-clock budget; a hanging mail API
  // must not eat the request's remaining time.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.resend.com${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

// For the logs: enough of an address to tell who it went to, not the whole thing.
const maskEmail = (to) => String(to).replace(/^(.{2})[^@]*/, "$1…");

// One email: { to, subject, html, text }. Resolves true when Resend took it.
async function send(msg) {
  return (await sendReport(msg)).sent;
}

// The same, reporting what happened: { sent, to, error }, so an admin action
// can say on screen whether its email went out.
async function sendReport(msg) {
  if (!msg || !msg.to) return { sent: false, error: "No email address" };
  const to = maskEmail(msg.to);
  if (!enabled) {
    console.log(`Email skipped (RESEND_API_KEY not set): "${msg.subject}"`);
    return { sent: false, to, error: "RESEND_API_KEY is not set on this deployment" };
  }
  if (KEY_PROBLEM) {
    console.error(`Email "${msg.subject}" not sent: ${KEY_PROBLEM}`);
    return { sent: false, to, error: KEY_PROBLEM };
  }
  try {
    await post("/emails", { from: FROM, ...msg });
    console.log(`Email sent: "${msg.subject}" to ${to}`);
    return { sent: true, to };
  } catch (e) {
    console.error(`Email "${msg.subject}" failed:`, e.message);
    return { sent: false, to, error: e.name === "AbortError" ? "Resend didn't answer in time" : e.message };
  }
}

// Many emails, 100 per Resend batch call. Resolves to the messages that were
// accepted, so callers can record exactly who was reached.
async function sendMany(msgs) {
  const list = (msgs || []).filter((m) => m && m.to);
  if (!list.length) return [];
  if (!enabled) {
    console.log(`${list.length} email(s) skipped (RESEND_API_KEY not set): "${list[0].subject}"`);
    return [];
  }
  if (KEY_PROBLEM) {
    console.error(`${list.length} email(s) "${list[0].subject}" not sent: ${KEY_PROBLEM}`);
    return [];
  }
  const sent = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100);
    try {
      await post("/emails/batch", chunk.map((m) => ({ from: FROM, ...m })), 15000);
      sent.push(...chunk);
      console.log(`Emails sent: ${chunk.length} × "${chunk[0].subject}"`);
    } catch (e) {
      console.error(`Email batch "${chunk[0].subject}" failed:`, e.message);
    }
  }
  return sent;
}

// ---------- formatting ----------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "there";

function when(dateTime) {
  const t = new Date(dateTime);
  if (isNaN(t.getTime())) return "";
  return t.toLocaleString("en-MY", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function where(d) {
  const mode = { online: "Online", hybrid: "Hybrid" }[d.venueMode];
  return [mode ? `${mode}: ${d.venueName || ""}` : d.venueName, d.venueAddress].filter(Boolean).join(", ");
}

const clip = (s, max) => (String(s).length > max ? String(s).slice(0, max - 1).trimEnd() + "…" : String(s));

const seats = (pax) => `${pax} seat${pax === 1 ? "" : "s"}`;

// One email in both forms. `rows` are [label, value] pairs shown as a small
// details table; `note` is a quoted block (the WIP team's words); `cta` is
// { label, url }. Every string passed in is plain text and escaped here.
function layout({ subject, heading, intro, rows = [], note, noteLabel, cta, outro }) {
  const button = cta || { label: "Open the Circle", url: CIRCLE_URL };
  const rowsHtml = rows
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6e6e73;font-size:14px;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#1d1d1f">${esc(v)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#F5EFE6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE6;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1.5px solid #1d1d1f;border-radius:20px;font-family:Inter,Helvetica,Arial,sans-serif;color:#1d1d1f">
<tr><td style="padding:22px 26px 0"><div style="font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:#2a6f2b">WIP Harmoni Circle</div>
<h1 style="font-size:22px;line-height:1.3;margin:8px 0 12px">${esc(heading)}</h1>
<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${esc(intro)}</p>
${rowsHtml ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 14px">${rowsHtml}</table>` : ""}
${note ? `<div style="background:#FFF1C2;border-radius:14px;padding:12px 14px;margin:0 0 14px;font-size:14px;line-height:1.55"><strong>${esc(noteLabel || "From the WIP team")}:</strong><br>${esc(note).replace(/\n/g, "<br>")}</div>` : ""}
<p style="margin:18px 0"><a href="${esc(button.url)}" style="display:inline-block;background:#D5FC4B;color:#1d1d1f;border:1.5px solid #1d1d1f;border-radius:999px;padding:11px 20px;font-weight:700;font-size:15px;text-decoration:none">${esc(button.label)}</a></p>
${outro ? `<p style="font-size:14px;line-height:1.6;margin:0 0 14px;color:#3a3a3c">${esc(outro)}</p>` : ""}
</td></tr>
<tr><td style="padding:14px 26px 20px;border-top:1px solid #eee;font-size:12px;line-height:1.5;color:#6e6e73">With warmth, the WIP Healing team · <a href="${esc(SITE_URL)}" style="color:#2a6f2b">mywiphealing.com</a><br>
You can change which emails you get under Email notifications in <a href="${esc(CIRCLE_URL)}#me" style="color:#2a6f2b">your profile</a>.</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    heading,
    "",
    intro,
    "",
    ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
    ...(note ? ["", `${noteLabel || "From the WIP team"}:`, note] : []),
    "",
    `${button.label}: ${button.url}`,
    ...(outro ? ["", outro] : []),
    "",
    "With warmth, the WIP Healing team",
    `Change your email settings: ${CIRCLE_URL}#me`,
  ].join("\n");

  return { subject, html, text };
}

// ---------- messages ----------

const eventRows = (d) => [["When", when(d.dateTime)], ["Where", where(d)]];

// RSVP saved. `r` is the stored RSVP; `paymentUrl` is only set when this
// member owes payment for a confirmed (not waitlisted) seat.
function rsvpConfirmation(member, d, r, paymentUrl) {
  const title = d.title || "your Circle";
  let subject, heading, intro;
  if (r.waitlisted) {
    subject = `You're on the waitlist: ${title}`;
    heading = "You're on the waitlist";
    intro = `Hi ${firstName(member.name)}, ${title} is full right now, so we've put you on the waitlist for ${seats(r.pax)}. If a seat opens up, the host or the WIP team will be in touch.`;
  } else if (r.status === "maybe") {
    subject = `Noted as maybe: ${title}`;
    heading = "Noted as maybe";
    intro = `Hi ${firstName(member.name)}, we've noted you as a maybe for ${title}. Change it to going whenever you're ready.`;
  } else {
    subject = `You're going: ${title}`;
    heading = "You're going! 🌱";
    intro = `Hi ${firstName(member.name)}, your RSVP for ${title} is in: ${seats(r.pax)}. We can't wait to see you there.`;
  }
  return {
    to: member.email,
    ...layout({
      subject,
      heading,
      intro,
      rows: [...eventRows(d), ["Seats", String(r.pax)], ["Payment", paymentUrl ? "Pending: please pay to hold your seat" : ""]],
      cta: paymentUrl ? { label: "Pay to hold your seat", url: paymentUrl } : { label: "See the Circle", url: CIRCLE_URL },
      outro: paymentUrl ? `Your seat is held as payment pending until the WIP team marks it paid. You can also view the Circle at ${CIRCLE_URL}` : "",
    }),
  };
}

function rsvpWithdrawn(member, d) {
  const title = d.title || "the Circle";
  return {
    to: member.email,
    ...layout({
      subject: `RSVP withdrawn: ${title}`,
      heading: "Your RSVP is withdrawn",
      intro: `Hi ${firstName(member.name)}, you're no longer on the list for ${title}. Changed your mind? You can RSVP again any time while there are seats.`,
      rows: eventRows(d),
      outro: "If you paid for this Circle, the WIP team will be in touch about a refund.",
    }),
  };
}

// The proposer's view of their listing. `status` is the new one; `resubmitted`
// marks a needs_revision proposal sent back in.
function listingStatus(to, name, d, status, note, { resubmitted = false, revision = null } = {}) {
  const title = d.title || "your Circle";
  const hi = `Hi ${firstName(name)}`;
  const myCircles = { label: "See it in My Circles", url: `${CIRCLE_URL}#me` };
  const copy = {
    under_review: {
      subject: resubmitted ? `Resubmitted, back in review: ${title}` : `Submitted, in review: ${title}`,
      heading: resubmitted ? "Thanks, your changes are in" : "Your Circle is in review",
      intro: resubmitted
        ? `${hi}, your updated proposal for ${title} is back with the WIP team. We'll be in touch once we've had a look.`
        : `${hi}, terima kasih for proposing ${title}! The WIP team will review the numbers, the venue and the safeguarding plan, and let you know what's next.`,
      cta: myCircles,
    },
    approved: {
      subject: `Live: ${title}`,
      heading: "Your Circle is live! 🎉",
      intro: `${hi}, ${title} is approved and now on the member hub. Members can RSVP from today.`,
      cta: { label: "See your Circle", url: CIRCLE_URL },
    },
    needs_revision: {
      subject: `To revise: ${title}`,
      heading: "A few changes, then we're nearly there",
      intro: `${hi}, the WIP team has read ${title} and would like a few changes before it goes live. Open it from My Circles, check any edits we made, update what's flagged and send it back.`,
      cta: { label: "Review & resubmit", url: `${CIRCLE_URL}#me` },
    },
    rejected: {
      subject: `Not approved: ${title}`,
      heading: "This one isn't going ahead",
      intro: `${hi}, thank you for the care you put into ${title}. The WIP team isn't able to approve it this time. You're always welcome to propose another Circle.`,
      cta: myCircles,
    },
    cancelled: {
      subject: `Cancelled: ${title}`,
      heading: "Your Circle has been cancelled",
      intro: `${hi}, ${title} has been cancelled and taken off the member hub. The WIP team will follow up with you and anyone who RSVP'd.`,
      cta: myCircles,
    },
  }[status];
  if (!copy || !to) return null;
  return {
    to,
    ...layout({
      ...copy,
      rows: eventRows(d),
      note: status === "under_review" ? "" : status === "needs_revision" ? revisionNote(note, revision) : note,
      noteLabel: status === "needs_revision" ? "What to revise" : "Note from the WIP team",
    }),
  };
}

// The change request in plain text: the WIP team's note, the fields they
// flagged for the host, and the edits they already made for the host to check.
function revisionNote(note, revision) {
  const parts = note ? [note] : [];
  const r = revision || {};
  if (r.flags && r.flags.length) {
    parts.push("Please rework:\n" + r.flags.map((f) => `• ${f.label}${f.note ? `: ${f.note}` : ""}`).join("\n"));
  }
  if (r.changes && r.changes.length) {
    parts.push("We've edited these for you, please check them:\n" + r.changes.map((c) => `• ${c.label}: ${clip(c.field === "dateTime" ? when(c.to) : c.to, 160) || "(cleared)"}`).join("\n"));
  }
  return parts.join("\n\n");
}

function newCircle(member, d) {
  const title = d.title || "A new Circle";
  const price = Number(d.ticketPrice) > 0 ? `RM ${Number(d.ticketPrice).toLocaleString("en-MY", { maximumFractionDigits: 2 })}` : "Free";
  return {
    to: member.email,
    ...layout({
      subject: `New Circle: ${title}`,
      heading: `New Circle: ${title}`,
      intro: `Hi ${firstName(member.name)}, a new Circle${d.createdBy && d.createdBy.name ? ` hosted by ${firstName(d.createdBy.name)}` : ""} just opened for RSVPs.${d.coreActivity ? ` ${clip(d.coreActivity, 300)}` : ""}`,
      rows: [...eventRows(d), ["Theme", d.theme], ["Ticket", price], ["Seats", d.capacity ? String(d.capacity) : ""]],
      cta: { label: "RSVP on the Circle", url: CIRCLE_URL },
    }),
  };
}

function reminder(member, d, r) {
  const title = d.title || "your Circle";
  return {
    to: member.email,
    ...layout({
      subject: `See you soon: ${title}`,
      heading: "Your Circle is coming up",
      intro: `Hi ${firstName(member.name)}, a gentle reminder that ${title} is coming up soon. You've got ${seats(r.pax)}.`,
      rows: [...eventRows(d), ["Accessibility", d.accessibility]],
      cta: { label: "See the details", url: CIRCLE_URL },
      outro: "Can't make it any more? Withdraw your RSVP on the Circle page so someone on the waitlist can have your seat.",
    }),
  };
}

// After a Circle: a link to the impact survey, signed for this member and
// Circle so their answers can show up in their own progress view.
function surveyInvite(member, d, surveyUrl) {
  const title = d.title || "your Circle";
  return {
    to: member.email,
    ...layout({
      subject: `How was it? ${title}`,
      heading: "How was your Circle?",
      intro: `Hi ${firstName(member.name)}, thank you for coming to ${title}. Would you share how it went? It's a short chat with Seni, our survey guide, and takes about 5 minutes.`,
      rows: eventRows(d),
      cta: { label: "Share how it went", url: surveyUrl },
      outro: "Your answers help the WIP team shape future Circles, and they build your own progress view in My Circles. Only you and the WIP team see your answers.",
    }),
  };
}

module.exports = {
  enabled,
  sendReport,
  SITE_URL,
  CIRCLE_URL,
  NOTIFY_KEYS,
  prefs,
  wants,
  send,
  sendMany,
  rsvpConfirmation,
  rsvpWithdrawn,
  listingStatus,
  newCircle,
  reminder,
  surveyInvite,
};
