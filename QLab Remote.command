#!/bin/zsh -l
# Double-click in Finder to start the remote. Closing this window stops it.
cd "$(dirname "$0")" || exit 1
printf '\e]0;QLab Remote\a'
if ! command -v node >/dev/null; then
  echo "Node.js ei löydy. Asenna se osoitteesta https://nodejs.org ja yritä uudelleen."
  read -k1 '?Paina mitä tahansa näppäintä sulkeaksesi.'
  exit 1
fi
exec caffeinate -i node server.js
