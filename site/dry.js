// Point-forecast helpers (pure functions, also loaded by node tests).
// steps: forecast hours [0, 3, ..., 240]; mm[i] = rain in interval steps[i]..steps[i+1].

const DRY_RATE = 0.1;   // mm/h: an interval is "dry" if its mean rate is below this
const MIN_DRY_H = 6;    // shortest dry spell worth reporting

/**
 * Next dry window starting at or after `fromHour` (hours since run start).
 * Returns {start, end, hours, dryNow, openEnded} in forecast hours, or null if
 * there is no dry spell of at least `minHours` before the forecast ends.
 * openEnded = the dry spell is still going at the end of the forecast.
 */
function nextDryWindow(steps, mm, fromHour = 0, { minHours = MIN_DRY_H, dryRate = DRY_RATE } = {}) {
  let start = null;
  for (let i = 0; i < mm.length; i++) {
    const a = Math.max(steps[i], fromHour), b = steps[i + 1];
    if (b <= fromHour) continue;                         // interval already over
    const dry = mm[i] / (steps[i + 1] - steps[i]) < dryRate;
    if (dry) {
      if (start === null) start = a;
    } else if (start !== null) {
      if (a - start >= minHours) return win(start, a, fromHour, false);
      start = null;
    }
  }
  const end = steps[steps.length - 1];
  if (start !== null && end - start >= minHours) return win(start, end, fromHour, true);
  return null;
}

function win(start, end, fromHour, openEnded) {
  return { start, end, hours: end - start, dryNow: start <= fromHour, openEnded };
}

/** Total rain (mm) between hours h0 and h1, pro-rating partly covered intervals. */
function rainBetween(steps, mm, h0, h1) {
  let total = 0;
  for (let i = 0; i < mm.length; i++) {
    const a = Math.max(steps[i], h0), b = Math.min(steps[i + 1], h1);
    if (b > a) total += (mm[i] * (b - a)) / (steps[i + 1] - steps[i]);
  }
  return total;
}

if (typeof module !== "undefined") module.exports = { nextDryWindow, rainBetween, DRY_RATE, MIN_DRY_H };
