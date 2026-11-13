// Writes the server's real responses for the test fixtures into ios/Tests/Fixtures, so the iOS tests
// decode exactly what the server sends. Run with: node test/export-fixtures.js
import { writeFileSync } from 'node:fs';
import { liveSetup, setup } from './setup.js';

const { aggregator, store } = setup();
const out = new URL('../../ios/Tests/Fixtures/', import.meta.url);
const write = (name, value) => writeFileSync(new URL(name, out), JSON.stringify(value, null, 2) + '\n');
write('scoreboard.json', await aggregator.scoreboard());
write('rooting.json', await aggregator.rooting({ includeBench: true }));
write('accounts.json', { ...store.publicAccounts(), yahooAvailable: true });

// The Feed tab after one touchdown: the same JSON the Live Activity's slides are made of.
const live = liveSetup();
await live.feed.poll();
live.state.mahomes = 28.3;
live.state.plays = [{ id: '2', text: '(Shotgun) P.Mahomes pass short middle to T.Kelce for 25 yards, TOUCHDOWN.' }];
live.advance(31000);
await live.feed.poll();
live.feed.next();
write('feed.json', { ...live.feed.snapshot(), liveActivity: { push: true, auto: true, canAutoStart: true, active: true } });
