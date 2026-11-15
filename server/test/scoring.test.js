import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCORING, espnScoring, pointsFor, sleeperScoring, yahooScoring } from '../src/scoring.js';
import { NFLPlays, statsFor } from '../src/providers/plays.js';
import { liveSetup } from './setup.js';

test('each platform\'s scoring rules read into one shape', () => {
  const sleeper = sleeperScoring({ pass_yd: 0.04, pass_td: 6, rec: 1, rec_yd: 0.1, rush_yd: 0.1, xpm: 1, fgm_40_49: 4, fgm_50p: 5, fgm_30_39: 3 });
  assert.equal(sleeper.passTd, 6);
  assert.equal(sleeper.rec, 1);
  assert.equal(pointsFor({ fg: 52 }, sleeper), 5);
  assert.equal(pointsFor({ fg: 44 }, sleeper), 4);

  const espn = espnScoring([{ statId: 3, points: 0.04 }, { statId: 4, points: 4 }, { statId: 53, points: 1 }, { statId: 42, points: 0.1 }, { statId: 1, points: 0.2 }]);
  assert.equal(espn.rec, 1);
  assert.equal(espn.passCmp, 0.2, 'some leagues pay for each completion');
  assert.equal(espn.rushYd, DEFAULT_SCORING.rushYd, 'missing items keep the default');

  const yahoo = yahooScoring([{ stat: { stat_id: '4', value: '0.04' } }, { stat: { stat_id: '11', value: '0.5' } }, { stat: { stat_id: '16', value: '2' } }]);
  assert.equal(yahoo.rec, 0.5);
  assert.equal(yahoo.rec2pt, 2);

  for (const parse of [sleeperScoring, espnScoring, yahooScoring]) assert.equal(parse(null), null);
});

test('a play\'s stat line, from real plays', () => {
  assert.deepEqual(statsFor('(Shotgun) M.Penix scrambles left end to KC 16 for 16 yards (M.Delane).', 'Michael Penix Jr.'), { rushYd: 16, rushTd: 0 });
  assert.deepEqual(statsFor(' (No Huddle, Shotgun) M.Penix pass short middle to B.Robinson to KC 20 for -4 yards (A.Gillotte).', 'Michael Penix Jr.'), { passCmp: 1, passYd: -4, passTd: 0 });
  const td = '(Shotgun) J.Daniels pass short middle to B.Sinnott for 1 yard, TOUCHDOWN [A.Carter]. D.Stevens extra point is GOOD, Center-T.Ott, Holder-T.Way.';
  assert.deepEqual(statsFor(td, 'Ben Sinnott'), { rec: 1, recYd: 1, recTd: 1 });
  assert.deepEqual(statsFor(td, 'Dalton Stevens'), { pat: 1 });
  assert.deepEqual(statsFor('D.Stevens 46 yard field goal is GOOD, Center-T.Ott, Holder-T.Way.', 'Dalton Stevens'), { fg: 46 });
  assert.equal(pointsFor(statsFor(td, 'Ben Sinnott')), 6.6); // half PPR
});

// Today's CAR at NO: Hubbard ran for 1 yard, then caught a pass for -1 yards before his points moved.
const hubbard = [
  { id: '1', text: '(Shotgun) C.Hubbard right guard to 50 for 1 yard (K.Elliss; C.Wooden).' },
  { id: '2', text: '(Shotgun) B.Young pass short right to C.Hubbard to CAR 49 for -1 yards (K.Elliss).' },
];
const playsOf = list => new NFLPlays({ fetch: async () => new Response(JSON.stringify({ drives: { current: { plays: list } } })), ttl: 0 });

test('the play whose points fit the change gets them', async () => {
  const plays = playsOf(hubbard);
  assert.equal((await plays.latestFor('g', 'Chuba Hubbard')).id, '2', 'without the points, the latest play');
  assert.equal((await plays.latestFor('g', 'Chuba Hubbard', null, { points: 0.1 })).id, '1', '+0.1 is the run');
  assert.equal((await plays.latestFor('g', 'Chuba Hubbard', null, { points: 0.4 })).id, '2', '+0.4 is the catch, half PPR');
  const fullPPR = sleeperScoring({ rec: 1, rec_yd: 0.1, rush_yd: 0.1 });
  assert.equal((await plays.latestFor('g', 'Chuba Hubbard', null, { points: 0.9, scoring: fullPPR })).id, '2');
  // A play already shown in full is out; one shown in part can take the rest.
  assert.equal((await plays.latestFor('g', 'Chuba Hubbard', null, { points: 0.4, credited: new Map([['2', 0.4]]) })).id, '1');
});

test('the first piece of a touchdown\'s points goes to the touchdown', async () => {
  const plays = playsOf([
    { id: '1', text: 'C.Ward pass short left to T.Pollard pushed ob at JAX 37 for 11 yards (T.Hunter).' },
    { id: '2', text: 'C.Ward pass deep left to T.Pollard for 32 yards, TOUCHDOWN. J.Slye extra point is GOOD, Center-M.Cox, Holder-J.Stonehouse.' },
  ]);
  assert.equal((await plays.latestFor('g', 'Tony Pollard', null, { points: 0.5, credited: new Map([['1', 1.6]]) })).id, '2');
});

test('the feed matches plays against the scoring of the league whose points moved', async () => {
  const { feed, state, advance, aggregator } = liveSetup();
  aggregator.scoring.set('sleeper:L1', sleeperScoring({ pass_yd: 0.04, pass_td: 4, pass_cmp: 1, rush_yd: 0.1 }));
  await feed.poll();
  state.plays = [
    { id: '1', text: 'P.Mahomes scrambles right end to BUF 30 for 8 yards (M.Milano).' },
    { id: '2', text: '(Shotgun) P.Mahomes pass short middle to T.Kelce to BUF 22 for 8 yards (T.Bernard).' },
  ];
  state.mahomes = 25.62;           // +1.32: a completion worth a point, plus 8 yards passing
  advance(31000);
  await feed.poll();
  assert.equal(feed.events[0].playId, '2');
  state.plays.push({ id: '3', text: '(Shotgun) P.Mahomes pass incomplete short left to X.Worthy.' });
  state.mahomes = 26.42;           // +0.8: the scramble, posted late
  advance(31000);
  await feed.poll();
  assert.equal(feed.events[0].playId, '1');
  assert.equal(feed.events[0].text, 'P. Mahomes ran for 8 yards');
});

test('the server keeps each league\'s scoring for itself, out of the app\'s scoreboard', async () => {
  const { allRoutes } = await import('./fixtures.js');
  const { setup } = await import('./setup.js');
  const { SLEEPER_API } = await import('../src/providers/sleeper.js');
  const { aggregator } = setup({ ...allRoutes, [`${SLEEPER_API}/user/u1/leagues/nfl/2026`]: [{ league_id: 'L1', name: 'Dynasty Bros', scoring_settings: { rec: 1, pass_td: 6 } }] });
  const board = await aggregator.scoreboard();
  assert.equal(aggregator.scoringFor('sleeper:L1').rec, 1);
  assert.equal(aggregator.scoringFor('sleeper:L1').passTd, 6);
  assert.ok(board.matchups.every(m => !('scoring' in m)));
});
