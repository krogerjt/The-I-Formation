import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRoutes } from './fixtures.js';
import { matchResult, seasonFor, teamFandom } from '../src/aggregate.js';
import { setup } from './setup.js';

test('scoreboard has one matchup per league across all three platforms', async () => {
  const { aggregator } = setup();
  const board = await aggregator.scoreboard();
  assert.equal(board.week, 10);
  assert.deepEqual(board.errors, []);
  assert.deepEqual(board.matchups.map(m => [m.platform, m.leagueName, m.result.leading]), [
    ['sleeper', 'Dynasty Bros', 'me'], ['espn', 'Work League', 'opponent'], ['yahoo', 'Family League', 'me'],
  ]);
  const espn = board.matchups[1];
  assert.equal(espn.result.margin, -25.3);
  assert.equal(espn.result.status, 'live');
  assert.equal(espn.result.theirPlayersLeft, 1); // Lamb's game hasn't kicked off
});

test('one broken platform doesn\'t hide the others', async () => {
  const routes = { ...allRoutes };
  for (const key of Object.keys(routes)) if (key.includes('fantasysports')) delete routes[key];
  const board = await setup(routes).aggregator.scoreboard();
  assert.deepEqual(board.matchups.map(m => m.platform), ['sleeper', 'espn']);
  assert.equal(board.errors.length, 1);
  assert.equal(board.errors[0].platform, 'yahoo');
});

test('rooting guide adds up starters across leagues and groups them by NFL game', async () => {
  const guide = await setup().aggregator.rooting();
  assert.deepEqual(guide.groups.map(g => g.game?.name ?? null), ['KC at BUF', 'ATL at DAL']);
  const flat = Object.fromEntries(guide.groups.flatMap(g => g.players).map(p => [p.name, [p.rootFor, p.rootAgainst, p.net, p.verdict]]));
  assert.deepEqual(flat, {
    'Patrick Mahomes': [2, 1, 1, 'for'],         // my starter on Sleeper and Yahoo, my ESPN opponent's
    'Josh Allen': [1, 1, 0, 'conflicted'],        // mine on ESPN, my Sleeper opponent's; benched on Yahoo
    'Chiefs D/ST': [0, 1, -1, 'against'],
    'CeeDee Lamb': [1, 1, 0, 'conflicted'],
    'Bijan Robinson': [0, 1, -1, 'against'],      // benched on Sleeper and ESPN, started against me on Yahoo
  });
  assert.equal(guide.groups[0].players[0].name, 'Patrick Mahomes');
  assert.deepEqual(guide.summary, { rootFor: 1, rootAgainst: 2, conflicted: 2 });
});

test('rooting guide can list bench players without counting them', async () => {
  const guide = await setup().aggregator.rooting({ includeBench: true });
  const bijan = guide.groups.flatMap(g => g.players).find(p => p.name === 'Bijan Robinson');
  assert.equal(bijan.leagues.length, 3);
  assert.equal(bijan.net, -1);
});

test('results are cached briefly, and changing an account clears the cache', async () => {
  const { aggregator, store, fetch } = setup();
  await aggregator.scoreboard();
  const count = fetch.calls.length;
  await aggregator.scoreboard();
  assert.equal(fetch.calls.length, count);
  store.setESPN([]);
  const board = await aggregator.scoreboard();
  assert.ok(fetch.calls.length > count);
  assert.equal(board.matchups.length, 2);
});

test('match status is final only when every starter has played', () => {
  const m = { me: { points: 10, players: [{ starter: true, gameId: 'a' }] }, opponent: { points: 10, players: [{ starter: true, gameId: 'b' }] } };
  assert.equal(matchResult(m, [{ id: 'a', state: 'final' }, { id: 'b', state: 'final' }]).status, 'final');
  assert.equal(matchResult(m, [{ id: 'a', state: 'final' }, { id: 'b', state: 'scheduled' }]).status, 'live');
  assert.equal(matchResult({ me: m.me, opponent: null }, []).status, 'bye');
  assert.equal(matchResult(m, []).leading, 'tied');
});

test('season rolls over in March', () => {
  assert.equal(seasonFor(new Date('2027-01-10')), 2026);
  assert.equal(seasonFor(new Date('2026-09-10')), 2026);
});

test('scoreboard names the team I most want to win and the one I most want to lose', async () => {
  const board = await setup().aggregator.scoreboard();
  // Fixture: Mahomes is mine twice and theirs once, Chiefs D/ST theirs once, so KC nets out to zero.
  assert.equal(board.fandom.fanOf, null);
  assert.equal(board.fandom.against.team, 'ATL');
  assert.equal(board.fandom.against.name, 'Atlanta Falcons');
  assert.deepEqual(board.fandom.against.theirPlayers, ['Bijan Robinson']);
  const kc = board.fandom.teams.find(t => t.team === 'KC');
  assert.deepEqual([kc.rootFor, kc.rootAgainst, kc.net], [2, 2, 0]);
});

test('team fandom ranks by net starters, ignores bench players, and breaks ties by how many are mine', () => {
  const p = (name, nflTeam, starter = true) => ({ name, nflTeam, starter });
  const league = (mine, theirs) => ({ me: { players: mine }, opponent: { players: theirs } });
  const { fanOf, against } = teamFandom([
    league([p('Jordan Love', 'GB'), p('Josh Jacobs', 'GB'), p('Puka Nacua', 'LAR'), p('Davante Adams', 'LAR')], [p('Caleb Williams', 'CHI'), p('DJ Moore', 'CHI'), p('Rome Odunze', 'CHI', false)]),
    league([p('Jordan Love', 'GB'), p('Tucker Kraft', 'GB')], [p('Caleb Williams', 'CHI'), p('Jayden Reed', 'GB')]),
  ]);
  assert.equal(fanOf.name, 'Green Bay Packers');
  assert.deepEqual([fanOf.rootFor, fanOf.rootAgainst, fanOf.net], [4, 1, 3]);
  assert.deepEqual(fanOf.myPlayers, ['Jordan Love', 'Josh Jacobs', 'Tucker Kraft']);
  assert.equal(against.name, 'Chicago Bears');
  assert.deepEqual([against.rootAgainst, against.net], [3, -3]);
  assert.deepEqual(against.theirPlayers, ['Caleb Williams', 'DJ Moore']);
});
