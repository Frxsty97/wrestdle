// Pure game logic — no DOM, no network — so it can be unit-tested with Node.

/** Seconds of audio unlocked at each attempt (index 0 = first attempt). */
export const CLIP_STEPS = [1, 2, 4, 7, 11, 16];
export const MAX_ATTEMPTS = CLIP_STEPS.length;

/** First day of the daily puzzle (#1). Local calendar date. */
export const DAILY_EPOCH = { y: 2026, m: 11, d: 26 };

/** Lower-case, strip accents and punctuation so "Finn Bálor" == "finn balor". */
export function normalize(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[’'".,!?()\[\]#:]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Local date key like "2026-12-01". */
export function dateKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Whole days since DAILY_EPOCH (DST-safe: compares calendar dates in UTC). */
export function dayNumber(date = new Date()) {
  const a = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const b = Date.UTC(DAILY_EPOCH.y, DAILY_EPOCH.m - 1, DAILY_EPOCH.d);
  return Math.round((a - b) / 86400000);
}

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic shuffle: everyone gets the same order. */
export function seededShuffle(items, seed) {
  const arr = items.slice();
  const rnd = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * The daily song. Songs are sorted by trackId then shuffled with a fixed seed,
 * and day N takes position N. It works through the whole list before repeating.
 * Shuffling again for each full pass stops the order repeating exactly.
 */
export function dailySong(songs, date = new Date()) {
  const n = Math.max(0, dayNumber(date));
  const sorted = songs.slice().sort((a, b) => a.id - b.id);
  const cycle = Math.floor(n / sorted.length);
  const order = seededShuffle(sorted, 0x5eed + cycle);
  return order[n % sorted.length];
}

/** Random song for Unlimited, avoiding the recently played ids where possible. */
export function randomSong(songs, recentIds = [], rnd = Math.random) {
  const recent = new Set(recentIds);
  const fresh = songs.filter((s) => !recent.has(s.id));
  const pool = fresh.length ? fresh : songs;
  return pool[Math.floor(rnd() * pool.length)];
}

/** Filter for Unlimited mode. promotion/era: "all" or a value. */
export function filterSongs(songs, { promotion = "all", era = "all" } = {}) {
  return songs.filter(
    (s) => (promotion === "all" || s.promotion === promotion) && (era === "all" || s.era === era)
  );
}

/**
 * Build the list of guessable options: one per wrestler, one per distinct song title.
 * Each option: { type: "wrestler"|"song", label, sub, key, terms[] }
 */
export function buildOptions(songs) {
  const wrestlers = new Map();
  const titles = new Map();
  for (const s of songs) {
    if (!wrestlers.has(s.wrestler)) {
      wrestlers.set(s.wrestler, {
        type: "wrestler",
        label: s.wrestler,
        sub: s.aliases.length ? `aka ${s.aliases.join(", ")}` : "Wrestler",
        key: "w:" + normalize(s.wrestler),
        terms: [s.wrestler, ...s.aliases].map(normalize),
      });
    }
    const tk = normalize(s.song);
    if (!titles.has(tk)) {
      titles.set(tk, { type: "song", label: s.song, sub: "Song", key: "s:" + tk, terms: [tk], by: new Set() });
    }
    titles.get(tk).by.add(s.wrestler);
  }
  const songOpts = [...titles.values()].map((o) => ({ ...o, sub: "Song", by: undefined }));
  return [...wrestlers.values(), ...songOpts];
}

/** Rank options against what the player typed. Prefix matches first. */
export function searchOptions(options, query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const scored = [];
  for (const o of options) {
    let best = Infinity;
    for (const t of o.terms) {
      if (t === q) best = Math.min(best, 0);
      else if (t.startsWith(q)) best = Math.min(best, 1);
      else if (t.split(" ").some((w) => w.startsWith(q))) best = Math.min(best, 2);
      else if (t.includes(q)) best = Math.min(best, 3);
    }
    if (best < Infinity) scored.push([best, o.type === "wrestler" ? 0 : 1, o.label.length, o]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  return scored.slice(0, limit).map((x) => x[3]);
}

/** Is the chosen option correct for this answer? Wrestler OR song title counts. */
export function isCorrect(option, answer) {
  if (!option || !answer) return false;
  if (option.type === "wrestler") return option.key === "w:" + normalize(answer.wrestler);
  if (option.type === "song") return option.key === "s:" + normalize(answer.song);
  return false;
}

/**
 * Was a wrong guess close? A wrong wrestler from the same promotion and era, or
 * a song title shared by another wrestler, gets marked as close (amber).
 */
export function isPartial(option, answer, songs) {
  if (!option || isCorrect(option, answer)) return false;
  if (option.type === "wrestler") {
    const theirs = songs.find((s) => "w:" + normalize(s.wrestler) === option.key);
    return !!theirs && theirs.promotion === answer.promotion && theirs.era === answer.era;
  }
  return false;
}

/**
 * Easy-mode clues: compare a wrestler guess against the answer theme.
 * Returns null if the option is not a wrestler (song guesses carry no
 * wrestler-specific clues). Otherwise each clue is "match", "partial" or
 * "miss"; the company clue also reports the guessed and answer company lists
 * so the UI can render them.
 */
export function getClues(option, answer, songs) {
  if (!option || option.type !== "wrestler") return null;
  const theirs = songs.find((s) => "w:" + normalize(s.wrestler) === option.key);
  if (!theirs) return null;
  return {
    gender: compareGender(theirs.gender, answer.gender),
    actType: compareActType(theirs.actType, answer.actType),
    company: compareCompany(theirs.company, answer.company, theirs.promotion, answer.promotion),
  };
}

function compareGender(g, a) {
  if (!g || !a) return { status: "unknown", value: g || "?" };
  if (g === a) return { status: "match", value: g };
  // A single-gender guess against a mixed-gender group (or vice versa) is close.
  if (a === "mixed" || g === "mixed") return { status: "partial", value: g };
  return { status: "miss", value: g };
}

function compareActType(g, a) {
  if (!g || !a) return { status: "unknown", value: g || "?" };
  return { status: g === a ? "match" : "miss", value: g };
}

function compareCompany(gc, ac, gp, ap) {
  const gs = Array.isArray(gc) ? gc.slice() : (gc ? [gc] : []);
  const as = Array.isArray(ac) ? ac.slice() : (ac ? [ac] : []);
  if (!gs.length || !as.length) return { status: "unknown", value: gs };
  const overlap = gs.filter((x) => as.includes(x));
  if (overlap.length) return { status: "match", value: gs, overlap };
  if (gp && ap && gp === ap) return { status: "partial", value: gs };
  return { status: "miss", value: gs };
}

/** Wordle-style result grid. guesses: [{result:"correct"|"wrong"|"partial"|"skip"}] */
export function shareGrid(guesses) {
  const icon = { correct: "🟩", wrong: "🟥", partial: "🟨", skip: "⬛" };
  const cells = guesses.map((g) => icon[g.result] || "🟥");
  while (cells.length < MAX_ATTEMPTS) cells.push("⬜");
  return cells.join("");
}

/** Update stats after a finished game. Pure: returns a new object. */
export function updateStats(stats, { won, attempts, key }) {
  const s = structuredCloneSafe(stats || emptyStats());
  if (key && s.lastKey === key) return s; // already counted (e.g. reload of today's daily)
  s.played += 1;
  if (won) {
    s.won += 1;
    s.streak += 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.dist[attempts] = (s.dist[attempts] || 0) + 1;
  } else {
    s.streak = 0;
    s.dist.X = (s.dist.X || 0) + 1;
  }
  if (key) s.lastKey = key;
  return s;
}

/** Daily streaks break if you skip a day. Call on load with the last finished day's number. */
export function dailyStreakStillValid(lastDay, today) {
  return lastDay === today || lastDay === today - 1;
}

export function emptyStats() {
  return { played: 0, won: 0, streak: 0, maxStreak: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0 } };
}

function structuredCloneSafe(o) {
  return JSON.parse(JSON.stringify(o));
}
