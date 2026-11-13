import { getJSON } from './http.js';

// NFL play-by-play from ESPN's public game summary (no auth), used to say what a fantasy player just did:
// "M. Nabers caught pass for 20 yards". Fantasy platforms only report point totals, not plays.
export const NFL_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary';

export class NFLPlays {
  constructor({ fetch = globalThis.fetch, now = Date.now, ttl = 15000 } = {}) {
    Object.assign(this, { fetch, now, ttl });
    this.cache = new Map();
  }

  // Every play of one game so far, oldest first: { id, text, touchdown }.
  async plays(gameId) {
    const cached = this.cache.get(gameId);
    if (cached && this.now() - cached.at < this.ttl) return cached.value;
    const data = await getJSON(this.fetch, `${NFL_SUMMARY}?event=${encodeURIComponent(gameId)}`, 'NFL play-by-play');
    const drives = [...(data?.drives?.previous || []), ...(data?.drives?.current ? [data.drives.current] : [])];
    const seen = new Set(), value = [];
    for (const drive of drives) {
      for (const play of drive.plays || []) {
        const id = String(play.id ?? ''), text = String(play.text || '');
        if (!id || !text || seen.has(id)) continue;
        seen.add(id);
        value.push({ id, text, touchdown: isTouchdown(play) });
      }
    }
    this.cache.set(gameId, { at: this.now(), value });
    for (const [key, entry] of this.cache) if (this.now() - entry.at > 10 * 60 * 1000) this.cache.delete(key);
    return value;
  }

  // The most recent play that mentions this player, or null.
  async latestFor(gameId, name) {
    const plays = await this.plays(gameId);
    const pattern = namePattern(name);
    if (!pattern) return null;
    for (let i = plays.length - 1; i >= 0; i--) if (pattern.test(plays[i].text)) return plays[i];
    return null;
  }
}

function isTouchdown(play) {
  const type = `${play.type?.text || ''} ${play.type?.abbreviation || ''}`;
  if (/touchdown|\bTD\b/i.test(type) && !/two-point|2pt/i.test(type)) return true;
  // Reversed or nullified touchdowns still say TOUCHDOWN, so only trust the text when nothing undid it.
  return /\bTOUCHDOWN\b/.test(play.text || '') && !/\b(NULLIFIED|REVERSED|No Play)\b/i.test(play.text || '');
}

// "Malik Nabers" -> "M. Nabers", the way the app and ESPN abbreviate names.
export function shortName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(p => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p));
  if (parts.length < 2) return parts[0] || '';
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ESPN writes players as "M.Nabers" or "A.St. Brown". Matches the initial and the last name.
export function namePattern(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(p => !/^(jr|sr|ii|iii|iv|v)\.?$/i.test(p));
  if (parts.length < 2) return null;
  const last = parts.slice(1).join(' ').split(/\s+/).map(escape).join('\\s?');
  return new RegExp(`\\b${escape(parts[0][0])}\\.\\s?${last}\\b`, 'i');
}

const yards = n => n === 1 || n === -1 ? `${n} yard` : `${n} yards`;

// A short sentence about what this player did on the play, written from his point of view.
export function describePlay(text, name) {
  const who = shortName(name), me = namePattern(name);
  const clean = String(text || '')
    .replace(/^\s*\([^)]*\)\s*/, '')              // (Shotgun), (No Huddle, Shotgun)
    .replace(/\s+PENALTY on .*$/i, '')
    .replace(/\s+/g, ' ').trim();
  const td = /\bTOUCHDOWN\b/.test(clean);
  const tail = td ? ', touchdown' : '';
  const num = s => s === 'no gain' ? 0 : Number(s);
  const P = '([A-Z][\\w\'.-]*\\.\\s?[A-Z][\\w\'.-]*(?:\\s[A-Z][\\w\'.-]*)?)';

  let m = new RegExp(`^${P} pass .*?\\bto ${P}(?: to \\S+ \\d+)?(?: (?:pushed|ran) ob at \\S+ \\d+)? for (-?\\d+ yards?|no gain)`).exec(clean);
  if (m && me) {
    const gain = num(m[3].split(' ')[0]);
    if (me.test(m[2])) return `${who} caught pass for ${yards(gain)}${tail}`;
    if (me.test(m[1])) return td ? `${who} threw ${gain}-yard touchdown pass` : `${who} completed pass for ${yards(gain)}`;
  }
  m = /^(.+?) (\d+) yard field goal is GOOD/i.exec(clean);
  if (m && me?.test(m[1])) return `${who} made ${m[2]}-yard field goal`;
  if (me && new RegExp(`${me.source} extra point is GOOD`, 'i').test(clean)) return `${who} made extra point`;
  m = new RegExp(`^${P} (?:scrambles )?(?:up the middle|left|right|[a-z ]*?(?:end|tackle|guard|middle))\\b.*? for (-?\\d+ yards?|no gain)`).exec(clean);
  if (m && me?.test(m[1])) return `${who} ran for ${yards(num(m[2].split(' ')[0]))}${tail}`;
  if (me && /\bpass\b/.test(clean) && new RegExp(`^${me.source}`, 'i').test(clean) && /INTERCEPTED/i.test(clean)) return `${who} threw an interception`;
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}
