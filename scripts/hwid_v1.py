#!/usr/bin/env python3
"""HWID V1 — implémentation de RÉFÉRENCE Python de l'empreinte matérielle
canonique (AUD-036). MÊME algorithme que src/lib/license/hwid-v1.ts.

Le keygen ne doit PLUS reconstruire indépendamment l'identité du poste : le
client GarageFlows (Electron) produit le HWID V1 et le transmet. Ce module sert
de référence/vérification et prouve l'identité octet-pour-octet avec Node via
tests/fixtures/hwid-v1-vectors.json.

Usage :
  python3 scripts/hwid_v1.py --vectors tests/fixtures/hwid-v1-vectors.json
      → vérifie chaque vecteur (expected) ; sort 1 si un écart.
  echo '{"cpu":"...","mac":"..."}' | python3 scripts/hwid_v1.py --stdin
      → imprime le HWID V1 du JSON de champs lu sur stdin.
"""
import hashlib
import json
import re
import sys
import unicodedata

CANONICAL_KEYS = ["cpu", "diskSerial", "mac", "machineId", "platform"]
HWID_V1_PREFIX = "HWID1-"

_WS = re.compile(r"\s+")


def normalize_field(value):
    if value is None:
        value = ""
    value = unicodedata.normalize("NFC", str(value))
    value = _WS.sub(" ", value).strip().lower()
    return value


def hwid_v1(fields):
    lines = ["%s=%s" % (k, normalize_field(fields.get(k))) for k in CANONICAL_KEYS]
    serialized = "GF-HWID-V1\n" + "\n".join(lines)
    digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    return HWID_V1_PREFIX + digest


def _main(argv):
    if "--stdin" in argv:
        fields = json.load(sys.stdin)
        print(hwid_v1(fields))
        return 0
    if "--vectors" in argv:
        path = argv[argv.index("--vectors") + 1]
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        failed = 0
        for v in data.get("vectors", []):
            got = hwid_v1(v.get("fields", {}))
            exp = v.get("expected")
            status = "ok" if got == exp else "MISMATCH"
            if got != exp:
                failed += 1
            print("%-28s %s %s" % (v.get("name", "?"), status, got))
        if failed:
            print("\n%d vecteur(s) en écart Python↔attendu" % failed, file=sys.stderr)
            return 1
        print("\nOK : %d vecteurs, Python == attendu (== Node)." % len(data.get("vectors", [])))
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
