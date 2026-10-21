#!/bin/bash
# Usage : capt.sh <fichier.png> "<titre>" "<commande>" [colonnes] [lignes]
# Exécute RÉELLEMENT la commande dans un xterm sur l'affichage virtuel :99,
# puis capture la seule fenêtre du terminal (ImageMagick import).
set -u
OUT="$1"; TITRE="$2"; CMD="$3"; COLS="${4:-150}"; ROWS="${5:-48}"
export DISPLAY=:99 LANG=C.UTF-8 LC_ALL=C.UTF-8
REPO=${CAPT_REPO:-/home/user/GarageFlowsV2}
timeout 5 xdpyinfo >/dev/null 2>&1 || { echo "affichage $DISPLAY indisponible" >&2; exit 2; }
TAG="GFCAPT$$$RANDOM"
DONE="/tmp/claude-0/-home-user-GarageFlowsV2/cc5cf177-5760-56c6-b3f1-fd0accdf2859/scratchpad/capt/$TAG.done"
RUN="/tmp/claude-0/-home-user-GarageFlowsV2/cc5cf177-5760-56c6-b3f1-fd0accdf2859/scratchpad/capt/$TAG.sh"
cat > "$RUN" <<SCRIPT
cd $REPO
export TERM=xterm LANG=C.UTF-8 LC_ALL=C.UTF-8
printf '\e[1m══ %s ══\e[0m\n' "$TITRE"
printf 'Date (UTC) : %s   Dossier : %s   Branche : %s   HEAD : %s\n' "\$(date -u '+%Y-%m-%d %H:%M:%S')" "\$(basename \$PWD)" "\$(git rev-parse --abbrev-ref HEAD)" "\$(git rev-parse --short HEAD)"
printf '\e[1m\$ %s\e[0m\n' $(printf '%q' "$CMD")
bash -o pipefail -c $(printf '%q' "$CMD")
printf '\n\e[1m[code de sortie : %s]\e[0m\n' "\$?"
touch "$DONE"
sleep 600
SCRIPT
xterm -u8 -T "$TAG" -fa 'DejaVu Sans Mono' -fs 10 -bg white -fg black -geometry ${COLS}x${ROWS}+10+10 -e bash "$RUN" &
XPID=$!
for i in $(seq 1 1800); do [ -f "$DONE" ] && break; kill -0 $XPID 2>/dev/null || { echo "xterm terminé sans résultat" >&2; rm -f "$RUN"; exit 3; }; sleep 0.5; done
sleep 1.2
WID=$(xdotool search --name "$TAG" | head -1)
import -window "$WID" "$OUT"
kill $XPID 2>/dev/null; wait $XPID 2>/dev/null
rm -f "$DONE" "$RUN"
echo "capture: $OUT ($(identify -format '%wx%h' "$OUT"))"
