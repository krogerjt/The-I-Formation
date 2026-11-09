import { fakeFetch } from './fake-fetch.js';
import { allRoutes, yahooTokens } from './fixtures.js';
import { Aggregator } from '../src/aggregate.js';
import { PlayerIndex } from '../src/players.js';
import { Store } from '../src/store.js';
import { SleeperProvider } from '../src/providers/sleeper.js';
import { ESPNProvider } from '../src/providers/espn.js';
import { YahooProvider } from '../src/providers/yahoo.js';
import { NFLGames } from '../src/providers/nfl.js';

// Every provider wired to the fixtures, with Sleeper, one ESPN league and Yahoo connected.
const now = () => Date.parse('2026-11-08T20:00:00Z');
export function setup(routes = allRoutes) {
  const fetch = fakeFetch(routes);
  const players = new PlayerIndex({ fetch, now });
  const store = new Store();
  store.setSleeper('jake');
  store.setESPN([{ leagueId: '123', teamId: 1 }]);
  store.saveYahooTokens(yahooTokens);
  const yahoo = new YahooProvider({ fetch, clientId: 'id', clientSecret: 'secret', redirectUri: 'https://h/cb', now });
  const aggregator = new Aggregator({ sleeper: new SleeperProvider({ fetch, players }), espn: new ESPNProvider({ fetch }), yahoo, nfl: new NFLGames({ fetch }), players, store, now });
  return { aggregator, store, fetch, yahoo };
}

