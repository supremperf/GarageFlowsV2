#!/bin/bash
# Usage : masque.sh <entrée.png> <sortie.png> "<x1,y1 x2,y2>" "<libellé>" [autres zones x1,y1 x2,y2 …]
# Recouvre une zone d'un rectangle noir légendé ; zones supplémentaires sans légende.
in="$1"; out="$2"; zone="$3"; label="$4"; shift 4
read -r p1 p2 <<<"$zone"; x1=${p1%,*}; y1=${p1#*,}
args=(-fill '#000000' -draw "rectangle $p1 $p2")
for z in "$@"; do args+=(-draw "rectangle $z"); done
convert "$in" "${args[@]}" -font DejaVu-Sans-Bold -pointsize 12 -fill '#ffd166' \
  -annotate +$((x1+10))+$((y1+20)) "$label" "$out" && echo "masqué : $out"
