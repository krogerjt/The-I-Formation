import { getJSON } from './http.js';
import { nflTeam } from '../model.js';
import { pointsFor } from '../scoring.js';

// NFL play-by-play from ESPN's public game summary (no auth), used to say what a fantasy player just did:
// "M. Nabers caught pass for 20 yards". Fantasy platforms only report point totals, not plays.
export const NFL_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

export class NFLPlays {
  constructor({ fetch = globalThis.fetch, now = Date.now, ttl = 15000 } = {}) {
    Object.assign(this, { fetch, now, ttl });
    this.cache = new Map();
  }

  // Every play of one game so far, oldest first: { id, text, touchdown, team, at }, where team is the side
  // with the ball and at is when it happened (ms), when ESPN says.
  async plays(gameId) {
    const cached = this.cache.get(gameId);
    if (cached && this.now() - cached.at < this.ttl) return cached.value;
    const data = await getJSON(this.fetch, `${NFL_SUMMARY}?event=${encodeURIComponent(gameId)}`, 'NFL play-by-play');
    const drives = [...(data?.drives?.previous || []), ...(data?.drives?.current ? [data.drives.current] : [])];
    const teams = new Map((data?.header?.competitions?.[0]?.competitors || []).map(c => [String(c.id ?? c.team?.id), nflTeam(c.team?.abbreviation)]));
    const seen = new Set(), value = [];
    for (const drive of drives) {
      for (const play of drive.plays || []) {
        const id = String(play.id ?? ''), text = String(play.text || '');
        if (!id || !text || seen.has(id)) continue;
        seen.add(id);
        value.push({ id, text, touchdown: isTouchdown(play), team: teams.get(String(play.start?.team?.id)) ?? null, at: Date.parse(play.wallclock) || null });
      }
    }
    // Everyone in the game's box score, to tell apart two players whose short names are the same.
    value.names = [...new Set((data?.boxscore?.players || []).flatMap(t => (t.statistics || []).flatMap(c => (c.athletes || []).map(a => a.athlete?.displayName).filter(Boolean))))];
    this.cache.set(gameId, { at: this.now(), value });
    for (const [key, entry] of this.cache) if (this.now() - entry.at > 10 * 60 * 1000) this.cache.delete(key);
    return value;
  }

  // The play that most likely earned this player's new points: the latest one that mentions him and that
  // gained something (a catch, a run or completion for positive yards, a kick or a two-point try). Fantasy
  // points often update a play or two late, so a newer sack, incompletion or run for a loss is skipped:
  // a 16-yard scramble followed by a 4-yard loss on a completion is the scramble's points, not the loss's.
  // Falls back to the latest play that mentions him, or null. With his NFL team, plays by the other side
  // are skipped: Travis Etienne Jr. (NO) and Trevor Etienne (CAR) are both "T.Etienne" to ESPN.
  //
  // Given the point change and the league's scoring ({ points, scoring, credited, since }), it picks the
  // play whose points fit the change instead: +0.1 is a 1-yard run, not the catch for -1 yards after it
  // that a PPR league scores +0.9. `credited` (play id -> points already shown for it) leaves room for a
  // play whose points come in pieces, and `since` (the poll before last, ms) favors plays made since then.
  async latestFor(gameId, name, team = null, fit = null) {
    const plays = await this.plays(gameId);
    const pattern = namePattern(name);
    if (!pattern) return null;
    // The play, with the player's name as the app should write it in this game ("Tra. Etienne").
    const named = play => ({ ...play, shortName: distinctShortName(name, plays.names || []) });
    let latest = null, seen = 0;
    const gained = [];
    for (let i = plays.length - 1; i >= 0 && seen < 12; i--) {
      if (!pattern.test(plays[i].text) || (team && plays[i].team && plays[i].team !== team)) continue;
      latest ||= plays[i];
      seen++;
      if (!gainedOn(plays[i].text, name)) continue;
      if (fit?.points == null) return named(plays[i]);
      gained.push(plays[i]);
    }
    const best = bestFit(gained, name, fit || {});
    return best ? named(best) : latest && named(latest);
  }
}

// Of the plays that gained this player something (newest first), the one whose points best fit the change.
// A newer play wins a close call; a play whose points were all shown already is out; a change smaller than
// a play's points can be its first piece, which fits less well than an exact match.
const STAT_LAG = 3 * 60 * 1000;
function bestFit(plays, name, { points, scoring, credited = new Map(), since = null } = {}) {
  if (!plays.length) return null;
  const recent = since ? plays.filter(p => p.at == null || p.at >= since - STAT_LAG) : plays;
  let best = null, bestCost = Infinity;
  (recent.length ? recent : plays).forEach((play, rank) => {
    const left = (pointsFor(statsFor(play.text, name), scoring || undefined) ?? points) - (credited.get(play.id) ?? 0);
    if (credited.has(play.id) && left <= 0.05) return;
    const miss = Math.abs(left - points);
    const cost = (points < left - 0.05 ? Math.min(miss, 0.5) : miss) + 0.1 * rank;
    if (cost < bestCost) { best = play; bestCost = cost; }
  });
  return best;
}

function isTouchdown(play) {
  const type = `${play.type?.text || ''} ${play.type?.abbreviation || ''}`;
  if (/touchdown|\bTD\b/i.test(type) && !/two-point|2pt/i.test(type)) return true;
  // A touchdown taken away by a penalty or replay still says TOUCHDOWN somewhere, so read only the call
  // that stood.
  const { main, nullified } = readPlay(play.text);
  return !nullified && /\bTOUCHDOWN\b/.test(main);
}

// "Malik Nabers" -> "M. Nabers", the way the app and ESPN abbreviate names.
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(p => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p));
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

// shortName, with more of the first name when another player in the same game would read the same:
// Travis Etienne Jr. and Trevor Etienne are "Tra. Etienne" and "Tre. Etienne".
export function distinctShortName(name, others) {
  const short = shortName(name);
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const rivals = others.filter(o => o !== name && shortName(o) === short).map(o => o.trim().split(/\s+/)[0]);
  if (!rivals.length) return short;
  let n = 1;
  while (n < first.length && rivals.some(r => r.slice(0, n).toLowerCase() === first.slice(0, n).toLowerCase())) n++;
  const same = rivals.some(r => r.toLowerCase() === first.toLowerCase());
  return n === 1 || same ? short : `${first.slice(0, n)}.${short.slice(2)}`;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ESPN writes players as "M.Nabers" or "A.St. Brown". When two players in a game share an initial and last
// name it spells out more of the first name ("Bri.Thomas", "Jo.Williams"), so any start of it matches.
export function namePattern(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(p => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p));
  if (parts.length < 2) return null;
  const last = parts.slice(1).join(' ').split(/\s+/).map(escape).join('\\s?');
  const first = /^[A-Za-z]+/.exec(parts[0])?.[0] || parts[0][0];
  const starts = Array.from(first, (_, i) => escape(first.slice(0, i + 1))).reverse().join('|');
  return new RegExp(`\\b(?:${starts})\\.\\s?${last}\\b`, 'i');
}

const yards = n => n === 0 ? 'no gain' : n === 1 || n === -1 ? `${n} yard` : `${n} yards`;

// A short sentence about what this player did on the play, written from his point of view.
export function describePlay(text, name) {
  return describeKnown(text, name) ?? shorten(cleanText(text));
}

// A player as ESPN writes one: "M.Nabers", "Bri.Thomas", "A.St. Brown", "L.Van Ness". The part before the dot is
// short, so "TOUCHDOWN. D.Zvada" isn't read as one name.
const NAME = "\\b[A-Z][A-Za-z]{0,4}\\.\\s?[A-Z][\\w'.-]*(?:\\s[A-Z][\\w'.-]*)?";
const NOTE_IN_FRONT = new RegExp(`^(?:\\([^)]*\\)|${NAME} reported in as eligible\\.|Direct snap to ${NAME}\\.(?=\\s))\\s*`);

// Splits ESPN's text for one play into the call that stood and the tries after a touchdown.
//   main: the play itself, without what ESPN puts in front ("(14:12) (Shotgun)", "C.Tiernan reported in as
//         eligible.", "Direct snap to T.Kraft."), the penalties and injury notes behind it, or the extra
//         point or two-point try that ESPN adds to a touchdown's text.
//   extraPoint: "W.Reichard extra point is GOOD" when one is in the text.
//   twoPoint: "K.McCord pass to G.Dulcich is complete" when a two-point try succeeded.
//   nullified: a penalty wiped the play out ("- No Play", "TOUCHDOWN NULLIFIED"), so nobody gained anything.
//   stood: all of the call that stood, penalties included.
// After a replay reversal ESPN gives the original call, then "the play was REVERSED.", then the call that
// stood, so only the text after the reversal counts.
export function readPlay(text) {
  let s = String(text || '').replace(/\s+/g, ' ');
  const reversed = s.lastIndexOf('REVERSED.');
  if (reversed >= 0) s = s.slice(reversed + 'REVERSED.'.length);
  s = s.replace(/\s*\*\*.*$/, '').trim();
  for (let before; before !== s;) { before = s; s = s.replace(NOTE_IN_FRONT, ''); }
  const twoPoint = /TWO-POINT CONVERSION ATTEMPT\.\s*(.*?)\.?\s*ATTEMPT SUCCEEDS/.exec(s)?.[1] ?? null;
  const extraPoint = new RegExp(`${NAME} extra point is GOOD`).exec(s)?.[0] ?? null;
  const play = s.replace(/\s*TWO-POINT CONVERSION ATTEMPT\..*$/, '');
  const nullified = /- No Play\b|\bNULLIFIED\b/.test(play);
  const main = play.replace(new RegExp(`\\s*${NAME} extra point is .*$`), '').replace(/\s*\bPENALTY on .*$/i, '').trim();
  return { main, extraPoint, twoPoint, nullified, stood: s };
}

// The text to show when the play isn't one this file can put into words. A play that's only a penalty keeps it.
const cleanText = text => { const { main, stood } = readPlay(text); return main || stood; };
const shorten = clean => clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;

const PLAYER = '([A-Z][\\w\'.-]*\\.\\s?[A-Z][\\w\'.-]*(?:\\s[A-Z][\\w\'.-]*)?)';
// "J.Dart pass short middle to M.Nabers to NYG 45 for 12 yards": passer, receiver, gain.
const PASS_PLAY = new RegExp(`^${PLAYER} pass .*?\\bto ${PLAYER}(?: to (?:\\S+ )?-?\\d+)?(?: (?:pushed|ran) ob at (?:\\S+ )?-?\\d+)? for (-?\\d+ yards?|no gain)`);
// Runs: "B.Robinson up the middle to ATL 41 for 1 yard", "A.Kamara to CAR 26 for 1 yard",
// "A.Jones left end for 1 yard, TOUCHDOWN". Not passes (an interception thrown "short middle" is
// returned "for 25 yards"), kneels, sacks or aborted snaps.
const RUN_PLAY = new RegExp(`^${PLAYER} (?!pass |sacked |kneels )(?:scrambles )?(?:(?:up the middle|left|right|[a-z ]*?(?:end|tackle|guard|middle)|to|pushed|ran)\\b.*? )?for (-?\\d+ yards?|no gain)`);
const FIELD_GOAL = /^(.+?) (\d+) yard field goal is GOOD/i;
const yardsIn = s => /^no\b/.test(s) ? 0 : Number(s.split(' ')[0]);

// What this player put in the box score on the play, for scoring it:
// { passCmp, passYd, passTd } / { rec, recYd, recTd } / { rushYd, rushTd } / { fg } / { pat } / { rec2pt } ...
// Null when the play gained him nothing that scores.
export function statsFor(text, name) {
  const me = namePattern(name);
  if (!me) return null;
  const { main, extraPoint, twoPoint, nullified } = readPlay(text);
  if (nullified) return null;
  const td = /\bTOUCHDOWN\b/.test(main) ? 1 : 0;
  let m = PASS_PLAY.exec(main);
  if (m && me.test(m[2])) return { rec: 1, recYd: yardsIn(m[3]), recTd: td };
  if (m && me.test(m[1])) return { passCmp: 1, passYd: yardsIn(m[3]), passTd: td };
  m = FIELD_GOAL.exec(main);
  if (m && me.test(m[1])) return { fg: Number(m[2]) };
  m = RUN_PLAY.exec(main);
  if (m && me.test(m[1])) return { rushYd: yardsIn(m[2]), rushTd: td };
  if (extraPoint && me.test(extraPoint)) return { pat: 1 };
  if (twoPoint) {
    m = new RegExp(`^${PLAYER} pass to ${PLAYER}`).exec(twoPoint);
    if (m && me.test(m[2])) return { rec2pt: 1 };
    if (m && me.test(m[1])) return { pass2pt: 1 };
    m = new RegExp(`^${PLAYER} `).exec(twoPoint);
    if (m && me.test(m[1])) return { rush2pt: 1 };
  }
  return null;
}

// The sentence for a play where this player gained something, or null when the play isn't one of those.
export function describeKnown(text, name) {
  const who = shortName(name), me = namePattern(name);
  const { main: clean, extraPoint, twoPoint, nullified } = readPlay(text);
  if (nullified) return null;
  const td = /\bTOUCHDOWN\b/.test(clean);
  const tail = td ? ', touchdown' : '';
  const num = s => /^no\b/.test(s) ? 0 : Number(s);
  const P = PLAYER;

  let m = PASS_PLAY.exec(clean);
  if (m && me) {
    const gain = num(m[3].split(' ')[0]);
    if (me.test(m[2])) return `${who} caught pass for ${yards(gain)}${tail}`;
    // ESPN writes the receiver as "B.Thomas"; show him the way the app writes names, "B. Thomas".
    const to = m[2].replace(/^([A-Z][a-z]?)\.\s?/, '$1. ');
    if (me.test(m[1])) return td ? `${who} threw ${gain}-yard touchdown pass to ${to}` : `${who} completed pass to ${to} for ${yards(gain)}`;
  }
  m = FIELD_GOAL.exec(clean);
  if (m && me?.test(m[1])) return `${who} made ${m[2]}-yard field goal`;
  m = RUN_PLAY.exec(clean);
  if (m && me?.test(m[1])) return `${who} ran for ${yards(num(m[2].split(' ')[0]))}${tail}`;
  // The kick or two-point try after a touchdown is part of the touchdown's text.
  if (extraPoint && me?.test(extraPoint)) return `${who} made extra point`;
  if (twoPoint && me) {
    m = new RegExp(`^${P} pass to ${P}`).exec(twoPoint);
    if (m && me.test(m[2])) return `${who} caught two-point conversion`;
    if (m && me.test(m[1])) return `${who} threw two-point conversion`;
    m = new RegExp(`^${P} `).exec(twoPoint);
    if (m && me.test(m[1])) return `${who} ran in two-point conversion`;
  }
  return null;
}

// Whether this player gained points on the play: a catch (worth a point in PPR even for a loss), a run or
// completion for positive yards, a touchdown, a kick or a two-point try.
export function gainedOn(text, name) {
  const said = describeKnown(text, name);
  if (!said) return false;
  if (/ caught /.test(said)) return true;
  const { main } = readPlay(text);
  if (/\bTOUCHDOWN\b/.test(main) && namePattern(name).test(main)) return true;
  const gain = / for (-?\d+) yards?\b| for (no gain)\b/.exec(main);
  return !gain || !namePattern(name).test(main) || Number(gain[1] ?? 0) > 0;
}

// Whether this player scored the play's touchdown (threw it, caught it or ran it in). Not the kicker of the
// extra point or the player in the two-point try that ESPN adds to the same play's text.
export function scoredTouchdown(text, name) {
  const { main, nullified } = readPlay(text), me = namePattern(name);
  return Boolean(me && !nullified && /\bTOUCHDOWN\b/.test(main) && me.test(main.replace(/\([^)]*\)|\[[^\]]*\]/g, '')));
}
