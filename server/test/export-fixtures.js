// Writes the server's real responses for the test fixtures into ios/Tests/Fixtures, so the iOS tests
// decode exactly what the server sends. Run with: node test/export-fixtures.js
import { writeFileSync } from 'node:fs';
import { setup } from './setup.js';

const { aggregator, store } = setup();
const out = new URL('../../ios/Tests/Fixtures/', import.meta.url);
const write = (name, value) => writeFileSync(new URL(name, out), JSON.stringify(value, null, 2) + '\n');
write('scoreboard.json', await aggregator.scoreboard());
write('rooting.json', await aggregator.rooting({ includeBench: true }));
write('accounts.json', { ...store.publicAccounts(), yahooAvailable: true });
