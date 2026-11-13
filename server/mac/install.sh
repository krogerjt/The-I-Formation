#!/bin/sh
# Runs the Huddle server on this Mac as a LaunchAgent: it starts at login, restarts if it crashes, and
# listens only on 127.0.0.1. Expose it to your iPhone with Tailscale Serve (see the README).
#
#   sh server/mac/install.sh            install or update, then (re)start
#   sh server/mac/install.sh uninstall  stop and remove
set -eu

LABEL=com.krogerjt.huddle-server
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SERVER_DIR=$(cd "$(dirname "$0")/.." && pwd)
LOG_DIR="$HOME/Library/Logs/Huddle"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = uninstall ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Removed $LABEL. Your settings in $SERVER_DIR/data and .env are untouched."
  exit 0
fi

# SSH sessions don't load the login PATH, so also look where Node is commonly installed by hand.
NODE=$(command -v node || true)
for candidate in "$HOME/.local/node/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -n "$NODE" ] && break
  [ -x "$candidate" ] && NODE=$candidate
done
[ -n "$NODE" ] || { echo "Install Node.js 22 or newer first (brew install node)." >&2; exit 1; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 22 ] || { echo "Node.js $MAJOR is too old; Huddle needs 22 or newer." >&2; exit 1; }

ENV_FILE="$SERVER_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  # First install: make the two secrets and keep the server off Sideout's port (8787).
  umask 077
  sed -e "s/^APP_TOKEN=.*/APP_TOKEN=$(openssl rand -hex 32)/" \
      -e "s/^STATE_KEY=.*/STATE_KEY=$(openssl rand -hex 32)/" \
      -e "s/^PORT=.*/PORT=8788/" \
      "$SERVER_DIR/.env.example" > "$ENV_FILE"
  echo "Created $ENV_FILE with a new APP_TOKEN and STATE_KEY."
fi
grep -q '^APP_TOKEN=.\{24,\}' "$ENV_FILE" || { echo "Set APP_TOKEN in $ENV_FILE (openssl rand -hex 32)." >&2; exit 1; }
grep -q '^STATE_KEY=.' "$ENV_FILE" || { echo "Set STATE_KEY in $ENV_FILE (openssl rand -hex 32)." >&2; exit 1; }

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file=$ENV_FILE</string>
    <string>src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$SERVER_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOST</key><string>127.0.0.1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/server.log</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"
PORT=$(sed -n 's/^PORT=//p' "$ENV_FILE"); PORT=${PORT:-8787}
sleep 2
if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "Huddle server is running on http://127.0.0.1:$PORT (logs: $LOG_DIR/server.log)."
else
  echo "The server didn't answer on port $PORT. Check $LOG_DIR/server.log." >&2
  exit 1
fi
