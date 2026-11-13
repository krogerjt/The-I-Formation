import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { liveSetup } from './setup.js';
import { createApp } from '../src/server.js';
import { describePlay, namePattern, shortName } from '../src/providers/plays.js';
import { APNs } from '../src/apns.js';
import { LiveActivityDriver, ATTRIBUTES_TYPE } from '../src/live-activity.js';
import { Store } from '../src/store.js';

test('plays are described from the fantasy player\'s point of view', () => {
  assert.equal(shortName('Malik Nabers'), 'M. Nabers');
  assert.equal(shortName('Amon-Ra St. Brown'), 'A. St. Brown');
  assert.equal(shortName('Marvin Harrison Jr.'), 'M. Harrison');
  assert.ok(namePattern('Amon-Ra St. Brown').test('J.Goff pass short right to A.St. Brown for 9 yards'));
  assert.ok(!namePattern('Malik Nabers').test('M.Nabors up the middle for 2 yards'));

  const catchTD = '(Shotgun) J.Dart pass deep left to M.Nabers for 20 yards, TOUCHDOWN.';
  assert.equal(describePlay(catchTD, 'Malik Nabers'), 'M. Nabers caught pass for 20 yards, touchdown');
  assert.equal(describePlay(catchTD, 'Jaxson Dart'), 'J. Dart threw 20-yard touchdown pass');
  assert.equal(describePlay('J.Dart pass short middle to M.Nabers to NYG 45 for 12 yards (D.Smith).', 'Malik Nabers'), 'M. Nabers caught pass for 12 yards');
  assert.equal(describePlay('J.Dart pass short middle to M.Nabers for 12 yards (D.Smith).', 'Jaxson Dart'), 'J. Dart completed pass for 12 yards');
  assert.equal(describePlay('(No Huddle) B.Robinson up the middle to ATL 41 for 1 yard (T.Edmunds).', 'Bijan Robinson'), 'B. Robinson ran for 1 yard');
  assert.equal(describePlay('S.Barkley right end for 34 yards, TOUCHDOWN.', 'Saquon Barkley'), 'S. Barkley ran for 34 yards, touchdown');
  assert.equal(describePlay('B.Aubrey 52 yard field goal is GOOD, Center-T.Sieg, Holder-B.Anger.', 'Brandon Aubrey'), 'B. Aubrey made 52-yard field goal');
  assert.equal(describePlay('B.Aubrey extra point is GOOD, Center-T.Sieg.', 'Brandon Aubrey'), 'B. Aubrey made extra point');
  assert.match(describePlay('Something unusual happened involving many words '.repeat(4), 'Joe Smith'), /…$/);
});

test('the feed turns point changes into plays and queues touchdowns', async () => {
  const { feed, state, advance } = liveSetup();
  await feed.poll();
  assert.deepEqual(feed.events, [], 'the first poll is only a baseline');

  state.mahomes = 28.3;
  state.plays = [
    { id: '1', text: 'J.Allen pass short left to K.Shakir for 8 yards.' },
    { id: '2', text: '(Shotgun) P.Mahomes pass short middle to T.Kelce for 25 yards, TOUCHDOWN.', type: { text: 'Passing Touchdown' } },
  ];
  advance(31000);
  await feed.poll();
  assert.equal(feed.events.length, 1);
  const [event] = feed.events;
  assert.equal(event.kind, 'touchdown');
  assert.equal(event.text, 'P. Mahomes threw 25-yard touchdown pass');
  assert.equal(event.points, 4);
  assert.deepEqual(event.leagues.map(l => l.leagueName), ['Dynasty Bros']); // only Sleeper's points moved

  // Rotation: the touchdown jumps the queue, then play / league 1 / play / league 2 / play / league 3 / play / league 1.
  const kinds = Array.from({ length: 8 }, () => feed.next()).map(s => s.kind === 'score' ? s.leagueName : s.kind);
  assert.deepEqual(kinds, ['touchdown', 'play', 'Dynasty Bros', 'play', 'Work League', 'play', 'Family League', 'play']);

  // The same touchdown isn't announced twice; a later non-scoring gain is just a play.
  state.mahomes = 29.1;
  state.plays.push({ id: '3', text: 'P.Mahomes scrambles right end to BUF 30 for 8 yards (M.Milano).' });
  advance(31000);
  await feed.poll();
  assert.equal(feed.events[0].kind, 'play');
  assert.equal(feed.events[0].text, 'P. Mahomes ran for 8 yards');
  assert.equal(feed.pendingTouchdowns.length, 0);
});

test('score slides keep my team first, and the feed knows when my games are on', async () => {
  const { feed } = liveSetup();
  await feed.poll();
  assert.deepEqual(feed.scores()[1], {
    kind: 'score', platform: 'espn', leagueName: 'Work League', myTeam: 'Allen Wrench', myScore: 30.1,
    opponentTeam: 'Team Boss', opponentScore: 55.4, leading: 'opponent', winChance: null,
  });
  assert.equal(feed.gameWindow(), 'live');
  assert.equal(feed.next().kind, 'score', 'with no plays yet it shows scores');
});

test('APNs tokens are ES256-signed and pushes use the Live Activity topic', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const sent = [];
  const apns = new APNs({ keyId: 'KEY123', teamId: 'TEAM', key: privateKey.export({ type: 'pkcs8', format: 'pem' }), bundleId: 'com.krogerjt.huddle',
    transport: async (path, headers, body) => { sent.push({ path, headers, body: JSON.parse(body) }); return { status: 200, body: '' }; } });
  assert.ok(apns.configured);
  const [h, c, s] = apns.jwt().split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY123' });
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, 'TEAM');
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')));
  const result = await apns.send('abcd', { aps: {} });
  assert.ok(result.ok);
  assert.equal(sent[0].path, '/3/device/abcd');
  assert.equal(sent[0].headers['apns-topic'], 'com.krogerjt.huddle.push-type.liveactivity');
  assert.equal(sent[0].headers['apns-push-type'], 'liveactivity');
  assert.equal(new APNs({}).configured, false);
});

test('the driver starts, rotates and ends the Live Activity around my games', async () => {
  const { feed, store, advance, now } = liveSetup();
  const sent = [];
  const apns = { configured: true, send: async (token, payload) => { sent.push({ token, aps: payload.aps }); return { ok: true, status: 200 }; } };
  const driver = new LiveActivityDriver({ feed, apns, store, now, log: { warn() {}, error() {} } });

  await driver.tick();
  assert.equal(sent.length, 0, 'nothing to start without a push-to-start token');
  driver.saveTokens({ pushToStart: 'aa'.repeat(32) });
  advance(30000);
  await driver.tick();
  assert.equal(sent.at(-1).aps.event, 'start');
  assert.equal(sent.at(-1).aps['attributes-type'], ATTRIBUTES_TYPE);
  assert.deepEqual(sent.at(-1).aps.attributes, { week: 10 });

  // The phone reports the started activity's token; from then on each tick pushes the next slide.
  driver.saveTokens({ activityId: 'A1', activityToken: 'bb'.repeat(32) });
  assert.equal(driver.status().active, true);
  advance(30000);
  await driver.tick();
  assert.equal(sent.at(-1).aps.event, 'update');
  assert.equal(sent.at(-1).token, 'bb'.repeat(32));
  const first = sent.at(-1).aps['content-state'].leagueName;
  advance(30000);
  await driver.tick();
  assert.notEqual(sent.at(-1).aps['content-state'].leagueName, first, 'each push moves to the next league');

  // Past iOS's 8-hour limit it ends this one and starts a fresh one.
  advance(8 * 60 * 60 * 1000);
  await driver.tick();
  assert.deepEqual(sent.slice(-2).map(s => s.aps.event), ['end', 'start']);

  // Dismissing it on the phone stops the pushes.
  driver.saveTokens({ activityId: 'A2', activityToken: 'cc'.repeat(32) });
  driver.saveTokens({ ended: 'A2' });
  assert.equal(store.live().activity, null);

  driver.setAuto(false);
  const count = sent.length;
  advance(30000);
  await driver.tick();
  assert.equal(sent.length, count, 'auto start off');
});

test('the driver forgets a token Apple says is dead', async () => {
  const { feed, store, now } = liveSetup();
  const apns = { configured: true, send: async () => ({ ok: false, status: 410, reason: 'Unregistered', gone: true }) };
  const driver = new LiveActivityDriver({ feed, apns, store, now, log: { warn() {}, error() {} } });
  driver.saveTokens({ activityId: 'A1', activityToken: 'bb'.repeat(32) });
  await driver.tick();
  assert.equal(store.live().activity, null);
});

test('live tokens are stored without invalidating the scoreboard cache', () => {
  const store = new Store();
  const version = store.version;
  store.setLive({ pushToStart: 'ab' });
  assert.equal(store.version, version);
  assert.equal(store.live().auto, true);
  assert.equal(JSON.stringify(store.publicAccounts()).includes('ab"'), false);
});


test('feed and Live Activity endpoints', async t => {
  const { aggregator, store, yahoo, feed, now } = liveSetup();
  const live = new LiveActivityDriver({ feed, apns: { configured: false }, store, now });
  const app = createApp({ aggregator, store, yahoo, feed, live, appToken: 'test-token-0123456789abcdef' });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const call = (path, method = 'GET', body) => fetch(`http://127.0.0.1:${app.address().port}${path}`, {
    method, headers: { authorization: 'Bearer test-token-0123456789abcdef', 'content-type': 'application/json' }, body: body && JSON.stringify(body),
  });
  const snapshot = await (await call('/v1/feed')).json();
  assert.equal(snapshot.scores.length, 3);
  assert.deepEqual(snapshot.liveActivity, { push: false, auto: true, canAutoStart: false, active: false });
  assert.equal((await call('/v1/live/tokens', 'PUT', { pushToStart: 'not hex!' })).status, 400);
  assert.equal((await call('/v1/live/tokens', 'PUT', { activityId: 'A1' })).status, 400);
  const status = await (await call('/v1/live/tokens', 'PUT', { pushToStart: 'ab'.repeat(32), activityId: 'A1', activityToken: 'cd'.repeat(32) })).json();
  assert.equal(status.canAutoStart, true);
  assert.equal(status.active, true);
  assert.equal((await (await call('/v1/live/settings', 'PUT', { auto: false })).json()).auto, false);
  assert.equal((await call('/v1/live/settings', 'PUT', { auto: 'yes' })).status, 400);
  assert.equal((await fetch(`http://127.0.0.1:${app.address().port}/v1/feed`)).status, 401);
});
