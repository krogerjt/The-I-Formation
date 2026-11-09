import { nflTeam, normalizeName, position } from './model.js';

// Sleeper's player dump carries ESPN and Yahoo ids for most players, so it is the cross-reference table.
// Sleeper asks that the ~5 MB dump be fetched at most once a day.
export const PLAYERS_URL = 'https://api.sleeper.app/v1/players/nfl';
const DAY = 24 * 60 * 60 * 1000;

export class PlayerIndex {
  constructor({ fetch = globalThis.fetch, now = Date.now, maxAge = DAY } = {}) {
    this.fetch = fetch; this.now = now; this.maxAge = maxAge;
    this.loadedAt = 0; this.loading = null;
    this.load({});
  }

  load(dump) {
    this.bySleeper = new Map(); this.byEspn = new Map(); this.byYahoo = new Map(); this.byName = new Map();
    for (const [id, p] of Object.entries(dump)) {
      const entry = { sleeper: id, name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '), position: position(p.position), nflTeam: nflTeam(p.team) };
      this.bySleeper.set(id, entry);
      if (p.espn_id != null) this.byEspn.set(String(p.espn_id), entry);
      if (p.yahoo_id != null) this.byYahoo.set(String(p.yahoo_id), entry);
      if (entry.name && entry.position) this.byName.set(nameKey(entry.name, entry.position, entry.nflTeam), entry);
    }
  }

  async refresh() {
    if (this.now() - this.loadedAt < this.maxAge) return;
    this.loading ||= (async () => {
      try {
        const res = await this.fetch(PLAYERS_URL, { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`Sleeper players returned ${res.status}`);
        this.load(await res.json());
        this.loadedAt = this.now();
      } finally { this.loading = null; }
    })();
    return this.loading;
  }

  // A stable key for one real player, whichever platform reported him.
  keyFor(p) {
    if (p.position === 'DEF') return `DEF:${p.nflTeam}`;
    const match = (p.ids.sleeper && this.bySleeper.get(String(p.ids.sleeper)))
      || (p.ids.espn && this.byEspn.get(String(p.ids.espn)))
      || (p.ids.yahoo && this.byYahoo.get(String(p.ids.yahoo)))
      || this.byName.get(nameKey(p.name, p.position, p.nflTeam));
    return match ? `sleeper:${match.sleeper}` : `name:${nameKey(p.name, p.position, p.nflTeam)}`;
  }

  sleeperPlayer(id) { return this.bySleeper.get(String(id)); }
}

function nameKey(name, pos, team) { return `${normalizeName(name)}|${pos || ''}|${team || ''}`; }
