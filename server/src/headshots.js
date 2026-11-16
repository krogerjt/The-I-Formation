import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// A small store of player headshots for everyone on my rosters (starters and bench, every league), so the
// app can copy them onto the phone ahead of time. The Live Activity can't download images and its pushes are
// limited to ~4 KB, so the slide only carries the headshot's id and the phone must already have the picture.
//
// Once a day it reads this week's rosters, downloads any missing headshots (Sleeper's CDN first, ESPN's as the
// fallback) and drops players who haven't been on a roster for two weeks. Waiver and free-agent adds show up
// on the next daily pass, or sooner when the app asks for the list.
//
// On disk: <dir>/index.json, plus one image file per player.
//   index: { [id]: { name, nflTeam, file, type, fetchedAt, rosteredAt } | { name, nflTeam, missingAt, rosteredAt } }

export const SLEEPER_HEADSHOT = 'https://sleepercdn.com/content/nfl/players/thumb/';
export const ESPN_HEADSHOT = 'https://a.espncdn.com/i/headshots/nfl/players/full/';
export const HEADSHOT_ID = /^(espn-)?\d{1,12}$/;

const DAY = 24 * 60 * 60 * 1000;
const MAX_BYTES = 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export class Headshots {
  constructor({ dir = null, aggregator, players, fetch = globalThis.fetch, now = Date.now,
    maxAge = DAY, refetchAfter = 30 * DAY, retryMissingAfter = 3 * DAY, keepFor = 14 * DAY } = {}) {
    Object.assign(this, { dir, aggregator, players, fetch, now, maxAge, refetchAfter, retryMissingAfter, keepFor });
    this.images = new Map(); // id -> Buffer, when there's no dir (tests)
    this.index = this.readIndex();
    this.refreshedAt = 0;
    this.refreshing = null;
  }

  readIndex() {
    if (!this.dir) return {};
    try { return JSON.parse(readFileSync(join(this.dir, 'index.json'), 'utf8')); } catch { return {}; }
  }

  writeIndex() {
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    const temp = join(this.dir, 'index.json.tmp');
    writeFileSync(temp, JSON.stringify(this.index));
    renameSync(temp, join(this.dir, 'index.json'));
  }

  // At most once per `minAge` (a day by default); concurrent callers share one pass.
  async refresh({ minAge = this.maxAge } = {}) {
    if (this.now() - this.refreshedAt < minAge) return;
    this.refreshing ||= this.update().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  // Every player on one of my rosters this week, by headshot id.
  async rostered() {
    const { matchups } = await this.aggregator.collect();
    const out = new Map();
    for (const m of matchups) for (const p of m.me?.players || []) {
      const id = this.players.headshotId(p);
      if (!id || out.has(id)) continue;
      const known = id.startsWith('espn-') ? null : this.players.sleeperPlayer(id);
      out.set(id, { name: p.name, nflTeam: p.nflTeam, espn: p.ids?.espn || known?.espn || (id.startsWith('espn-') ? id.slice(5) : null) });
    }
    return { roster: out, complete: matchups.length > 0 };
  }

  async update() {
    const { roster, complete } = await this.rostered();
    const now = this.now();
    const wanted = [];
    for (const [id, p] of roster) {
      const entry = this.index[id] ||= {};
      Object.assign(entry, { name: p.name, nflTeam: p.nflTeam, rosteredAt: now });
      const stale = entry.file ? now - entry.fetchedAt > this.refetchAfter : !entry.missingAt || now - entry.missingAt > this.retryMissingAfter;
      if (stale) wanted.push([id, p]);
    }
    // Four at a time, to be polite to the CDNs.
    for (let i = 0; i < wanted.length; i += 4) await Promise.all(wanted.slice(i, i + 4).map(([id, p]) => this.download(id, p)));
    // Only prune after a pass that saw at least one roster, so a platform outage doesn't empty the store.
    if (complete) for (const [id, entry] of Object.entries(this.index)) if (now - (entry.rosteredAt || 0) > this.keepFor) this.remove(id);
    this.writeIndex();
    this.refreshedAt = now;
  }

  async download(id, p) {
    const sources = [];
    if (!id.startsWith('espn-')) sources.push(`${SLEEPER_HEADSHOT}${id}.jpg`);
    if (p.espn) sources.push(`${ESPN_HEADSHOT}${p.espn}.png`);
    const entry = this.index[id];
    for (const url of sources) {
      try {
        const res = await this.fetch(url, { headers: { accept: 'image/*' } });
        const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!res.ok || !TYPES[type]) continue;
        const data = Buffer.from(await res.arrayBuffer());
        if (!data.length || data.length > MAX_BYTES) continue;
        const file = `${id}.${TYPES[type]}`;
        if (entry.file && entry.file !== file) this.removeFile(entry.file);
        this.saveFile(file, data);
        Object.assign(entry, { file, type, fetchedAt: this.now() });
        delete entry.missingAt;
        return;
      } catch {}
    }
    // Keep an older picture over none; otherwise remember the miss so it's retried in a few days, not hourly.
    if (!entry.file) entry.missingAt = this.now();
  }

  saveFile(file, data) {
    if (!this.dir) return this.images.set(file, data);
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${file}.tmp`), data);
    renameSync(join(this.dir, `${file}.tmp`), join(this.dir, file));
  }

  removeFile(file) {
    if (!this.dir) return this.images.delete(file);
    rmSync(join(this.dir, file), { force: true });
  }

  remove(id) {
    if (this.index[id]?.file) this.removeFile(this.index[id].file);
    delete this.index[id];
  }

  // What the app downloads: every headshot on file. `version` changes when the picture does.
  list() {
    const players = Object.entries(this.index).filter(([, e]) => e.file)
      .map(([id, e]) => ({ id, name: e.name, nflTeam: e.nflTeam ?? null, version: String(e.fetchedAt) }));
    return { updatedAt: this.refreshedAt ? new Date(this.refreshedAt).toISOString() : null, players };
  }

  image(id) {
    const entry = HEADSHOT_ID.test(id) ? this.index[id] : null;
    if (!entry?.file) return null;
    try {
      const data = this.dir ? readFileSync(join(this.dir, entry.file)) : this.images.get(entry.file);
      return data ? { data, type: entry.type } : null;
    } catch { return null; }
  }

  // Checks every hour whether the daily pass is due.
  run({ setInterval = globalThis.setInterval, setTimeout = globalThis.setTimeout } = {}) {
    const tick = () => this.refresh().catch(error => console.error('Headshot refresh failed:', error.message));
    setTimeout(tick, 15000).unref?.();
    setInterval(tick, 60 * 60 * 1000).unref?.();
  }
}
