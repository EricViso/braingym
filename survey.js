// The questionnaire, as data rather than one long prompt string.
//
// Questions change between programmes and between phases, and previously that
// meant editing a ~40-line template literal and then hunting down every field
// name it implied across stats.js and the dashboards. Defining them here means
// question numbering, quick-reply buttons, the completion JSON template and the
// dashboard field labels are all generated from one place.
//
// Field names are the keys stored in `data`. Adding one needs no database
// migration - responses are stored as jsonb. Dashboard labels, the CSV columns
// and the stats lists pick new questions up from here: give a question a
// `label`, and `quote: true` if its answer may be approved as a testimonial.
//
// Shape of the survey: Question 1 asks the programme, and everything after it
// is that programme's own list of sections (PROGRAM_SECTIONS).
//   Harmoni Circle - single-session check-in: About you, the before (B) and
//     after (D) 1-5 batteries that the before/after numbers on the dashboards
//     are built from, plus its own C and E.
//   Seni Scape - the WIP Seni Scape Impact Survey form: demographics,
//     reflection & impact, programme feedback.
//   Art of Healing Festival - general public: how the full day felt, plus a
//     post-event review.
//   Art of Healing x ASWARA - the Movement, Dance & Theatre Art Therapy research
//     questionnaire: its own demographics, 16 agreement scales (B1-B5) and
//     five reflections. It is retrospective, so it has no before/after battery.

const SCALE_1_5 = [
  "1 - No, not at all / Tidak sama sekali",
  "2 - A little bit / Sedikit",
  "3 - In the middle / Sederhana",
  "4 - Yes, mostly / Ya, kebanyakannya",
  "5 - Yes, completely / Ya, sepenuhnya",
];

const SCALE_UNDERSTANDING = [
  "1 - Unsure / Tidak pasti",
  "2 - No understanding / Tidak faham",
  "3 - Limited understanding / Fahaman terhad",
  "4 - Understand the importance / Faham tentang kepentingan",
  "5 - Understand and use it in life / Faham dan menggunakan dalam kehidupan",
];

// Programmes offered. `id` is what gets stored in data.program and what the
// corporate dashboard filters on, so keep these stable once responses exist.
// The label is what the participant taps, in both languages.
// `aliases` are other spellings found in stored data (older labels, the CSV
// imports), so those responses still land under the right programme.
const PROGRAMS = [
  { id: "wip-harmoni-circle", label: "WIP Harmoni Circle", aliases: ["Harmoni Circle"] },
  { id: "seni-scape", label: "WIP Seni Scape", aliases: ["Seni Scape"] },
  // Two Art of Healing questionnaires behind ONE Question 1 button (`group`):
  // the festival is the general public event; the ASWARA entry is the
  // Movement, Dance & Theatre Art Therapy programme with its own research
  // questionnaire. Question 2 (PROGRAM_GROUPS) picks between them. They stay
  // separate programmes in the stored data and on the dashboards.
  { id: "art-of-healing-festival", group: "art-of-healing", label: "Art of Healing Festival", aliases: ["WIP Art of Healing"] },
  { id: "art-of-healing-aswara", group: "art-of-healing", label: "Art of Healing x ASWARA Art Therapy", aliases: ["Art of Healing ASWARA", "ASWARA Art Therapy", "art-of-healing"] },
  // No questionnaire of their own yet: these get the general check-in
  // (GENERAL_SECTIONS) until one is written into PROGRAM_SECTIONS.
  { id: "wip-nadi-workshop", label: "WIP Nadi Workshop" },
  { id: "wip-ruang-discord", label: "WIP Ruang Discord" },
  { id: "wip-rantau-retreat", label: "WIP Rantau Retreat" },
];

// Stored data.program value (id, label or alias, any case) -> programme id,
// or null when it names no known programme.
function programId(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  const hit = PROGRAMS.find((p) => [p.id, p.label, ...(p.aliases || [])].some((x) => x.toLowerCase() === v));
  return hit ? hit.id : null;
}

const SCALE_EFFECTIVE = [
  "1 - Not effective / Tidak berkesan",
  "2 - Slightly / Sedikit berkesan",
  "3 - Moderately / Sederhana berkesan",
  "4 - Very / Sangat berkesan",
  "5 - Extremely / Amat berkesan",
];

const SCALE_AGREE = [
  "1 - Strongly Disagree / Sangat Tidak Setuju",
  "2 - Disagree / Tidak Setuju",
  "3 - Neutral / Neutral",
  "4 - Agree / Setuju",
  "5 - Strongly Agree / Sangat Setuju",
];

// A group is one Question 1 button that leads to a follow-up question, whose
// answer picks which of the group's programmes (and so which questionnaire)
// the participant gets. `routes` maps each option, in order, to a programme id.
const PROGRAM_GROUPS = {
  "art-of-healing": {
    label: "Art of Healing",
    question: {
      field: "aoh_joined",
      label: "Art of Healing part joined",
      category: true,
      text: "Which part of Art of Healing did you join? / Bahagian Art of Healing manakah yang anda sertai?",
      options: [
        "Art of Healing Festival",
        "ASWARA Creative Expression programme / Program Ekspresi Kreatif ASWARA",
      ],
      note: 'Store "Festival" or "ASWARA Creative Expression".',
    },
    routes: ["art-of-healing-festival", "art-of-healing-aswara"],
  },
};
const groupOf = (id) => PROGRAM_GROUPS[(PROGRAMS.find((p) => p.id === id) || {}).group];

// Question 1, asked of everyone. The answer selects which sections follow. A
// group shows as a single button.
const PROGRAM_QUESTION = {
  field: "program",
  text: "Which myWIPhealing program are you joining? / Program myWIPhealing manakah yang anda sertai?",
  options: [...new Set(PROGRAMS.map((p) => (p.group ? PROGRAM_GROUPS[p.group].label : p.label)))],
};

// Demographics more than one programme asks, defined once.
const NAME = { field: "name", optional: true, text: "Name or nickname / Nama atau nama samaran (anonymous is fine)" };
const AGE_GROUP = { field: "age_group", text: "Age group / Golongan umur", options: ["Under 13", "13-17", "18-25", "26-40", "41-60", "60+"] };
const GENDER = {
  field: "gender",
  text: "Gender / Jantina",
  options: ["Female / Perempuan", "Male / Lelaki", "Other / Lain-lain", "Prefer not to say / Tidak mahu nyatakan"],
  note: 'Store "Female", "Male", "Prefer not to say", or their own words if they type something else.',
};
const EMAIL = { field: "email", optional: true, text: "Email address / Alamat emel" };
const PHONE = { field: "phone", optional: true, text: "Phone number / Nombor telefon" };
// Tick-all-that-apply: the chat page lets several be picked before sending.
const COMMUNITY_ROLE = {
  field: "community_role",
  multi: true,
  text: "Community role (you can choose more than one) / Peranan masyarakat (boleh pilih lebih daripada satu)",
  note: 'More than one may be chosen. Store every one chosen, separated by ", ".',
  options: ["Mental Health Fighter", "Caregiver", "Healthcare Professional", "Corporate Professional", "Community Leader", "Student", "Other"],
};
const OTHER_NOTE = 'Store the English part of the chosen option. If they choose "Other", ask them once to describe it in a few words and store that instead.';

// ---- Section A for the single-session programmes ----
const SECTION_A = {
  title: "Section A - About You / Tentang Anda",
  questions: [
    NAME,
    AGE_GROUP,
    GENDER,
    { field: "location", examples: ["Kuala Lumpur", "Selangor", "Penang / Pulau Pinang", "Johor"], text: "Location / Lokasi (city or state / bandar atau negeri)" },
    EMAIL,
    PHONE,
    {
      field: "creative_expression",
      // Tick-all-that-apply: the chat page lets several be picked before sending.
      multi: true,
      text: "Type of creative expression attended (you can choose more than one) / Jenis ekspresi kreatif (boleh pilih lebih daripada satu)",
      note: 'More than one may be chosen. Store every one chosen, separated by ", ".',
      options: ["Art & Craft", "Writing (Poetry/Journal/Zine)", "Movement (theatre/dance/somatic)", "Music expression", "Clay", "Photography", "Other"],
    },
    COMMUNITY_ROLE,
  ],
};

// ---- Section B: before the session. Shared, so pre/post scores stay
// comparable across programmes. ----
const SECTION_B = {
  title: "Section B - Before the Session / Sebelum Sesi",
  questions: [
    { field: "pre_happy_safe", scale: SCALE_1_5, text: "Before the session, I felt happy and safe to be myself. / Sebelum sesi, saya berasa gembira dan selamat menjadi diri sendiri." },
    { field: "pre_self_critical", scale: SCALE_1_5, text: "When I make a mistake or feel bad, I am very hard on myself. / Apabila saya membuat kesilapan atau berasa sedih, saya sangat keras terhadap diri sendiri." },
    { field: "pre_self_worth", scale: SCALE_1_5, text: "I know that I am important, even if other people say mean things to me. / Saya tahu saya penting, walaupun orang lain berkata buruk tentang saya." },
    { field: "pre_mind_heavy", scale: SCALE_1_5, text: "Before the session, my mind felt heavy, busy, or stressed. / Sebelum sesi, fikiran saya terasa berat, sibuk, atau tertekan." },
    { field: "pre_mood", text: "In a few words, describe the feeling or mood you brought into the room today. / Gambarkan perasaan atau mood anda semasa masuk hari ini.", examples: ["Not sure / Tidak pasti", "Calm / Tenang", "Stressed / Tertekan"] },
    { field: "pre_heavy_feeling", examples: ["Not sure / Tidak pasti", "Sadness / Kesedihan", "Anger / Kemarahan", "Worry / Kebimbangan"], text: 'What is one sad, angry, or heavy feeling you wanted to put onto the paper today? ("Not sure" is okay) / Apakah satu perasaan sedih, marah, atau berat yang anda mahu luahkan ke atas kertas hari ini? ("Tidak pasti" pun boleh)' },
  ],
};

// ---- Section D: after the session. Shared. ----
const SECTION_D = {
  title: "Section D - After the Session / Selepas Sesi",
  questions: [
    { field: "post_understand_feelings", scale: SCALE_1_5, text: "Making this art helped me understand my deep feelings better. / Membuat seni ini membantu saya memahami perasaan mendalam saya dengan lebih baik." },
    { field: "post_self_worth", scale: SCALE_1_5, text: "The art activity helped me see that I am valuable and strong, no matter what others say. / Aktiviti seni membantu saya melihat bahawa saya bernilai dan kuat, tidak kira apa kata orang lain." },
    { field: "post_mind_lighter", scale: SCALE_1_5, text: "Putting my thoughts onto the paper helped my mind feel lighter and more at ease. / Meluahkan fikiran ke atas kertas membuatkan minda saya berasa lebih ringan dan tenang." },
    { field: "post_mind_peaceful", scale: SCALE_1_5, text: "After making art, my mind feels lighter, quiet, or peaceful. / Selepas berkarya, fikiran saya terasa ringan, sunyi, atau damai." },
    { field: "post_strength_lesson", examples: ["I am stronger than I thought / Saya lebih kuat daripada sangkaan", "I deserve kindness / Saya layak disayangi", "Not sure / Tidak pasti"], text: "Look at the art you made today. What did it teach you about your own strength or self-love? / Lihat seni yang anda hasilkan hari ini. Apakah yang ia ajarkan tentang kekuatan diri atau kasih sayang terhadap diri anda?" },
    { field: "post_self_view_change", examples: ["Kinder to myself / Lebih baik pada diri", "More confident / Lebih yakin", "No change / Tiada perubahan", "Not sure / Tidak pasti"], text: 'How did making art today change the way you look at yourself? ("Not sure" is okay) / Bagaimanakah seni hari ini mengubah cara anda melihat diri sendiri? ("Tidak pasti" pun boleh)' },
  ],
};

// ---- Programme-specific questions ----
// Questions several programmes ask are defined once and reused, so they keep
// one field name and stay comparable wherever they appear.
const Q = {
  personal_experience: { field: "personal_experience", examples: ["Free / Bebas", "Playful / Ceria", "Calming / Menenangkan", "Hard to start / Sukar bermula"], quote: true, text: "How would you describe your personal creative expression during today's session? / Bagaimana anda mengekspresi diri secara kreatif sepanjang sesi hari ini?" },
  emotions_while_creating: { field: "emotions_while_creating", examples: ["Calm / Tenang", "Joy / Kegembiraan", "Sadness / Kesedihan", "Old memories / Kenangan lama"], quote: true, text: "What emotions, thoughts, or memories came up for you while creating? / Apakah emosi, fikiran, atau kenangan yang muncul semasa anda berkarya?" },
  mental_health_understanding: { field: "mental_health_understanding", scale: SCALE_UNDERSTANDING, text: "How could you relate your understanding of this creative expression with mental health? / Bagaimanakah anda boleh kaitkan sesi ekspresi kreatif dengan fahaman kesihatan mental?" },
  suggestions: { field: "suggestions", examples: ["More sessions / Lebih banyak sesi", "Longer sessions / Sesi lebih panjang"], optional: true, quote: true, text: "Do you have any suggestions or ideas for how we could make future sessions even better? / Adakah anda mempunyai cadangan atau idea untuk menjadikan sesi akan datang lebih baik?" },
};

const FEEDBACK_TITLE = "Section E - Feedback / Maklum Balas";

// A "how the day felt" statement of the general Art of Healing questionnaire.
const day = (field, label, text) => ({ field, label, scale: SCALE_AGREE, text });

// An agreement-scale item of the ASWARA art therapy questionnaire.
const agree = (field, label, text) => ({ field, label, scale: SCALE_AGREE, text });

// Each programme's full list of sections, in the order they are asked.
// A programme's `intro` is said once, right after the participant picks it; a
// section's `intro` is said once, just before that section's first question.
const PROGRAM_SECTIONS = {
  // Peer-led circle: the questions are about the group - safety, being heard,
  // connection - and the session's Insight & Integration reflection.
  "wip-harmoni-circle": {
    sections: [
      SECTION_A,
      SECTION_B,
      {
        title: "Section C - Your Circle Experience / Pengalaman Anda dalam Circle",
        questions: [
          { field: "circle_safe_to_share", label: "Circle: safe to share and be heard", scale: SCALE_1_5, text: "I felt safe to share and be heard in the circle. / Saya berasa selamat untuk berkongsi dan didengari dalam circle ini." },
          { field: "circle_connection", label: "Circle: connected to others", scale: SCALE_1_5, text: "I felt connected to the other people in the circle. / Saya berasa terhubung dengan peserta lain dalam circle ini." },
          Q.personal_experience,
          Q.emotions_while_creating,
          { field: "significant_moment", examples: ["Sharing in the circle / Sesi berkongsi", "Creating / Berkarya", "Listening to others / Mendengar orang lain", "Not sure / Tidak pasti"], quote: true, text: "What part of the session felt most significant or meaningful, and why? / Bahagian manakah dalam sesi ini yang terasa paling bermakna atau penting kepada anda, dan mengapa?" },
        ],
      },
      SECTION_D,
      {
        title: FEEDBACK_TITLE,
        questions: [
          {
            field: "circle_join_again",
            label: "Would join another Harmoni Circle",
            category: true,
            text: "Would you join another Harmoni Circle? / Adakah anda akan menyertai Harmoni Circle lagi?",
            options: ["Yes / Ya", "Maybe / Mungkin", "No / Tidak"],
            note: 'Store exactly "Yes", "Maybe" or "No".',
          },
          Q.suggestions,
        ],
      },
    ],
  },

  // Five-zone pop-up (WIP Seni Scape Blueprint deck). This survey IS Zone 3,
  // Behavioural Insight, so beyond the original Tally form (tally.so/r/EkNO02)
  // it carries one piece of evidence per zone outcome:
  //   Zone 1 Community Engagement .. seni_safe_to_express
  //   Zone 2 Individual Awareness .. seni_self_awareness, mental_health_understanding
  //   Zone 3 Behavioural Insight ... seni_familiar_struggles, emotions_while_creating
  //   Zone 4 Empowered Action ...... seni_empowered, seni_next_step
  //   Zone 5 Help-seeking Pathway .. seni_know_support, seni_next_step
  // Fields shared with other programmes keep their names so the dashboards
  // still line up.
  "seni-scape": {
    sections: [
      {
        title: "Section A - Demographic Data / Data Demografi",
        questions: [
          NAME,
          { field: "age_group", text: "Age group / Golongan umur", options: ["< 12", "12-19", "20-29", "30-39", "40-49", "50-60", "> 60"] },
          {
            field: "gender",
            text: "Gender / Jantina",
            options: ["Male / Lelaki", "Female / Perempuan", "Prefer not to say / Tidak mahu nyatakan"],
            note: 'Store "Male", "Female" or "Prefer not to say".',
          },
          EMAIL,
          PHONE,
          COMMUNITY_ROLE,
          {
            field: "seni_familiar_struggles",
            label: "Struggles that feel familiar right now",
            category: true,
            // Shown on the public community dashboard even though it sits
            // with the demographics: it is the emotional-trend evidence.
            insight: true,
            multi: true,
            text: "Which of these feel familiar in your life right now? (you can choose more than one) / Yang manakah terasa dekat dengan hidup anda sekarang? (boleh pilih lebih daripada satu)",
            options: [
              "Health & lifestyle stress / Tekanan kesihatan & gaya hidup",
              "Emotional struggles / Pergelutan emosi",
              "Life changes & pressure / Perubahan & tekanan hidup",
              "Loneliness & belonging / Kesunyian & rasa dimiliki",
              "Environment & access to support / Persekitaran & akses sokongan",
              "None right now / Tiada buat masa ini",
              "Prefer not to say / Tidak mahu nyatakan",
            ],
            note: 'More than one may be chosen. Store the English part of every one chosen, separated by ", ".',
          },
        ],
      },
      {
        title: "Section B - Reflection & Impact / Refleksi & Impak",
        questions: [
          { field: "seni_safe_to_express", label: "Seni Scape Z1: safe and welcome to express myself", scale: SCALE_1_5, text: "This space made me feel safe and welcome to express myself. / Ruang ini membuatkan saya berasa selamat dan dialu-alukan untuk mengekspresi diri." },
          {
            field: "personal_experience",
            text: "How would you describe your personal creative expression during today's session? / Bagaimana anda mengekspresi peribadi anda secara kreatif sepanjang sesi hari ini?",
            options: [
              "I feel open and free in expressing myself / Saya berasa terbuka dan bebas mengekspresi diri",
              "My emotions were shown through the process / Emosi saya terzahir melalui proses ini",
              "I found it hard to express what I feel / Saya sukar meluahkan apa yang saya rasa",
              "I felt shy or careful in expressing myself / Saya berasa malu atau berhati-hati",
              "I am not sure what I am doing / Saya tidak pasti apa yang saya lakukan",
              "My creativity felt active and flowing / Kreativiti saya terasa aktif dan mengalir",
              "Other / Lain-lain",
            ],
            note: OTHER_NOTE,
          },
          {
            field: "emotions_while_creating",
            text: "What emotions, thoughts, or memories came up for you while creating? / Apakah emosi, fikiran, atau kenangan yang muncul semasa anda berkarya?",
            options: [
              "Anger or frustration / Marah atau kecewa",
              "Anxiety or worry / Resah atau bimbang",
              "Happiness & Joy / Gembira & ceria",
              "A sense of calm and release / Rasa tenang dan lega",
              "Sadness or heaviness / Sedih atau berat",
              "Confusion or mixed feelings / Keliru atau perasaan bercampur",
              "Memories from the past came up / Kenangan lalu muncul",
              "Thoughts about myself and my life / Fikiran tentang diri dan hidup saya",
              "I am unsure any emotion or thought / Saya tidak pasti",
              "Other / Lain-lain",
            ],
            note: OTHER_NOTE,
          },
          { field: "seni_self_awareness", label: "Seni Scape Z2: noticed and named what I feel", scale: SCALE_1_5, text: "The activities helped me notice and name what I am feeling. / Aktiviti-aktiviti ini membantu saya menyedari dan menamakan apa yang saya rasa." },
          Q.mental_health_understanding,
          { field: "seni_empowered", label: "Seni Scape Z4: encouraged to take a step of self-care", scale: SCALE_1_5, text: "I leave feeling encouraged to take one small step of self-care or self-love. / Saya pulang dengan rasa terdorong untuk mengambil satu langkah kecil menjaga dan menyayangi diri." },
          { field: "seni_know_support", label: "Seni Scape Z5: know where to find support", scale: SCALE_1_5, text: "I now know where to find mental health support if I or someone I know needs it. / Saya kini tahu di mana untuk mendapatkan sokongan kesihatan mental jika saya atau orang yang saya kenali memerlukannya." },
          {
            field: "seni_next_step",
            label: "Next step after Seni Scape",
            category: true,
            multi: true,
            text: "What would you like to do next? (you can choose more than one) / Apakah yang ingin anda lakukan selepas ini? (boleh pilih lebih daripada satu)",
            options: [
              "Join the myWIPhealing community / Sertai komuniti myWIPhealing",
              "Attend another creative session / Hadir sesi kreatif lain",
              "Look up support services / Cari perkhidmatan sokongan",
              "Talk to someone I trust / Berbual dengan orang yang saya percaya",
              "Keep creating on my own / Terus berkarya sendiri",
              "Nothing for now / Tiada buat masa ini",
            ],
            note: 'More than one may be chosen. Store the English part of every one chosen, separated by ", ".',
          },
          {
            field: "impactful_zone",
            label: "Most impactful zone",
            category: true,
            multi: true,
            text: "Which zone felt most impactful and beneficial? (you can choose more than one) / Zon manakah yang paling memberi kesan dan manfaat kepada anda? (boleh pilih lebih daripada satu)",
            options: [
              "Zone 1: Community Engagement",
              "Zone 2: Individual Awareness",
              "Zone 3: Behavioural Insight",
              "Zone 4: Empowered Action",
              "Zone 5: Help-seeking Pathway",
            ],
            note: 'More than one may be chosen. Store every one chosen, separated by ", ", e.g. "Zone 1: Community Engagement, Zone 2: Individual Awareness".',
          },
        ],
      },
      {
        title: "Section C - Program Feedback / Maklum Balas Program",
        questions: [
          {
            field: "booth_experience",
            label: "Session experience",
            text: "How was your experience today at WIP Seni Scape? / Bagaimana pengalaman anda di WIP Seni Scape hari ini?",
            options: [
              "A - I love it, please do more!",
              "B - I enjoy it",
              "C - It was okay",
              "D - I did not enjoy much",
              "E - I do not enjoy it",
            ],
            note: "Store a single letter A-E.",
          },
          Q.suggestions,
        ],
      },
    ],
  },

  // General public at the full-day Art of Healing programme: how the day felt
  // for them, then a short event review. Plain everyday wording on purpose -
  // nothing here refers to therapy. program_effectiveness and would_recommend
  // are the fields the community dashboard's effectiveness and Net Promoter
  // cards read.
  "art-of-healing-festival": {
    sections: [
      {
        title: "Section A - About You / Tentang Anda",
        questions: [NAME, AGE_GROUP, GENDER, EMAIL, COMMUNITY_ROLE],
      },
      {
        title: "Section B - How the Day Felt / Perasaan Anda Sepanjang Hari",
        intro: "The next part is about how you felt during your day at Art of Healing. For each statement, choose how much you agree, from 1 (strongly disagree) to 5 (strongly agree).",
        questions: [
          day("aoh_day_welcome", "Felt safe and welcome to be myself", "I felt safe and welcome to be myself throughout the day. / Saya berasa selamat dan dialu-alukan untuk menjadi diri sendiri sepanjang hari."),
          day("aoh_day_touch_feelings", "Got in touch with my feelings", "During the day, I got in touch with my feelings. / Sepanjang hari ini, saya dapat mendekati perasaan saya."),
          day("aoh_day_express", "Able to express how I feel", "I was able to express how I feel through the activities. / Saya dapat meluahkan apa yang saya rasa melalui aktiviti-aktiviti."),
          day("aoh_day_discover", "Discovered something about myself", "The day helped me discover something about what is going on inside me. / Hari ini membantu saya menemui sesuatu tentang apa yang berlaku dalam diri saya."),
          day("aoh_day_outlet", "The activities were an outlet", "The creative activities felt like an outlet for me. / Aktiviti kreatif terasa seperti satu saluran luahan bagi saya."),
          day("aoh_day_connected", "Felt connected to people around me", "I felt connected to the people around me. / Saya berasa terhubung dengan orang di sekeliling saya."),
          day("aoh_day_lighter", "Leaving lighter or calmer", "I am leaving feeling lighter or calmer than when I arrived. / Saya pulang dengan perasaan lebih ringan atau tenang berbanding semasa saya tiba."),
          day("aoh_day_carry", "Will carry something into daily life", "I will carry something from today into my daily life. / Saya akan membawa sesuatu daripada hari ini ke dalam kehidupan harian saya."),
          { field: "aoh_day_feeling", label: "How the day felt, in their words", quote: true, examples: ["Calm / Tenang", "Happy / Gembira", "Moved / Tersentuh", "Not sure / Tidak pasti"], text: "In a few words, how did you feel during the day? / Dalam beberapa perkataan, apakah perasaan anda sepanjang hari ini?" },
        ],
      },
      {
        title: "Section C - Event Review / Ulasan Acara",
        intro: "Last part: a few quick questions about the programme itself.",
        questions: [
          {
            field: "booth_experience",
            label: "Session experience",
            text: "How was your experience at Art of Healing? / Bagaimana pengalaman anda di Art of Healing?",
            options: ["A - I love it, please do more!", "B - I enjoy it", "C - It was okay", "D - I did not enjoy much", "E - I do not enjoy it"],
            note: "Store a single letter A-E.",
          },
          { field: "program_effectiveness", label: "Programme effectiveness", scale: SCALE_EFFECTIVE, text: "How effective was the day in helping you connect creativity with your wellbeing? / Sejauh manakah hari ini berkesan membantu anda mengaitkan kreativiti dengan kesejahteraan anda?" },
          {
            field: "would_recommend",
            label: "Would recommend (1-10)",
            text: "How likely are you to recommend Art of Healing to a friend? 1 = not at all likely, 10 = extremely likely. / Sejauh manakah anda akan mengesyorkan Art of Healing kepada rakan? 1 = langsung tidak, 10 = sangat mungkin.",
            options: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
            note: "Store a plain integer 1-10.",
          },
          { field: "festival_highlight", label: "Highlight of the day", quote: true, examples: ["A creative activity / Aktiviti kreatif", "A performance / Persembahan", "Meeting people / Bertemu orang lain", "Not sure / Tidak pasti"], text: "What was the highlight of the day for you, and why? / Apakah detik paling menarik hari ini bagi anda, dan mengapa?" },
          {
            field: "festival_attend_again",
            label: "Would attend again",
            category: true,
            text: "Would you join Art of Healing again? / Adakah anda akan menyertai Art of Healing lagi?",
            options: ["Yes / Ya", "Maybe / Mungkin", "No / Tidak"],
            note: 'Store exactly "Yes", "Maybe" or "No".',
          },
          Q.suggestions,
        ],
      },
    ],
  },

  // "Exploring the Impact of Movement, Dance & Theatre Art Therapy on
  // Emotional Awareness, Expression, and Mental Health Advocacy" - the
  // research questionnaire for the programme run with ASWARA Foundation.
  // Question wording follows that questionnaire; keep it in step with it.
  "art-of-healing-aswara": {
    intro:
      "Thank them for taking part in the Movement, Dance & Theatre Art Therapy program, part of the Art of Healing initiative with ASWARA Foundation. " +
      "Say this is a research-based reflection of about 10-15 minutes; their answers are confidential and used only for research and program development; " +
      "taking part is voluntary, they may skip any question, and by completing the survey they consent to be part of the research.",
    sections: [
      {
        title: "Section A - Demographic Information / Maklumat Demografi",
        intro: "First, a little about you and your background with the arts and mental health, so we can understand your answers in context.",
        questions: [
          EMAIL,
          NAME,
          AGE_GROUP,
          GENDER,
          {
            field: "aoh_performing_arts_experience",
            label: "Prior performing arts experience",
            category: true,
            text: "Prior experience with performing arts / Pengalaman terdahulu dalam seni persembahan",
            options: ["None / Tiada", "A little / Sedikit", "Some / Sederhana", "A lot / Banyak"],
            note: 'Store "None", "A little", "Some" or "A lot".',
          },
          {
            field: "aoh_therapy_experience",
            label: "Prior therapy / counseling / support programme",
            category: true,
            text: "Prior experience with therapy, counseling, or emotional support programs? / Pernahkah anda mengikuti terapi, kaunseling, atau program sokongan emosi?",
            options: ["Yes / Ya", "No / Tidak", "Prefer not to say / Tidak mahu nyatakan"],
            note: 'Store "Yes", "No" or "Prefer not to say".',
          },
          {
            field: "aoh_mental_health_experience",
            label: "Experience with mental health challenges",
            category: true,
            text: "Do you have personal or secondhand experience with mental health challenges? / Adakah anda mempunyai pengalaman peribadi atau melalui orang lain dengan cabaran kesihatan mental?",
            options: ["Personal / Peribadi", "Secondhand / Melalui orang lain", "Both / Kedua-duanya", "None / Tiada", "Prefer not to say / Tidak mahu nyatakan"],
            note: 'Store "Personal", "Secondhand", "Both", "None" or "Prefer not to say".',
          },
        ],
      },
      {
        title: "Section B1 - Emotional Awareness & Expression / Kesedaran & Ekspresi Emosi",
        intro: "The next parts are statements to rate from 1 (Strongly Disagree) to 5 (Strongly Agree). This first set looks at whether you became more aware of your emotions and more able to express them through movement, dance and theatre.",
        questions: [
          agree("aoh_emotion_awareness", "B1: more aware of my emotions", "I am more aware of my emotions after the workshop. / Saya lebih sedar akan emosi saya selepas bengkel ini."),
          agree("aoh_emotion_wheel", "B1: Emotional Wheel of Colors helped name emotions", "I found the Emotional Wheel of Colors helped me to name and describe my emotions. / Roda Emosi Berwarna membantu saya menamakan dan menggambarkan emosi saya."),
          agree("aoh_express_hard_feelings", "B1: expressed feelings hard to verbalize", "The movement and theatre exercises helped me express feelings I find hard to verbalize. / Latihan pergerakan dan teater membantu saya meluahkan perasaan yang sukar saya ungkapkan dengan kata-kata."),
          agree("aoh_body_stores_emotion", "B1: learned how my body stores emotions", "I learned how my body stores emotional experiences. / Saya belajar bagaimana badan saya menyimpan pengalaman emosi."),
          agree("aoh_body_scan", "B1: body scan showed where emotions live", "The body scanning and coloring activity helped me recognize where emotions live in my body. / Aktiviti imbasan badan dan mewarna membantu saya mengenal pasti di mana emosi berada dalam badan saya."),
        ],
      },
      {
        title: "Section B2 - Self-Compassion & Grounding / Belas Kasihan Diri & Grounding",
        intro: "These next statements look at inner calm, self-acceptance and how the somatic, grounding and affirmation practices supported you.",
        questions: [
          agree("aoh_grounding_centered", "B2: grounding helped me feel centered", "The somatic and grounding exercises helped me feel more centered. / Latihan somatik dan grounding membantu saya berasa lebih tenang dan berpusat."),
          agree("aoh_emotional_acceptance", "B2: more accepting of my emotions", "I feel more accepting of my emotional experiences after the session. / Saya lebih menerima pengalaman emosi saya selepas sesi ini."),
          agree("aoh_calm_closure", "B2: affirmations gave calm and closure", "The affirmations and meditation supported a sense of calm and closure. / Afirmasi dan meditasi memberi saya rasa tenang dan penutup yang baik."),
        ],
      },
      {
        title: "Section B3 - Empathy & Group Connection / Empati & Hubungan Kumpulan",
        intro: "These next statements look at connection, empathy and shared understanding within the group.",
        questions: [
          agree("aoh_group_connection", "B3: emotionally connected to participants", "I felt emotionally connected to other participants during the group activities. / Saya berasa terhubung secara emosi dengan peserta lain semasa aktiviti berkumpulan."),
          agree("aoh_empathy", "B3: empathized with others' expressions", "I was able to interpret and empathize with others' expressions of mental health. / Saya dapat mentafsir dan berempati dengan ekspresi kesihatan mental peserta lain."),
          agree("aoh_group_show_perspectives", "B3: group show gave new perspectives", "The group show helped me understand mental health from different perspectives. / Persembahan kumpulan membantu saya memahami kesihatan mental daripada pelbagai perspektif."),
        ],
      },
      {
        title: "Section B4 - Creative Empowerment / Pemerkasaan Kreatif",
        intro: "These next statements look at whether you felt creatively empowered and safe to express your own or shared stories.",
        questions: [
          agree("aoh_safe_creative_risk", "B4: safe to take creative risks", "The program allowed me to feel safe to take creative risks. / Program ini membolehkan saya berasa selamat untuk mengambil risiko kreatif."),
          agree("aoh_new_storytelling", "B4: new ways to tell stories", "I discovered new ways to tell stories through movement and theatre. / Saya menemui cara baharu untuk bercerita melalui pergerakan dan teater."),
          agree("aoh_empowered_to_speak", "B4: empowered to speak about mental health", "The final performance made me feel empowered to speak about mental health. / Persembahan akhir membuatkan saya berasa berdaya untuk bercakap tentang kesihatan mental."),
        ],
      },
      {
        title: "Section B5 - Overall Satisfaction / Kepuasan Keseluruhan",
        intro: "Two last statements, about the experience overall.",
        questions: [
          agree("aoh_meaningful", "B5: meaningful and personally impactful", "I found the workshop meaningful and personally impactful. / Saya mendapati bengkel ini bermakna dan memberi kesan kepada diri saya."),
          agree("aoh_recommend", "B5: would recommend to others", "I would recommend this experience to others. / Saya akan mengesyorkan pengalaman ini kepada orang lain."),
        ],
      },
      {
        title: "Section C - Your Reflections / Refleksi Anda",
        intro: "The final part is five open reflections in your own words about your journey through the workshop. Short or long, everything is welcome.",
        questions: [
          { field: "aoh_most_impactful_part", examples: ["The group show / Persembahan kumpulan", "Movement exercises / Latihan pergerakan", "Emotional Wheel of Colors / Roda Emosi Berwarna", "Affirmations & meditation / Afirmasi & meditasi"], label: "Most impactful part of the workshop", quote: true, text: "What part of the workshop impacted you the most, and why? / Bahagian manakah dalam bengkel ini yang paling memberi kesan kepada anda, dan mengapa?" },
          { field: "aoh_identify_express_feelings", examples: ["Naming my emotions / Menamakan emosi", "Expressing through movement / Meluah melalui pergerakan", "Feeling it in my body / Merasai dalam badan", "Not sure / Tidak pasti"], label: "How the workshop helped identify and express feelings", quote: true, text: "How does the workshop help you in identifying and expressing feelings? / Bagaimanakah bengkel ini membantu anda mengenal pasti dan meluahkan perasaan?" },
          { field: "aoh_self_learning", examples: ["I am more resilient / Saya lebih tabah", "I hold a lot in / Saya banyak memendam", "I can express myself / Saya mampu meluahkan diri", "Not sure / Tidak pasti"], label: "What I learned about myself", quote: true, text: "What have you learned about yourself through this program? / Apakah yang anda pelajari tentang diri anda melalui program ini?" },
          { field: "aoh_art_reduces_stigma", examples: ["Starts conversations / Membuka perbualan", "Builds empathy / Membina empati", "Makes it relatable / Lebih mudah difahami", "Not sure / Tidak pasti"], label: "Art, dance and theatre against stigma", quote: true, text: "How do you see art, dance, and theatre as a tool to reduce stigma about mental health? / Bagaimanakah anda melihat seni, tarian, dan teater sebagai alat untuk mengurangkan stigma terhadap kesihatan mental?" },
          { field: "aoh_group_self_discovery", examples: ["Felt safe to share / Selamat berkongsi", "Inspired by others / Terinspirasi oleh orang lain", "Felt less alone / Kurang rasa keseorangan", "Not sure / Tidak pasti"], label: "How the group helped expression and self-discovery", quote: true, text: "How did the group experience help your creative expression & self-discovery? / Bagaimanakah pengalaman berkumpulan membantu ekspresi kreatif & penemuan diri anda?" },
        ],
      },
    ],
  },
};

// The general check-in, for programmes with no questionnaire of their own:
// about you, the before and after batteries, the shared experience questions.
const GENERAL_SECTIONS = [
  SECTION_A,
  SECTION_B,
  {
    title: "Section C - Your Experience / Pengalaman Anda",
    questions: [Q.personal_experience, Q.emotions_while_creating, Q.mental_health_understanding],
  },
  SECTION_D,
  { title: FEEDBACK_TITLE, questions: [Q.suggestions] },
];

const sectionsFor = (id) => (PROGRAM_SECTIONS[id] || { sections: GENERAL_SECTIONS }).sections;

// ---------- rendering ----------

function buttonsFor(q) {
  if (q.scale) return q.scale;
  if (q.options) return q.options;
  const base = q.examples || [];
  return q.optional ? [...base, "Skip / Langkau"] : base;
}

function renderQuestion(q, n) {
  const parts = [`${n}.${q.optional ? " (optional)" : ""} ${q.text}`];
  if (q.scale) parts.push(`   Scale: ${q.scale.join(" | ")}`);
  else if (q.options) parts.push(`   Options: ${q.options.join(" | ")}`);
  if (q.note) parts.push(`   ${q.note}`);
  const btns = buttonsFor(q);
  if (btns.length) parts.push(`   Buttons: <options>${JSON.stringify(btns)}</options>`);
  return parts.join("\n");
}

// All questions for one programme, in the order they are asked.
function questionsFor(programId) {
  const group = groupOf(programId);
  return [PROGRAM_QUESTION, ...(group ? [group.question] : []), ...sectionsFor(programId).flatMap((s) => s.questions)];
}

// The <survey_complete> template for one programme: every field it asks,
// defaulted to the right empty value for its type.
function completionTemplate(programId) {
  const out = {};
  for (const q of questionsFor(programId)) {
    if (q.field === "program") out.program = programId;
    else if (q.scale) out[q.field] = 0;
    else if (q.optional) out[q.field] = null;
    else out[q.field] = "";
  }
  return JSON.stringify(out);
}

// One programme's questionnaire from question `n` on, under its IF heading.
function renderProgramBranch(program, heading, n) {
  const { intro } = PROGRAM_SECTIONS[program.id] || {};
  const lines = [heading];
  if (intro) lines.push("", `Before Question ${n}, in the same message and in both languages, briefly: ${intro} Then give the first section's intro and ask Question ${n}.`);

  for (const section of sectionsFor(program.id)) {
    lines.push("", section.title);
    if (section.intro) lines.push(`Section intro - open the message that asks Question ${n} with this, in both languages, kept to one or two short sentences: ${section.intro}`);
    for (const q of section.questions) lines.push(renderQuestion(q, n++));
  }

  lines.push(
    "",
    `When every question above is answered, end with EXACTLY these fields:`,
    `<survey_complete>${completionTemplate(program.id)}</survey_complete>`
  );
  return lines.join("\n");
}

// A group: its follow-up question as Question 2, then one branch per answer.
function renderGroupBranch(groupId) {
  const group = PROGRAM_GROUPS[groupId];
  const lines = [
    `>>> IF the participant chose "${group.label}":`,
    "",
    renderQuestion(group.question, 2),
    "",
    "Question 2 decides which questionnaire follows. Continue with ONLY the matching one below.",
  ];
  const members = PROGRAMS.filter((p) => p.group === groupId);
  for (const p of members) {
    const answers = group.question.options.filter((_, i) => group.routes[i] === p.id).map((o) => `"${o.split(" / ")[0]}"`);
    lines.push("", renderProgramBranch(p, `>>>> IF the answer to Question 2 was ${answers.join(" or ")}:`, 3));
  }
  return lines.join("\n");
}

function buildSystemPrompt() {
  const seenGroups = new Set();
  const branches = PROGRAMS.map((p) => {
    if (!p.group) return renderProgramBranch(p, `>>> IF the participant chose "${p.label}":`, 2);
    if (seenGroups.has(p.group)) return null;
    seenGroups.add(p.group);
    return renderGroupBranch(p.group);
  }).filter(Boolean).join("\n\n");

  return `You are "Seni", a warm, gentle bilingual (English & Bahasa Malaysia) assistant running the myWIPhealing impact survey.

Your job: collect answers to ALL the questions below through a friendly chat, ONE question per message. Keep every message short. Always show the question in both English and Bahasa Malaysia.

Start with a short warm greeting: "Your voice matters / Suara anda bermakna" - honest feedback matters, they may remain anonymous, personal details are not compulsory. Then immediately ask Question 1.

Rules:
- Put the question itself - its number and both languages - in bold by wrapping it in **double asterisks**, as its own paragraph. Bold nothing else: greetings, thanks and section intros stay plain.
- One question per message, in both languages. Do NOT write the options or the scale points in the message text - the buttons show them.
- Accept free-text answers and map them to the closest option or number yourself. Numbers in words ("four", "empat") count.
- Questions marked (optional) may be skipped; record null. Never pressure anyone for personal details.
- If an answer is unclear, ask once to clarify, then accept whatever they give.
- Do not give advice, diagnoses, or therapy. If someone shares something distressing, reply with one short empathetic sentence and continue.
- Stay on the survey. Politely decline unrelated requests and return to the current question.

QUICK-REPLY BUTTONS:
Every message that asks a question MUST end with a hidden options block on its own line, which the app turns into tap buttons:
<options>["First button","Second button"]</options>
- Each question below lists its exact buttons. Use them verbatim.
- On open questions the buttons are only example answers; the participant can always type their own words instead.
- Keep button labels short. The block must be valid JSON. Never mention the buttons or the block in your text.
- ALWAYS append the block to a question, even if earlier assistant messages in this conversation appear to have none (the app hides them after sending).
- Do not include an options block in the final thank-you message.

QUESTION 1 - ask this of EVERYONE:

${renderQuestion(PROGRAM_QUESTION, 1)}

BRANCHING - Question 1 decides everything that comes next.
Each programme has its own questionnaire. Continue with ONLY the chosen
programme's questions below, in order, and ignore the other branches completely.
Never mention branching, other programmes, or that questions differ.

${branches}

WHEN ALL QUESTIONS FOR THE CHOSEN PROGRAMME ARE ANSWERED:
Send a warm short thank-you in both languages, then append that programme's machine-readable block at the very end of the same message (the participant will not see it).
Fill every field with the participant's actual answers: null for skipped optional fields, plain integers 1-5 for scale fields. The "program" field must keep the exact id shown in the template. The block must be valid JSON on one line.`;
}

// Safety net for a reply that asks a question but arrived without its options
// block: find which question it is by its wording and return that question's
// buttons, so no question is ever left with only the typing box.
// The same question can carry different choices per programme, so the
// programme the participant named earlier in the chat is looked in first.
function buttonsForReply(reply, history = []) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const text = norm(reply);
  let chosen = null;
  for (const m of history.filter((m) => m.role === "user")) {
    const said = String(m.content).trim().toLowerCase();
    for (const [gid, g] of Object.entries(PROGRAM_GROUPS)) {
      const i = g.question.options.findIndex((o) => o.toLowerCase() === said);
      if (i >= 0) chosen = g.routes[i];
      else if (said === g.label.toLowerCase() && !chosen) chosen = PROGRAMS.find((p) => p.group === gid).id;
    }
    if (!chosen) chosen = programId(m.content);
  }
  let best = null;
  for (const q of [...(chosen ? questionsFor(chosen) : []), ...programQuestions()]) {
    const stem = norm(q.text.split(" / ")[0]);
    if (stem && text.includes(stem) && (!best || stem.length > best.stem.length)) best = { q, stem };
  }
  return best ? buttonsFor(best.q) : [];
}

// True when the options belong to a tick-all-that-apply question.
function isMultiSelect(options) {
  if (!Array.isArray(options) || !options.length) return false;
  return programQuestions().some((q) => q.multi && options.every((o) => q.options.includes(o)));
}

// True when a set of quick-reply options is a 1-5 rating whose points run
// evenly from one end to the other, so the chat page can draw it as a single
// linear scale instead of five separate buttons. SCALE_UNDERSTANDING is
// excluded: each of its points means something different.
function isLinearScale(options) {
  if (!Array.isArray(options) || options.length !== 5) return false;
  if (!options.every((o, i) => String(o).trim().startsWith(`${i + 1} -`))) return false;
  const stem = (s) => String(s).trim().toLowerCase().slice(0, 10);
  return stem(options[0]) !== stem(SCALE_UNDERSTANDING[0]);
}

// Field -> human label, for the admin table and CSV export. Generated so a new
// question cannot be silently missing from the dashboard.
function fieldLabels() {
  const seen = {};
  const pretty = (f) => f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  for (const p of PROGRAMS) for (const q of questionsFor(p.id)) if (!seen[q.field]) seen[q.field] = q.label || pretty(q.field);
  return seen;
}

// Every question any programme asks, once each. stats.js reads this to pick
// up new scales, categories and quote-eligible answers.
function programQuestions() {
  const seen = new Map();
  for (const p of PROGRAMS) for (const q of questionsFor(p.id)) if (!seen.has(q.field)) seen.set(q.field, q);
  return [...seen.values()];
}

// Every field any programme can produce.
function allFields() {
  return Object.keys(fieldLabels());
}

module.exports = {
  PROGRAMS,
  PROGRAM_SECTIONS,
  PROGRAM_GROUPS,
  sectionsFor,
  programId,
  programQuestions,
  isLinearScale,
  isMultiSelect,
  buttonsForReply,
  SCALE_1_5,
  SCALE_AGREE,
  SCALE_UNDERSTANDING,
  buildSystemPrompt,
  questionsFor,
  completionTemplate,
  fieldLabels,
  allFields,
};
