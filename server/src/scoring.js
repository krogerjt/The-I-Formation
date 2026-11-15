// Each league's scoring rules, in one shape, so the live feed can tell which play a point change came from:
// +0.1 fits a 1-yard run, while a catch for -1 yards would be about +0.9 in a PPR league.
//
// A profile is points per unit:
//   { passYd, passTd, passCmp, rushYd, rushTd, rec, recYd, recTd, pass2pt, rush2pt, rec2pt, pat, fg }
// where fg is [[longest distance, points], ...] from shortest to longest.

export const DEFAULT_SCORING = Object.freeze({
  passYd: 0.04, passTd: 4, passCmp: 0, rushYd: 0.1, rushTd: 6, rec: 0.5, recYd: 0.1, recTd: 6,
  pass2pt: 2, rush2pt: 2, rec2pt: 2, pat: 1, fg: [[39, 3], [49, 4], [99, 5]],
});

const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v));
const defined = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const fgTable = rows => {
  const table = rows.filter(([, pts]) => pts !== undefined);
  return table.length ? table : undefined;
};
const profile = parts => ({ ...DEFAULT_SCORING, ...defined(parts) });

// Sleeper: league.scoring_settings, e.g. { pass_yd: 0.04, rec: 0.5, fgm_40_49: 4, ... }.
export function sleeperScoring(s) {
  if (!s) return null;
  return profile({
    passYd: num(s.pass_yd), passTd: num(s.pass_td), passCmp: num(s.pass_cmp), rushYd: num(s.rush_yd), rushTd: num(s.rush_td),
    rec: num(s.rec), recYd: num(s.rec_yd), recTd: num(s.rec_td),
    pass2pt: num(s.pass_2pt), rush2pt: num(s.rush_2pt), rec2pt: num(s.rec_2pt), pat: num(s.xpm),
    fg: fgTable([[19, num(s.fgm_0_19)], [29, num(s.fgm_20_29)], [39, num(s.fgm_30_39)], [49, num(s.fgm_40_49)],
      [59, num(s.fgm_50_59) ?? num(s.fgm_50p)], [99, num(s.fgm_60p) ?? num(s.fgm_50p)]]),
  });
}

// ESPN: settings.scoringSettings.scoringItems, [{ statId, points }], by ESPN's stat ids.
const ESPN_STATS = { 1: 'passCmp', 3: 'passYd', 4: 'passTd', 19: 'pass2pt', 24: 'rushYd', 25: 'rushTd', 26: 'rush2pt', 42: 'recYd', 43: 'recTd', 44: 'rec2pt', 53: 'rec', 86: 'pat' };
export function espnScoring(items) {
  if (!Array.isArray(items) || !items.length) return null;
  const byId = new Map(items.map(i => [Number(i.statId), num(i.points)]));
  const parts = Object.fromEntries(Object.entries(ESPN_STATS).map(([id, key]) => [key, byId.get(Number(id))]));
  // Yards scored per yard; leagues that score per 5, 10 or 25 yards fall back to the default rate.
  for (const key of ['passYd', 'rushYd', 'recYd']) if (parts[key] === undefined) delete parts[key];
  return profile({ ...parts, fg: fgTable([[39, byId.get(80)], [49, byId.get(77)], [59, byId.get(198) ?? byId.get(74)], [99, byId.get(201) ?? byId.get(74)]]) });
}

// Yahoo: league settings' stat_modifiers, [{ stat: { stat_id, value } }], by Yahoo's stat ids.
const YAHOO_STATS = { 2: 'passCmp', 4: 'passYd', 5: 'passTd', 9: 'rushYd', 10: 'rushTd', 11: 'rec', 12: 'recYd', 13: 'recTd', 29: 'pat' };
export function yahooScoring(modifiers) {
  if (!Array.isArray(modifiers) || !modifiers.length) return null;
  const byId = new Map(modifiers.map(m => m.stat || m).map(s => [Number(s.stat_id), num(s.value)]));
  const parts = Object.fromEntries(Object.entries(YAHOO_STATS).map(([id, key]) => [key, byId.get(Number(id))]));
  const twoPt = byId.get(16);
  return profile({ ...parts, pass2pt: twoPt, rush2pt: twoPt, rec2pt: twoPt,
    fg: fgTable([[19, byId.get(19)], [29, byId.get(20)], [39, byId.get(21)], [49, byId.get(22)], [99, byId.get(23)]]) });
}

// Points a stat line is worth: { passCmp, passYd, passTd, rushYd, rushTd, rec, recYd, recTd, pass2pt, rush2pt, rec2pt, pat, fg }.
export function pointsFor(stats, scoring = DEFAULT_SCORING) {
  if (!stats) return null;
  let total = 0;
  for (const [key, value] of Object.entries(stats)) {
    if (key === 'fg') total += (scoring.fg.find(([longest]) => value <= longest) || scoring.fg.at(-1))[1];
    else total += (scoring[key] ?? 0) * value;
  }
  return Math.round(total * 100) / 100;
}
