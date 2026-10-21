#!/bin/bash
# Usage : ocr-table.sh <racine du code analyseur>  — analyse les 4 captures de test réelles.
RACINE="$1"; IMG=/tmp/claude-0/-home-user-GarageFlowsV2/cc5cf177-5760-56c6-b3f1-fd0accdf2859/scratchpad/ocr
printf '%-12s %-9s %s\n' "Capture" "Bloquée" "Secrets détectés (valeurs masquées)"
for f in clean openai multi dark; do
  python3 "$RACINE/scripts/secret_scan.py" --patterns "$RACINE/patterns.toml" --image "$IMG/$f.png" --json 2>/dev/null \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('%-12s %-9s %s' % ('$f.png', 'OUI' if d['blocked'] else 'non', ', '.join(x['type']+' '+x['value_redacted'] for x in d['secrets']) or '—'))"
done
