import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allRoutes } from './fixtures.js';
import { fakeFetch } from './fake-fetch.js';
import { setup } from './setup.js';
import { ESPN_HEADSHOT, Headshots, SLEEPER_HEADSHOT } from '../src/headshots.js';

const image = (type, bytes = 'img') => () => new Response(Buffer.from(bytes), { status: 200, headers: { 'content-type': type } });
const DAY = 24 * 60 * 60 * 1000;

function headshotSetup({ routes = {}, dir = null } = {}) {
  const env = setup({
    ...allRoutes,
    [`${SLEEPER_HEADSHOT}4046.jpg`]: image('image/jpeg', 'mahomes'),
    [`${SLEEPER_HEADSHOT}6786.jpg`]: image('image/jpeg', 'lamb'),
    // No Sleeper picture for Bijan Robinson: ESPN's is the fallback.
    [`${ESPN_HEADSHOT}4430807.png`]: image('image/png', 'bijan'),
    ...routes,
  });
  let time = Date.parse('2026-11-08T20:00:00Z');
  const headshots = new Headshots({ dir, aggregator: env.aggregator, players: env.aggregator.players, fetch: env.fetch, now: () => time });
  return { ...env, headshots, advance: ms => { time += ms; } };
}

test('stores a headshot for every player on my rosters, bench included, from Sleeper then ESPN', async () => {
  const { headshots, fetch } = headshotSetup();
  await headshots.refresh();
  const byId = Object.fromEntries(headshots.list().players.map(p => [p.id, p]));
  assert.equal(byId['4046'].name, 'Patrick Mahomes');
  assert.equal(headshots.image('4046').data.toString(), 'mahomes');
  assert.equal(headshots.image('9509').type, 'image/png'); // bench, ESPN's picture
  assert.equal(headshots.image('9509').data.toString(), 'bijan');
  assert.equal(headshots.image('4984'), null); // Josh Allen (my ESPN QB) has no picture anywhere: not listed
  assert.ok(!byId['4984']);
  // Opponents' players and team defenses aren't fetched.
  assert.ok(!fetch.calls.some(c => /KC\.jpg|-16012/.test(c.url)));
  assert.equal(headshots.image('../state.bin'), null);
});

test('refreshes once a day, retries misses after a few days and drops players gone for two weeks', async () => {
  const { headshots, fetch, advance, store } = headshotSetup();
  await headshots.refresh();
  const calls = () => fetch.calls.filter(c => c.url.includes('headshots') || c.url.includes('sleepercdn')).length;
  const first = calls();
  advance(60 * 60 * 1000);
  await headshots.refresh();
  assert.equal(calls(), first, 'no new pass within a day');
  advance(DAY);
  await headshots.refresh();
  assert.equal(calls(), first, 'pictures on file and recent misses are not fetched again');
  advance(3 * DAY);
  await headshots.refresh();
  assert.ok(calls() > first, 'a missing picture is tried again');

  // Leaving only Sleeper connected: the ESPN-only player (Josh Allen) ages out; Sleeper's stay.
  store.setESPN([]); store.saveYahooTokens(null);
  advance(15 * DAY);
  await headshots.refresh();
  assert.ok(headshots.index['4046']);
  assert.ok(!headshots.index['4984']);
});

test('keeps headshots on disk across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'headshots-'));
  const { headshots, aggregator } = headshotSetup({ dir });
  await headshots.refresh();
  assert.ok(readdirSync(dir).includes('4046.jpg'));
  const again = new Headshots({ dir, aggregator, players: aggregator.players, fetch: fakeFetch({}) });
  assert.equal(again.image('4046').data.toString(), 'mahomes');
  assert.equal(again.list().players.length, headshots.list().players.length);
});

test('ignores responses that aren\'t images', async () => {
  const { headshots } = headshotSetup({ routes: { [`${SLEEPER_HEADSHOT}4046.jpg`]: { not: 'an image' } } });
  await headshots.refresh();
  assert.equal(headshots.image('4046'), null);
});
