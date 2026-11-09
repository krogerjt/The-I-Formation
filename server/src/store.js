import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Single-user account settings (Sleeper username, ESPN leagues and cookies, Yahoo tokens), kept in one
// JSON file encrypted with AES-256-GCM under STATE_KEY. With no path it lives in memory (tests).
export class Store {
  constructor({ path = null, key = null } = {}) {
    this.path = path;
    this.key = key ? createHash('sha256').update(key).digest() : null;
    if (path && !this.key) throw new Error('Set STATE_KEY to encrypt stored account credentials.');
    this.version = 0;
    this.state = this.read();
  }

  read() {
    const empty = { sleeper: null, espn: [], yahoo: null };
    if (!this.path) return empty;
    let raw;
    try { raw = readFileSync(this.path); } catch (error) { if (error.code === 'ENOENT') return empty; throw error; }
    const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), data = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return { ...empty, ...JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')) };
  }

  write() {
    this.version++;
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(this.state), 'utf8'), cipher.final()]);
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, Buffer.concat([iv, cipher.getAuthTag(), data]), { mode: 0o600 });
    renameSync(temp, this.path);
  }

  accounts() { return this.state; }

  // What the app may see: no cookies or tokens, only whether they are set.
  publicAccounts() {
    const { sleeper, espn, yahoo } = this.state;
    return {
      sleeper: sleeper ? { username: sleeper.username } : null,
      espn: espn.map(({ leagueId, teamId, espnS2, swid }) => ({ leagueId, teamId: teamId ?? null, hasCookies: Boolean(espnS2 && swid) })),
      yahoo: { connected: Boolean(yahoo?.tokens?.refreshToken) },
    };
  }

  setSleeper(username) { this.state.sleeper = username ? { username } : null; this.write(); }

  // Replaces the ESPN league list. A league sent without cookies keeps the ones already stored for it.
  setESPN(leagues) {
    const previous = new Map(this.state.espn.map(l => [l.leagueId, l]));
    this.state.espn = leagues.map(l => {
      const old = previous.get(l.leagueId);
      const keep = l.espnS2 === undefined && l.swid === undefined && old;
      return { leagueId: l.leagueId, teamId: l.teamId ?? null, espnS2: keep ? old.espnS2 : l.espnS2 || null, swid: keep ? old.swid : l.swid || null };
    });
    this.write();
  }

  saveYahooTokens(tokens) { this.state.yahoo = tokens ? { tokens } : null; this.write(); }
}
