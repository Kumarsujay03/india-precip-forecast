// Run with: node --test tests/dry.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { nextDryWindow, rainBetween } = require("../site/dry.js");

const steps = [0, 3, 6, 9, 12, 15, 18, 24];          // last interval is 6 h
// mm per interval: wet, wet, dry, dry, dry, wet, dry
const mm = [2, 1.5, 0, 0.1, 0.2, 4, 0];               // 0.1 mm/3h and 0.2 mm/3h are below 0.1 mm/h

test("finds the first dry spell of at least 6 h", () => {
  assert.deepEqual(nextDryWindow(steps, mm, 0),
    { start: 6, end: 15, hours: 9, dryNow: false, openEnded: false });
});

test("dry now when starting inside a dry spell (partial interval counts from now)", () => {
  const w = nextDryWindow(steps, mm, 7.5);
  assert.equal(w.dryNow, true);
  assert.equal(w.start, 7.5);
  assert.equal(w.end, 15);
});

test("too-short spell is skipped; open-ended spell at forecast end", () => {
  // from 13 h only 2 h of the dry spell remain, then rain, then 6 h dry to the end
  assert.deepEqual(nextDryWindow(steps, mm, 13),
    { start: 18, end: 24, hours: 6, dryNow: false, openEnded: true });
});

test("returns null when it never stays dry long enough", () => {
  assert.equal(nextDryWindow([0, 3, 6, 9], [1, 0, 1], 0), null);
});

test("rainBetween pro-rates partly covered intervals", () => {
  assert.equal(rainBetween(steps, mm, 0, 6), 3.5);
  assert.equal(rainBetween(steps, mm, 1.5, 4.5), 1 + 0.75);   // half of 2 mm + half of 1.5 mm
  assert.ok(Math.abs(rainBetween(steps, mm, 0, 24) - 7.8) < 1e-9);
});
