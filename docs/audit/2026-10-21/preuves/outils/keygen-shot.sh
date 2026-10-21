#!/bin/bash
# Usage : keygen-shot.sh <fichier.png> [y_bouton_barre_laterale] [attente_s]
export DISPLAY=:99
WID=$(timeout 5 xdotool search --name "Gestionnaire de licences" 2>/dev/null | head -1)
[ -z "$WID" ] && { echo "fenêtre du keygen introuvable" >&2; exit 1; }
if [ -n "${2:-}" ]; then timeout 5 xdotool mousemove 125 "$2" click 1; sleep "${3:-2}"; fi
timeout 20 import -window root -crop 1280x860+0+0 +repage "$1" && echo "capture: $1 ($(identify -format '%wx%h' "$1"))"
