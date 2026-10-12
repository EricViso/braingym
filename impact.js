// Impact themes per programme, taken from what each initiative sets out to do
// in the 3C Ecosystem Initiatives & Rate Card (2026). The community dashboard
// sizes each theme by how many participants used words about it in their
// reflections, so "What participants carry away" reads against the
// programme's own definition rather than as a loose word cloud.
//
// Keywords are English and Bahasa Malaysia, lower case. Each one matches at
// the start of a word, so "connect" also catches "connected" / "connection".
// Malay affixed forms (berkongsi, terhubung) are listed in full.

const T = {
  connection: { label: "Connection", words: ["connect", "together", "bond", "belong", "friend", "community", "group connection", "hubung", "terhubung", "bersama", "kawan", "rakan", "ikatan", "kekitaan", "komuniti"] },
  safeToShare: { label: "Safe to share", words: ["safe", "share", "sharing", "heard", "listen", "open up", "trust", "selamat", "kongsi", "berkongsi", "didengari", "dengar", "mendengar", "percaya"] },
  lessAlone: { label: "Less alone", words: ["not alone", "less alone", "reduced isolation", "less lonely", "tidak keseorangan", "kurang rasa keseorangan", "tidak sendiri"] },
  expression: { label: "Self-expression", words: ["express", "creative", "creat", "art", "draw", "paint", "writ", "free", "ekspresi", "meluah", "luah", "kreatif", "berkarya", "karya", "lukis", "tulis", "bebas"] },
  awareness: { label: "Emotional awareness", words: ["emotional awareness", "aware", "feeling", "emotion", "understand", "notic", "recogni", "name my", "naming", "sedar", "perasaan", "emosi", "faham", "menamakan"] },
  calm: { label: "Calm & release", words: ["calm", "peace", "relax", "relief", "reliev", "release", "lighter", "tenang", "damai", "lega", "ringan", "menenangkan"] },
  selfWorth: { label: "Self-worth", words: ["self-worth", "worth", "deserve", "confident", "kinder to myself", "love myself", "stronger", "empower", "yakin", "layak", "sayang diri", "disayangi", "kuat", "berharga"] },
  joy: { label: "Joy & inspiration", words: ["joy", "happ", "fun", "playful", "inspir", "moved", "enjoy", "gembira", "seronok", "ceria", "kegembiraan", "terinspirasi", "tersentuh"] },
  selfCare: { label: "Self-care", words: ["self-care", "self care", "self-love", "care for myself", "keep creating", "rest", "jaga diri", "sayang diri", "rehat"] },
  seekSupport: { label: "Knows where to find support", words: ["support", "help", "talk to someone", "counsel", "sokongan", "bantuan", "kaunseling", "bercakap dengan"] },
  awarenessPublic: { label: "Mental health awareness", words: ["mental health", "awareness", "kesihatan mental", "kesedaran"] },
  stigma: { label: "Breaking stigma", words: ["stigma", "taboo", "judg", "accept", "normal", "starts conversation", "open conversation", "relatable", "stigma reduction", "membuka perbualan", "terima", "mudah difahami"] },
  artCulture: { label: "Art & culture", words: ["art", "performance", "perform", "culture", "music", "dance", "exhibition", "show", "seni", "persembahan", "budaya", "muzik", "tari", "pameran"] },
  body: { label: "Body & movement", words: ["movement", "move", "body", "dance", "theatre", "somatic", "gerak", "pergerakan", "badan", "tubuh", "tari", "teater"] },
  selfDiscovery: { label: "Self-discovery", words: ["self-discovery", "discover", "about myself", "learned", "learnt", "realis", "realiz", "i am", "i can", "mengenali diri", "tentang diri", "saya mampu", "saya lebih"] },
  empathy: { label: "Empathy", words: ["empath", "understand others", "compassion", "kind", "empati", "memahami"] },
  resilience: { label: "Resilience", words: ["resilien", "strong", "brave", "courage", "cope", "tabah", "kuat", "berani"] },
  skills: { label: "Skills & learning", words: ["skill", "learn", "tool", "technique", "knowledge", "kemahiran", "belajar", "ilmu", "teknik"] },
  leadership: { label: "Leadership & facilitation", words: ["lead", "facilitat", "guide", "hold space", "pimpin", "fasilitator", "bimbing"] },
  supportOthers: { label: "Supporting others", words: ["support others", "help others", "peer", "support someone", "sokong", "bantu orang", "membantu orang"] },
  burnout: { label: "Burnout relief", words: ["less stress", "recharg", "refresh", "relief", "reliev", "rest", "kurang tekanan", "lega", "rehat", "segar"] },
  access: { label: "Access from anywhere", words: ["online", "anywhere", "from home", "access", "dalam talian", "dari rumah", "mudah"] },
  mindfulness: { label: "Mindfulness & focus", words: ["mindful", "focus", "flow", "present", "meditat", "fokus", "meditasi"] },
  nature: { label: "Nature", words: ["nature", "forest", "sea", "river", "beach", "green", "outdoor", "alam", "hutan", "laut", "sungai", "pantai", "semula jadi"] },
  detox: { label: "Digital detox", words: ["detox", "offline", "phone", "screen", "disconnect", "telefon", "skrin"] },
  heritage: { label: "Culture & heritage", words: ["culture", "heritage", "tradition", "artisan", "local", "nusantara", "budaya", "warisan", "tradisi"] },
  teamBond: { label: "Team bonding", words: ["team", "colleague", "together", "bond", "pasukan", "rakan sekerja", "bersama"] },
};

// The outcomes each programme is designed for, most central first.
const IMPACT_THEMES = {
  "wip-harmoni-circle": [T.connection, T.safeToShare, T.lessAlone, T.expression, T.awareness, T.calm, T.selfWorth],
  "seni-scape": [T.expression, T.awareness, T.calm, T.joy, T.selfCare, T.seekSupport, T.connection],
  "art-of-healing-festival": [T.awarenessPublic, T.stigma, T.artCulture, T.connection, T.joy, T.expression],
  "art-of-healing-aswara": [T.body, T.expression, T.awareness, T.selfDiscovery, T.connection, T.empathy, T.stigma, T.resilience],
  "wip-nadi-workshop": [T.skills, T.leadership, T.supportOthers, T.burnout, T.expression, T.connection],
  "wip-ruang-discord": [T.connection, T.lessAlone, T.access, T.mindfulness, T.skills, T.calm],
  "wip-rantau-retreat": [T.nature, T.detox, T.calm, T.heritage, T.teamBond, T.expression],
};

// Answers that say the opposite of an outcome ("I found it hard to express
// what I feel") or nothing at all are not read for themes.
const NEGATIVE = /\b(hard to|difficult|shy|careful|not sure|unsure|no change|nothing|did not|didn't|tidak pasti|sukar|malu|tiada)\b/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiled = new Map();
function matcher(theme) {
  if (!compiled.has(theme)) {
    compiled.set(theme, new RegExp(`(?:^|[^\\p{L}])(?:${theme.words.map(escapeRe).join("|")})`, "iu"));
  }
  return compiled.get(theme);
}

// rows: [{ texts: [string] }] - one entry per participant, holding their
// reflection answers and the themes read from them. Returns { n, items } where n is how
// many participants left any usable words and each item counts the
// participants whose words touch that theme.
function impactWords(programId, rows) {
  const themes = IMPACT_THEMES[programId] || [];
  const texts = rows
    .map((r) => r.texts.filter((t) => t && !NEGATIVE.test(t)).join(" \n "))
    .filter((t) => t.trim());
  return {
    n: texts.length,
    items: themes.map((th) => ({ label: th.label, count: texts.filter((t) => matcher(th).test(t)).length })),
  };
}

module.exports = { IMPACT_THEMES, impactWords };
