// Run with: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CLIP_STEPS, normalize, dayNumber, dailySong, randomSong, filterSongs, buildOptions,
  searchOptions, isCorrect, isPartial, shareGrid, updateStats, emptyStats, dailyStreakStillValid,
  getClues,
} from "../js/logic.js";

const SONGS = JSON.parse(readFileSync(new URL("../data/themes.json", import.meta.url)));
const OPTS = buildOptions(SONGS);
const find = (name) => SONGS.find((s) => s.wrestler === name);

test("data file is well-formed", () => {
  assert.ok(SONGS.length > 300);
  const ids = new Set();
  for (const s of SONGS) {
    assert.ok(Number.isInteger(s.id) && s.id > 0, `bad id ${s.id}`);
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.wrestler && s.song, "missing name/song");
    assert.ok(["WWE", "AEW"].includes(s.promotion));
    assert.ok(["Classic", "Modern"].includes(s.era));
  }
});

test("clip steps increase", () => {
  for (let i = 1; i < CLIP_STEPS.length; i++) assert.ok(CLIP_STEPS[i] > CLIP_STEPS[i - 1]);
});

test("normalize strips accents and punctuation", () => {
  assert.equal(normalize("Finn Bálor"), "finn balor");
  assert.equal(normalize("D’Lo Brown"), normalize("D'Lo Brown"));
  assert.equal(normalize("  The Rock!! "), "the rock");
});

test("daily song is stable for a date and changes the next day", () => {
  const d1 = new Date(2026, 11, 25, 9), d1b = new Date(2026, 11, 25, 23, 59), d2 = new Date(2026, 11, 26, 0, 1);
  assert.equal(dailySong(SONGS, d1).id, dailySong(SONGS, d1b).id);
  assert.notEqual(dailySong(SONGS, d1).id, dailySong(SONGS, d2).id);
});

test("daily works through every song before repeating", () => {
  const start = new Date(2026, 10, 26);
  const seen = new Set();
  for (let i = 0; i < SONGS.length; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    seen.add(dailySong(SONGS, d).id);
  }
  assert.equal(seen.size, SONGS.length);
});

test("day numbering survives DST changes", () => {
  assert.equal(dayNumber(new Date(2027, 2, 29)) - dayNumber(new Date(2027, 2, 27)), 2); // UK clocks change 28 Mar 2027
});

test("search finds wrestlers by name and alias; no song entries", () => {
  assert.equal(searchOptions(OPTS, "stone")[0].label, "Stone Cold Steve Austin");
  assert.equal(searchOptions(OPTS, "hbk")[0].label, "Shawn Michaels");
  assert.equal(searchOptions(OPTS, "balor")[0].label, "Finn Bálor");
  assert.ok(OPTS.every((o) => o.type === "wrestler"));
  assert.deepEqual(searchOptions(OPTS, ""), []);
});

test("wrestler guess is accepted; wrong wrestler is not", () => {
  const ans = SONGS.find((s) => s.song === "The Game");
  const w = OPTS.find((o) => o.label === "Triple H");
  const wrongW = OPTS.find((o) => o.label === "The Rock");
  assert.ok(isCorrect(w, ans));
  assert.ok(!isCorrect(wrongW, ans));
});

test("any theme of the right wrestler counts", () => {
  const ans = SONGS.find((s) => s.song === "King of Kings");
  assert.ok(isCorrect(OPTS.find((o) => o.label === "Triple H"), ans));
});

test("partial = same promotion and era", () => {
  const ans = find("Triple H");
  assert.ok(isPartial(OPTS.find((o) => o.label === "The Rock"), ans, SONGS));
  assert.ok(!isPartial(OPTS.find((o) => o.label === "Kenny Omega"), ans, SONGS));
});

test("filters and random pick", () => {
  const aew = filterSongs(SONGS, { promotion: "AEW" });
  assert.ok(aew.length > 40 && aew.every((s) => s.promotion === "AEW"));
  const pool = SONGS.slice(0, 3);
  const pick = randomSong(pool, [pool[0].id, pool[1].id], () => 0);
  assert.equal(pick.id, pool[2].id);
});

test("share grid pads to six", () => {
  assert.equal(shareGrid([{ result: "skip" }, { result: "partial" }, { result: "correct" }]), "⬛🟨🟩⬜⬜⬜");
});

test("easy-mode clues compare gender, actType and company", () => {
  const ans = find("Triple H");
  const rock = OPTS.find((o) => o.label === "The Rock");
  const trish = OPTS.find((o) => o.label === "Trish Stratus");
  const shield = OPTS.find((o) => o.label === "The Shield");
  const kenny = OPTS.find((o) => o.label === "Kenny Omega");
  const song = OPTS.find((o) => o.type === "song" && o.label === "The Game");

  assert.equal(getClues(song, ans, SONGS), null);           // songs have no wrestler clues

  const c1 = getClues(rock, ans, SONGS);
  assert.equal(c1.gender.status, "match");                   // both male
  assert.equal(c1.actType.status, "match");                  // both singles
  assert.equal(c1.company.status, "match");                  // WWF/WWE overlap

  const c2 = getClues(trish, ans, SONGS);
  assert.equal(c2.gender.status, "miss");                    // female vs male
  assert.equal(c2.actType.status, "match");                  // both singles

  const c3 = getClues(shield, ans, SONGS);
  assert.equal(c3.actType.status, "miss");                   // group vs singles

  const c4 = getClues(kenny, ans, SONGS);
  assert.equal(c4.company.status, "miss");                   // AEW/NJPW/DDT vs WWF/WWE
});

test("stats update and don't double count", () => {
  let st = updateStats(emptyStats(), { won: true, attempts: 2, key: "2026-11-26" });
  st = updateStats(st, { won: true, attempts: 2, key: "2026-11-26" });
  assert.equal(st.played, 1);
  assert.equal(st.dist[2], 1);
  st = updateStats(st, { won: false, attempts: 6, key: "2026-11-27" });
  assert.equal(st.streak, 0);
  assert.equal(st.maxStreak, 1);
  assert.ok(dailyStreakStillValid(10, 11) && !dailyStreakStillValid(9, 11));
});
