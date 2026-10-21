#!/bin/bash
# Usage : keygen-start.sh <copie>  — lance le VRAI keygen de la copie sur l'affichage :99.
COPIE="$1"; export DISPLAY=:99 LANG=C.UTF-8 LC_ALL=C.UTF-8
( cd "$COPIE" && exec setsid python3.12 scripts/keygen_ui.py ) < /dev/null > "$COPIE/keygen-ui.log" 2>&1 &
WID=""
for i in $(seq 1 60); do WID=$(timeout 5 xdotool search --name "Gestionnaire de licences" 2>/dev/null | head -1); [ -n "$WID" ] && break; sleep 0.5; done
[ -z "$WID" ] && { echo "fenêtre du keygen introuvable" >&2; exit 1; }
timeout 5 xdotool windowmove "$WID" 0 0; sleep 3; echo "$WID"
