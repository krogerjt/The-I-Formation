#!/bin/sh
# Writes the git-ignored ios/Local.xcconfig from $HUDDLE_SERVER_URL and $HUDDLE_APP_TOKEN, for build
# machines (such as agent-team's Mac Build Host) that receive them as environment variables.
set -eu
: "${HUDDLE_SERVER_URL:?Set HUDDLE_SERVER_URL to the https:// address of the server.}"
: "${HUDDLE_APP_TOKEN:?Set HUDDLE_APP_TOKEN to the server's APP_TOKEN.}"
case "$HUDDLE_SERVER_URL" in https://*|http://*) ;; *) echo "HUDDLE_SERVER_URL must start with https://" >&2; exit 1 ;; esac
# xcconfig files treat // as a comment, so write :/$()/ instead.
{
  printf 'HUDDLE_SERVER_URL = %s\n' "$(printf '%s' "$HUDDLE_SERVER_URL" | sed 's#://#:/$()/#')"
  printf 'HUDDLE_APP_TOKEN = %s\n' "$HUDDLE_APP_TOKEN"
} > "$(dirname "$0")/Local.xcconfig"
