# I Formation

I Formation (the code and server still use the working name Huddle) is one iPhone app for every fantasy football league you play in on Sleeper, ESPN and Yahoo. It shows:

- **Scores:** every matchup this week in one list, with live and projected points, who's yet to play, and a "winning 2 of 3" summary. Tap a league to see both lineups side by side.
- **Root For:** every player who matters to you this week across all leagues, grouped by NFL game. Each player gets a net score: the number of leagues where he's your starter minus the number where an opponent starts him. Green means root for him, red means root against, orange means you're torn.

Screens refresh every 60 seconds while NFL games are live.

## How it works

```
iPhone app  ──►  Huddle server  ──►  Sleeper (public API)
 (SwiftUI)       (Node, no deps)  ├─►  ESPN (unofficial v3 API, optional cookies)
                                  ├─►  Yahoo (official API, OAuth 2.0)
                                  └─►  ESPN NFL scoreboard (game times and live state)
```

The server keeps the secrets (the Yahoo client secret, ESPN cookies and Yahoo tokens) off the phone, so an ESPN API change can be fixed without rebuilding the app. Each platform has its own module in `server/src/providers/`. If one platform fails, the others still show, and the app names the one that failed.

To match the same player across platforms, the server uses Sleeper's player list, which includes ESPN and Yahoo IDs for most players. Players it can't match by ID are matched by name, position and team.

It's built for a single user. All requests need the server's `APP_TOKEN`. Account settings are stored in one file, encrypted with `STATE_KEY`.

**What has been checked:** all three providers are tested offline against responses in each platform's documented shape. The tests don't cover live data yet, because the sandbox these were written in couldn't reach the fantasy sites. The first real Sunday is the real test, especially for Yahoo's and ESPN's JSON.

## Run the server locally

Requires Node.js 22 or newer. There are no npm dependencies.

```sh
cd server
cp .env.example .env      # then fill in APP_TOKEN and STATE_KEY (openssl rand -hex 32 for each)
npm test
npm start                 # http://127.0.0.1:8787
```

Try it with `curl -H "Authorization: Bearer $APP_TOKEN" localhost:8787/v1/scoreboard` after adding an account:

```sh
curl -X PUT -H "Authorization: Bearer $APP_TOKEN" -H 'content-type: application/json' \
  -d '{"username":"your-sleeper-name"}' localhost:8787/v1/accounts/sleeper
```

### API

| Endpoint | What it does |
|---|---|
| `GET /v1/scoreboard?week=` | Every league's matchup for the week (default: the current NFL week) |
| `GET /v1/rooting?week=&bench=1` | The rooting guide; `bench=1` lists bench players too, without counting them |
| `GET /v1/accounts` | Connected accounts. Never returns cookies or tokens |
| `PUT /v1/accounts/sleeper` | `{"username": "..."}`, or an empty string to remove |
| `PUT /v1/accounts/espn` | `{"leagues": [{"leagueId", "teamId", "espnS2", "swid"}]}`. Leaving out both cookies keeps the saved ones |
| `POST /v1/yahoo/start` | Returns the Yahoo sign-in URL; the app opens it |
| `GET /v1/yahoo/callback` | Yahoo redirects here after sign-in, then back to the app at `huddle://` |
| `DELETE /v1/yahoo` | Forget the Yahoo tokens |

## Connect your accounts

- **Sleeper:** enter your username in the app. That's it.
- **ESPN:** open your team on fantasy.espn.com. The URL contains `leagueId=` and `teamId=`. Public leagues only need those two numbers. For a private league, also copy the `espn_s2` and `SWID` cookies from your browser's developer tools (Application or Storage → Cookies → espn.com). With the cookies, the team ID is optional.
- **Yahoo:** set up once on the server (below), then tap **Sign in with Yahoo** in the app.

### Set up Yahoo

1. Go to [developer.yahoo.com/apps/create](https://developer.yahoo.com/apps/create/). Create an app with **Fantasy Sports → Read** access. Set the redirect URI to your server's address plus `/v1/yahoo/callback` (for example `https://huddle-api.fly.dev/v1/yahoo/callback`). Yahoo requires https, so this has to be the hosted server.
2. Put the client ID and secret into the server's secrets as `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` and `YAHOO_REDIRECT_URI`.

## Host the server on Fly

As an alternative to your Mac, the repository includes a Fly.io config (`server/fly.toml`). The server does no background work, so the machine can sleep when idle.

1. Install `flyctl` and sign in. From `server/`, run `fly launch --no-deploy --copy-config` and accept or rename the app. If the name changes, update `app` in `fly.toml`.
2. Create the volume for account settings: `fly volumes create huddle_data --size 1`.
3. Set the secrets:
   ```sh
   fly secrets set APP_TOKEN=$(openssl rand -hex 32) STATE_KEY=$(openssl rand -hex 32) \
     YAHOO_CLIENT_ID=... YAHOO_CLIENT_SECRET=... YAHOO_REDIRECT_URI=https://<your-app>.fly.dev/v1/yahoo/callback
   ```
   Keep a copy of `APP_TOKEN`, because the app needs it. If you lose `STATE_KEY`, the saved accounts can't be decrypted and you'll have to enter them again.
4. Run `fly deploy`, then check `https://<your-app>.fly.dev/health`.

## Host the server on your Mac

If your Mac is always on, it can run the server instead of Fly. The server listens only on the Mac itself, and Tailscale makes it reachable from your iPhone over HTTPS without exposing it to the internet.

1. Install Node.js 22 or newer (`brew install node`) and [Tailscale](https://tailscale.com/download) on the Mac, and Tailscale on your iPhone, signed in to the same account.
2. Clone this repository on the Mac. From its root, run `sh server/mac/install.sh`. The first run creates `server/.env` with a new `APP_TOKEN` and `STATE_KEY` and port 8788, so it doesn't clash with Sideout on 8787. Then it installs a LaunchAgent that starts the server at login and restarts it if it stops. Logs go to `~/Library/Logs/Huddle/server.log`. Run the script again after pulling new code; `sh server/mac/install.sh uninstall` removes it.
3. Give it an HTTPS address on your tailnet: `tailscale serve --bg --https=8443 http://127.0.0.1:8788`. Port 8443 leaves 443 free for anything else you serve, such as Sideout. Your address is `https://<mac-name>.<tailnet>.ts.net:8443`; `tailscale serve status` shows it.
   - **Or make it public** so the phone doesn't need Tailscale: `tailscale funnel --bg --https=8443 http://127.0.0.1:8788` (Funnel allows ports 443, 8443 and 10000). Anyone can then reach the server, but every request except `/health` needs `APP_TOKEN`. Use this if you already run Funnel on the same Mac (as Sideout does): Funnel publishes the hostname in public DNS, so a phone that isn't on Tailscale reaches Tailscale's public relay and gets a TLS error on a port that is only served to the tailnet. `tailscale funnel status` shows what's public; `tailscale funnel --https=8443 off` turns it off.
4. Use that address as `HUDDLE_SERVER_URL` and the `APP_TOKEN` from `server/.env` as `HUDDLE_APP_TOKEN` when building the app.
5. For Yahoo, set `YAHOO_REDIRECT_URI` in `server/.env` to that address plus `/v1/yahoo/callback`, use the same URI in the Yahoo app settings, and run the install script again. Yahoo only redirects your phone's browser there, so it works without making the server public.

## Build the iPhone app on a Mac

1. Install Xcode (iOS 17 SDK or newer) and XcodeGen: `brew install xcodegen`.
2. Create `ios/Local.xcconfig`. It's git-ignored, so the address and token stay out of the repository:
   ```
   HUDDLE_SERVER_URL = https:/$()/huddle-api.fly.dev
   HUDDLE_APP_TOKEN = <the APP_TOKEN you set on the server>
   ```
   Write `https:/$()/` instead of `https://`, because `//` starts a comment in xcconfig files. To use a server on your Mac from the simulator, use `http:/$()/localhost:8787`.
3. Run `xcodegen generate` in the repository root, then open `Huddle.xcodeproj`.
4. Select the **Huddle** scheme and your iPhone, then build and run. The bundle ID (`com.krogerjt.huddle`) and team are set in `project.yml`.

### Build and sideload with agent-team

Builds can run on the Mac over SSH with [agent-team](https://github.com/krogerjt/agent-team)'s iOS tools (Hollis), the same way as Sideout. `ios/Local.xcconfig` is git-ignored, so it never reaches the Mac. Pass the values in instead:

1. Store the server address and app token as secrets in the Agent Team Build Keychain (**Options → Mac Build Host → secrets**). Map them to `HUDDLE_SERVER_URL` and `HUDDLE_APP_TOKEN`.
2. Set this repository's preparation command to `sh ios/write-local-xcconfig.sh`.
3. Use `npm run ios -- discover|readiness|build-simulator|test-simulator --repo <path>`. To install on your phone or upload to TestFlight, follow agent-team's README (`grant signing`, then ask Hollis).

## Layout

```
project.yml                 XcodeGen spec (app + unit tests)
ios/App                     SwiftUI screens, API client, state
ios/Shared/Models.swift     Codable models matching the server's JSON
ios/Tests                   Decodes fixtures produced by the real server
server/src/providers        sleeper.js, espn.js, yahoo.js, nfl.js
server/src/aggregate.js     Scoreboard and rooting guide
server/src/players.js       Cross-platform player matching
server/test                 Offline tests; export-fixtures.js regenerates ios/Tests/Fixtures
```

## Known gaps

- ESPN and Yahoo haven't been tried against live leagues yet.
- Sleeper's public API has no projections, so Sleeper matchups show live points only.
- ESPN playoff matchups that span two weeks use the matchup period with the same number as the NFL week.
- The Yahoo `nfl` game key always means the current season, so past seasons only work for Sleeper and ESPN.
