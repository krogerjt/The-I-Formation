import { fakeFetch } from './fake-fetch.js';
import { allRoutes, yahooTokens } from './fixtures.js';
import { Aggregator } from '../src/aggregate.js';
import { PlayerIndex } from '../src/players.js';
import { Store } from '../src/store.js';
import { SleeperProvider } from '../src/providers/sleeper.js';
import { ESPNProvider } from '../src/providers/espn.js';
import { YahooProvider } from '../src/providers/yahoo.js';
import { NFLGames } from '../src/providers/nfl.js';
import { NFL_SUMMARY, NFLPlays } from '../src/providers/plays.js';
import { SLEEPER_API } from '../src/providers/sleeper.js';
import { LiveFeed } from '../src/live.js';
import { sleeper } from './fixtures.js';

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


// One live game (KC at BUF, id 401) whose play-by-play and Sleeper points change between polls.
export function liveSetup() {
  const state = { mahomes: 24.3, plays: [] };
  const matchups = structuredClone(sleeper[`${SLEEPER_API}/league/L1/matchups/10`]);
  const routes = {
    ...allRoutes,
    [`${SLEEPER_API}/league/L1/matchups/10`]: () => {
      matchups[0].players_points['4046'] = state.mahomes;
      return matchups;
    },
    [NFL_SUMMARY]: () => ({ drives: { previous: [{ plays: state.plays.slice(0, -1) }], current: { plays: state.plays.slice(-1) } } }),
  };
  const env = setup(routes);
  let time = Date.parse('2026-11-08T20:00:00Z');
  const now = () => time;
  env.aggregator.now = now;
  const feed = new LiveFeed({ aggregator: env.aggregator, plays: new NFLPlays({ fetch: env.fetch, now, ttl: 0 }), now });
  const advance = ms => { time += ms; };
  return { ...env, feed, state, advance, now };
}

