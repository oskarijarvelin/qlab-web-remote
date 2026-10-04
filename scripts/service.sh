#!/bin/zsh
# Runs the remote as a macOS background service (launchd LaunchAgent): it starts when you log in
# and is restarted automatically within a couple of seconds if it crashes or is killed.
#
#   npm run service:install     install and start (run again after moving the repo or updating Node)
#   npm run service:uninstall   stop and remove
#   npm run service:status      is it running?
#   npm run service:log         follow the log
#   npm run service:restart     restart, e.g. after editing config.json by hand
#
# CONFIG and PORT set when installing are passed on to the service.
# QLR_LABEL changes the service name (only needed for testing).
set -e

LABEL=${QLR_LABEL:-local.qlab-web-remote}
DIR=${0:A:h:h}
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/$LABEL.log"
DOMAIN="gui/$(id -u)"

xml() { print -r -- "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

case "$1" in
  install)
    NODE=$(command -v node) || { echo "Node.js ei löydy. Asenna se osoitteesta https://nodejs.org"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    ENV_XML="<key>PATH</key><string>$(xml "${NODE:h}"):/usr/bin:/bin:/usr/sbin:/sbin</string>"
    [[ -n $CONFIG ]] && ENV_XML+="<key>CONFIG</key><string>$(xml "${CONFIG:A}")</string>"
    [[ -n $PORT ]] && ENV_XML+="<key>PORT</key><string>$(xml "$PORT")</string>"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$(xml "$LABEL")</string>
  <key>ProgramArguments</key>
  <array><string>$(xml "$NODE")</string><string>$(xml "$DIR/server.js")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
  <key>EnvironmentVariables</key><dict>$ENV_XML</dict>
  <key>RunAtLoad</key><true/>
  <!-- Restart after a crash or kill, but not after a clean exit (e.g. port already in use). -->
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>StandardOutPath</key><string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key><string>$(xml "$LOG")</string>
</dict>
</plist>
EOF
    plutil -lint "$PLIST" >/dev/null
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Taustapalvelu asennettu ja käynnissä ($LABEL)."
    echo "Se käynnistyy kirjautuessa ja uudelleen, jos se kaatuu. Loki: $LOG"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Taustapalvelu poistettu ($LABEL)."
    ;;
  status)
    if INFO=$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null); then
      field() { print -r -- "$INFO" | awk -F' = ' -v k="$1" '$1 == "\t" k {print $2; exit}'; }
      STATE=$(field state); PID=$(field pid); RUNS=$(field runs)
      echo "Taustapalvelu: $STATE${PID:+ (pid $PID)}, käynnistetty $RUNS kertaa. Loki: $LOG"
    else
      echo "Taustapalvelua ei ole asennettu ($LABEL)."
    fi
    ;;
  log)
    tail -n 40 -f "$LOG"
    ;;
  restart)
    launchctl kickstart -k "$DOMAIN/$LABEL"
    echo "Taustapalvelu käynnistetty uudelleen."
    ;;
  *)
    echo "Käyttö: $0 install | uninstall | status | log | restart"
    exit 1
    ;;
esac
