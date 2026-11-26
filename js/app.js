import {
  CLIP_STEPS, MAX_ATTEMPTS, normalize, dateKey, dayNumber, dailySong, randomSong,
  filterSongs, buildOptions, searchOptions, isCorrect, isPartial, shareGrid,
  updateStats, emptyStats, dailyStreakStillValid, getClues,
} from "./logic.js";

const GAME_NAME = "Entrancle";
const STORE = "entrancle:";
const ITUNES_COUNTRIES = ["gb", "us"]; // try these stores in order when looking up a preview
const RECENT_LIMIT = 60;

// ---------- tiny helpers ----------
const $ = (id) => document.getElementById(id);
const load = (k, fallback) => { try { const v = localStorage.getItem(STORE + k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(STORE + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const fmt = (s) => `0:${String(Math.floor(s)).padStart(2, "0")}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- state ----------
let SONGS = [];
let OPTIONS = [];
let mode = "daily";
let round = null;      // { id, key?, guesses: [{label,type,optKey,result}], done, won }
let answer = null;     // song object
let selected = null;   // option chosen in the combobox
let activeIdx = -1;
let currentList = [];

// ---------- audio ----------
const audio = new Audio();
audio.preload = "auto";
let clipLimit = 1;
let raf = 0;
let fullPreview = false;
const previewCache = new Map();

async function resolvePreview(song) {
  if (song.preview) return { url: song.preview, art: song.art || "" };
  if (previewCache.has(song.id)) return previewCache.get(song.id);
  let lastErr;
  for (const c of ITUNES_COUNTRIES) {
    try {
      const r = await fetch(`https://itunes.apple.com/lookup?id=${song.id}&country=${c}&entity=song`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const t = (j.results || []).find((x) => x.trackId === song.id && x.previewUrl);
      if (t) {
        const info = { url: t.previewUrl, art: (t.artworkUrl100 || "").replace("100x100bb", "300x300bb") };
        previewCache.set(song.id, info);
        return info;
      }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("No preview available");
}

function stopAudio() {
  audio.pause();
  cancelAnimationFrame(raf);
  $("btn-play").classList.remove("playing");
  $("btn-full").textContent = "▶ Play 30s preview";
  if (!fullPreview) $("bar-played").style.width = "0%";
  fullPreview = false;
}

function tick() {
  const t = audio.currentTime;
  if (!fullPreview) {
    $("bar-played").style.width = `${Math.min(100, (t / CLIP_STEPS[MAX_ATTEMPTS - 1]) * 100)}%`;
    $("t-now").textContent = fmt(Math.min(t, clipLimit));
    if (t >= clipLimit) { stopAudio(); $("t-now").textContent = fmt(0); return; }
  }
  raf = requestAnimationFrame(tick);
}

async function playClip() {
  if (!audio.paused) { stopAudio(); return; }
  if (!audio.src) return;
  fullPreview = false;
  clipLimit = round.done ? CLIP_STEPS[MAX_ATTEMPTS - 1] : CLIP_STEPS[Math.min(round.guesses.length, MAX_ATTEMPTS - 1)];
  try {
    audio.currentTime = 0;
    $("btn-play").classList.add("loading");
    await audio.play();
    $("btn-play").classList.remove("loading");
    $("btn-play").classList.add("playing");
    raf = requestAnimationFrame(tick);
  } catch (e) {
    $("btn-play").classList.remove("loading");
    setHint("Couldn't play the audio. Tap play again.", true);
  }
}

async function playFull() {
  if (fullPreview && !audio.paused) { stopAudio(); return; }
  stopAudio();
  fullPreview = true;
  audio.currentTime = 0;
  try { await audio.play(); $("btn-full").textContent = "■ Stop preview"; } catch { fullPreview = false; }
}
audio.addEventListener("ended", stopAudio);
$("r-art").addEventListener("error", () => $("r-art").classList.add("noart"));
$("r-art").addEventListener("load", () => $("r-art").classList.remove("noart"));

// ---------- rendering ----------
function setHint(text, isError = false) {
  $("hint").textContent = text;
  $("hint").classList.toggle("error", isError);
}

function renderTicks() {
  const max = CLIP_STEPS[MAX_ATTEMPTS - 1];
  $("bar-ticks").innerHTML = CLIP_STEPS.slice(0, -1).map((s) => `<i style="left:${(s / max) * 100}%"></i>`).join("");
  $("t-max").textContent = fmt(max);
}

function renderAttempts() {
  const items = [];
  const easy = round?.easy;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const g = round.guesses[i];
    if (g) {
      const mark = { correct: "✓", wrong: "✕", partial: "≈", skip: "–" }[g.result];
      const label = g.result === "skip" ? "Skipped" : esc(g.label);
      const clues = easy && g.clues ? cluesHtml(g.clues) : "";
      const cls = clues ? `${g.result} has-clues` : g.result;
      const body = clues
        ? `<div class="main-row"><span class="mark">${mark}</span><span class="txt">${label}</span></div>${clues}`
        : `<span class="mark">${mark}</span><span class="txt">${label}</span>`;
      items.push(`<li class="${cls}">${body}</li>`);
    } else {
      const cur = !round.done && i === round.guesses.length;
      items.push(`<li class="${cur ? "current" : ""}"><span class="mark"></span><span class="txt" style="color:var(--muted)">${cur ? `Attempt ${i + 1} · ${CLIP_STEPS[i]}s` : ""}</span></li>`);
    }
  }
  $("attempts").innerHTML = items.join("");
}

function cluesHtml(c) {
  if (!c) return "";
  const genderLabel = { male: "Male", female: "Female", trans: "Trans", mixed: "Mixed" };
  const actLabel = { singles: "Singles", group: "Group" };
  const parts = [
    chip(c.gender.status, "👤", genderLabel[c.gender.value] || c.gender.value),
    chip(c.actType.status, "🎤", actLabel[c.actType.value] || c.actType.value),
    chip(c.company.status, "🏢", (c.company.value || []).join(" / ") || "?"),
  ];
  return `<div class="clues">${parts.join("")}</div>`;
}

function chip(status, icon, label) {
  return `<span class="clue ${status}"><span class="icon">${icon}</span>${esc(label)}</span>`;
}

function renderControls() {
  const step = Math.min(round.guesses.length, MAX_ATTEMPTS - 1);
  const unlocked = round.done ? CLIP_STEPS[MAX_ATTEMPTS - 1] : CLIP_STEPS[step];
  $("bar-unlocked").style.width = `${(unlocked / CLIP_STEPS[MAX_ATTEMPTS - 1]) * 100}%`;
  const playing = !round.done;
  $("guess-input").disabled = !playing;
  $("btn-submit").disabled = !playing;
  $("btn-skip").disabled = !playing;
  const next = CLIP_STEPS[step + 1];
  $("skip-sec").textContent = playing && next ? `(+${next - CLIP_STEPS[step]}s)` : "";
  $("btn-skip").firstChild.textContent = round.guesses.length === MAX_ATTEMPTS - 1 ? "Give up " : "Skip ";
  if (round.done) setHint(round.won ? "Nailed it! Tap play to hear more." : "Out of tries. Tap play to hear more.");
  else setHint(`Tap to listen (${unlocked}s)`);
}

function renderSubtitle() {
  if (mode === "daily") {
    $("subtitle").textContent = `Daily #${dayNumber() + 1} · ${new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}`;
  } else {
    const f = load("filters", { promotion: "all", era: "all" });
    const bits = [f.promotion === "all" ? "All promotions" : f.promotion, f.era === "all" ? "all eras" : f.era];
    $("subtitle").textContent = `Unlimited · ${bits.join(" · ")}`;
  }
}

function render() {
  renderSubtitle();
  renderAttempts();
  renderControls();
}

// ---------- rounds ----------
async function prepareAudio() {
  stopAudio();
  audio.removeAttribute("src");
  $("btn-play").disabled = true;
  $("btn-play").classList.add("loading");
  setHint("Cueing up the music…");
  try {
    const info = await resolvePreview(answer);
    audio.src = info.url;
    audio.load();
    $("r-art").classList.toggle("noart", !info.art);
    if (info.art) $("r-art").src = info.art; else $("r-art").removeAttribute("src");
    $("btn-play").disabled = false;
    render();
  } catch (e) {
    setHint("Couldn't load this theme. Check your connection and refresh.", true);
    console.error(e);
  } finally {
    $("btn-play").classList.remove("loading");
  }
}

function startDaily() {
  const today = dateKey();
  answer = dailySong(SONGS);
  const saved = load("daily", null);
  round = saved && saved.key === today && saved.id === answer.id
    ? saved
    : { key: today, id: answer.id, guesses: [], done: false, won: false, easy: load("easyMode", false) };
  if (round.easy === undefined) round.easy = load("easyMode", false);
  save("daily", round);
  // Reset streak if a day was missed
  const sk = currentStatsKey();
  const st = load(sk, emptyStats());
  if (st.lastDay != null && !dailyStreakStillValid(st.lastDay, dayNumber())) { st.streak = 0; save(sk, st); }
  afterStart();
}

function startUnlimited(forceNew = false) {
  const f = load("filters", { promotion: "all", era: "all" });
  const pool = filterSongs(SONGS, f);
  $("pool-count").textContent = `${pool.length} themes`;
  const saved = load("unlimited", null);
  const savedSong = saved && SONGS.find((s) => s.id === saved.id);
  if (!forceNew && savedSong && !saved.done && pool.some((s) => s.id === saved.id)) {
    round = saved;
    answer = savedSong;
  } else {
    const recent = load("recent", []);
    answer = randomSong(pool.length ? pool : SONGS, recent);
    save("recent", [answer.id, ...recent].slice(0, RECENT_LIMIT));
    round = { id: answer.id, guesses: [], done: false, won: false, easy: load("easyMode", false) };
    save("unlimited", round);
  }
  afterStart();
}

function afterStart() {
  clearInput();
  render();
  prepareAudio();
  if (round.done) setTimeout(showResult, 250);
}

function switchMode(m) {
  if (m === mode && round) return;
  mode = m;
  document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === m)));
  $("filters").hidden = m !== "unlimited";
  save("mode", m);
  m === "daily" ? startDaily() : startUnlimited();
}

function persist() { save(mode === "daily" ? "daily" : "unlimited", round); }

function addGuess(g, { keepAudio = false } = {}) {
  if (!keepAudio) stopAudio();
  round.guesses.push(g);
  if (g.result === "correct") { round.done = true; round.won = true; }
  else if (round.guesses.length >= MAX_ATTEMPTS) { round.done = true; }
  persist();
  if (round.done) finishRound();
  render();
}

function finishRound() {
  const key = mode === "daily" ? round.key : `u:${round.id}:${Date.now()}`;
  const statsKey = currentStatsKey();
  const st = updateStats(load(statsKey, emptyStats()), { won: round.won, attempts: round.guesses.length, key });
  if (mode === "daily") st.lastDay = dayNumber();
  save(statsKey, st);
  setTimeout(showResult, 700);
}

function currentStatsKey() {
  const base = mode === "daily" ? "stats:daily" : "stats:unlimited";
  return round?.easy ? base + ":easy" : base;
}

// ---------- guessing ----------
function submitGuess(e) {
  e?.preventDefault();
  if (round.done) return;
  let opt = selected;
  if (!opt) {
    const q = normalize($("guess-input").value);
    if (!q) { setHint("Type a wrestler, or hit Skip.", true); return; }
    opt = OPTIONS.find((o) => o.terms.includes(q));
    if (!opt) { setHint("Pick a wrestler from the list.", true); openList(); return; }
  }
  if (round.guesses.some((g) => g.optKey === opt.key)) { setHint("You've already tried that one.", true); return; }
  const result = isCorrect(opt, answer) ? "correct" : isPartial(opt, answer, SONGS) ? "partial" : "wrong";
  const guess = { label: opt.label, type: opt.type, optKey: opt.key, result };
  if (round.easy && result !== "correct" && opt.type === "wrestler") {
    guess.clues = getClues(opt, answer, SONGS);
  }
  addGuess(guess);
  clearInput();
}

function skip() {
  if (round.done) return;
  addGuess({ label: "", type: "skip", optKey: `skip${round.guesses.length}`, result: "skip" }, { keepAudio: true });
  clearInput();
  if (round.done) {
    stopAudio();
  } else {
    clipLimit = CLIP_STEPS[Math.min(round.guesses.length, MAX_ATTEMPTS - 1)];
  }
}

// ---------- combobox ----------
function clearInput() {
  $("guess-input").value = "";
  selected = null;
  closeList();
}

function openList() {
  const q = $("guess-input").value;
  currentList = searchOptions(OPTIONS, q, 8);
  activeIdx = currentList.length ? 0 : -1;
  const ul = $("suggestions");
  if (!q.trim()) { closeList(); return; }
  ul.innerHTML = currentList.length
    ? currentList.map((o, i) => `<li role="option" id="opt-${i}" data-i="${i}" aria-selected="${i === activeIdx}">
        <span><span class="s-label">${esc(o.label)}</span></span>
        <span class="s-sub">${esc(o.sub)}</span></li>`).join("")
    : `<li class="empty">No matches. Try another spelling.</li>`;
  ul.hidden = false;
  $("guess-input").setAttribute("aria-expanded", "true");
}

function closeList() {
  $("suggestions").hidden = true;
  $("guess-input").setAttribute("aria-expanded", "false");
  activeIdx = -1;
}

function highlight(i) {
  activeIdx = i;
  [...$("suggestions").children].forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
  $("suggestions").children[i]?.scrollIntoView({ block: "nearest" });
}

function choose(i) {
  const o = currentList[i];
  if (!o) return;
  selected = o;
  $("guess-input").value = o.label;
  closeList();
}

$("guess-input").addEventListener("input", () => { selected = null; openList(); setHint(""); });
$("guess-input").addEventListener("keydown", (e) => {
  const open = !$("suggestions").hidden && currentList.length;
  if (e.key === "ArrowDown" && open) { e.preventDefault(); highlight((activeIdx + 1) % currentList.length); }
  else if (e.key === "ArrowUp" && open) { e.preventDefault(); highlight((activeIdx - 1 + currentList.length) % currentList.length); }
  else if (e.key === "Enter" && open && activeIdx >= 0) { e.preventDefault(); choose(activeIdx); submitGuess(); }
  else if (e.key === "Escape") closeList();
});
$("suggestions").addEventListener("mousedown", (e) => {
  const li = e.target.closest("li[data-i]");
  if (li) { e.preventDefault(); choose(Number(li.dataset.i)); $("guess-input").focus(); }
});
$("guess-input").addEventListener("blur", () => setTimeout(closeList, 120));

// ---------- result / share ----------
let countdownTimer = 0;
function showResult() {
  const won = round.won;
  $("r-kicker").textContent = mode === "daily" ? `Daily #${dayNumber() + 1}` : "Unlimited";
  $("r-title").textContent = won ? `Got it in ${round.guesses.length}!` : "Not this time";
  $("r-title").classList.toggle("win", won);
  $("r-wrestler").textContent = answer.wrestler;
  $("r-song").textContent = `“${answer.song}”`;
  $("r-meta").textContent = `${answer.promotion === "WWE" ? "WWE / WWF" : "AEW"} · ${answer.era}`;
  $("r-grid").textContent = shareGrid(round.guesses);
  $("btn-next").textContent = mode === "daily" ? "Play Unlimited" : "Next theme";
  $("toast").textContent = "";
  clearInterval(countdownTimer);
  if (mode === "daily") {
    const upd = () => {
      const now = new Date();
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const s = Math.max(0, Math.floor((next - now) / 1000));
      $("r-countdown").textContent = `Next daily in ${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      if (s === 0 && mode === "daily") { $("dlg-result").close(); startDaily(); }
    };
    upd();
    countdownTimer = setInterval(upd, 1000);
  } else {
    $("r-countdown").textContent = "";
  }
  if (!$("dlg-result").open) $("dlg-result").showModal();
}

async function share() {
  const score = round.won ? round.guesses.length : "X";
  const easyTag = round.easy ? " Easy" : "";
  const head = mode === "daily" ? `${GAME_NAME}${easyTag} #${dayNumber() + 1}` : `${GAME_NAME}${easyTag} Unlimited`;
  const url = location.origin + location.pathname;
  const text = `${head} ${score}/${MAX_ATTEMPTS}\n🔔 ${shareGrid(round.guesses)}\n${url}`;
  try {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    $("toast").textContent = "Copied to clipboard!";
  } catch {
    $("toast").textContent = text;
  }
}

$("dlg-result").addEventListener("close", () => { clearInterval(countdownTimer); if (fullPreview) stopAudio(); });

// ---------- stats ----------
function showStats() {
  const easy = load("easyMode", false);
  const base = mode === "daily" ? "stats:daily" : "stats:unlimited";
  const st = load(easy ? base + ":easy" : base, emptyStats());
  $("s-mode").textContent = (mode === "daily" ? "Daily" : "Unlimited") + (easy ? " · Easy" : "");
  $("s-played").textContent = st.played;
  $("s-win").textContent = st.played ? Math.round((st.won / st.played) * 100) : 0;
  $("s-streak").textContent = st.streak;
  $("s-max").textContent = st.maxStreak;
  const rows = ["1", "2", "3", "4", "5", "6", "X"];
  const max = Math.max(1, ...rows.map((r) => st.dist[r] || 0));
  const hl = round?.done ? (round.won ? String(round.guesses.length) : "X") : null;
  $("s-dist").innerHTML = rows.map((r) => {
    const n = st.dist[r] || 0;
    return `<div class="row"><span>${r}</span><div class="fill ${r === hl ? "hl" : ""}" style="width:${Math.max(8, (n / max) * 100)}%">${n}</div></div>`;
  }).join("");
  $("dlg-stats").showModal();
}

// ---------- wiring ----------
$("btn-play").addEventListener("click", playClip);
$("guess-form").addEventListener("submit", submitGuess);
$("btn-skip").addEventListener("click", skip);
$("btn-full").addEventListener("click", playFull);
$("btn-share").addEventListener("click", share);
$("btn-next").addEventListener("click", () => {
  $("dlg-result").close();
  if (mode === "daily") switchMode("unlimited"); else startUnlimited(true);
});
$("btn-stats").addEventListener("click", showStats);
$("btn-help").addEventListener("click", () => $("dlg-help").showModal());
$("btn-next-track").addEventListener("click", () => {
  if ($("dlg-result").open) $("dlg-result").close();
  if (mode === "daily") switchMode("unlimited");
  else startUnlimited(true);
});
$("easy-mode").addEventListener("change", (e) => {
  save("easyMode", e.target.checked);
  if (round && !round.guesses.length) {
    round.easy = e.target.checked;
    persist();
  }
  render();
});
document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => switchMode(b.dataset.mode)));
for (const [id, field] of [["f-promo", "promotion"], ["f-era", "era"]]) {
  $(id).addEventListener("change", () => {
    const f = load("filters", { promotion: "all", era: "all" });
    f[field] = $(id).value;
    save("filters", f);
    startUnlimited(true);
  });
}
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && document.activeElement?.tagName !== "INPUT" && !document.querySelector("dialog[open]")) {
    e.preventDefault(); playClip();
  }
});

// ---------- boot ----------
async function boot() {
  renderTicks();
  try {
    const r = await fetch("data/themes.json", { cache: "no-cache" });
    SONGS = await r.json();
  } catch (e) {
    setHint("Couldn't load the theme list. If you opened the file directly, run a local web server (see README).", true);
    return;
  }
  OPTIONS = buildOptions(SONGS);
  const wrestlers = new Set(SONGS.map((s) => s.wrestler)).size;
  $("help-count").textContent = `${SONGS.length} entrance themes from ${wrestlers} wrestlers and teams.`;
  const f = load("filters", { promotion: "all", era: "all" });
  $("f-promo").value = f.promotion;
  $("f-era").value = f.era;
  $("easy-mode").checked = load("easyMode", false);
  const params = new URLSearchParams(location.search);
  switchMode(params.get("mode") === "unlimited" ? "unlimited" : load("mode", "daily"));
  if (!load("seenHelp", false)) { $("dlg-help").showModal(); save("seenHelp", true); }
}
boot();
