#!/usr/bin/env python3
"""
gen_test_licenses.py — fixtures de licences pour le test E2E keygen(Python)→verify(Node).

Utilise l'OUTIL OFFICIEL scripts/keygen_core.py : génère une paire de clés ECC
P-256 ÉPHÉMÈRE (jamais keys/private.pem de production, jamais commitée), signe une
matrice de licences (valides + invalides) et écrit un JSON de fixtures contenant
la clé PUBLIQUE, l’empreinte LOCALE de la machine (fixture de format, PAS le HWID de l’application) et les jetons.

Sécurité : la clé PRIVÉE n'est ni affichée, ni journalisée, ni écrite dans les
fixtures ; son fichier temporaire est supprimé en fin d'exécution.

Usage : python3 scripts/gen_test_licenses.py <chemin_fixtures.json>
"""
import sys, json, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
import keygen_core as kc  # outil officiel
import hwid_v1            # référence canonique HWID V1 (AUD-036)

if not kc.HAS_CRYPTO:
    print('SKIP: module cryptography indisponible', file=sys.stderr)
    sys.exit(2)

tmp = Path(tempfile.mkdtemp(prefix='gf-keygen-'))
kc.KEYS_DIR, kc.PRIV_FILE, kc.PUB_FILE = tmp, tmp / 'private.pem', tmp / 'public.pem'

kc.generate_keys()                       # génération par l'outil officiel
priv = kc.load_private_key()
pub_pem = kc.PUB_FILE.read_text()
machine_hwid = kc.get_hwid()             # empreinte LOCALE du keygen (fixture de format — PAS le HWID de l'app)

lics = []
def add(name, token, expect_valid, **extra):
    lics.append({'name': name, 'token': token, 'expectValid': expect_valid, **extra})

l1 = kc.make_license(priv, 'CUST-0001', 'premium',    years=1, seats=3)
add('L1 premium valide', l1['token'], True, typ='premium', seats=3)
l2 = kc.make_license(priv, 'CUST-0002', 'enterprise', years=2, seats=10)
add('L2 enterprise valide', l2['token'], True, typ='enterprise')
l3 = kc.make_license(priv, 'CUST-0003', 'trial',      years=1, seats=1)
add('L3 trial valide', l3['token'], True, typ='trial')
l4 = kc.make_license(priv, 'CUST-0004', 'premium',    years=3, seats=5)
add('L4 expiration future (3 ans)', l4['token'], True, typ='premium')
l5 = kc.make_license(priv, 'CUST-0005', 'premium',    years=1, seats=1, hwid=machine_hwid)
add('L5 liée au HWID machine', l5['token'], True, typ='premium', hwidBound=True)
l6 = kc.make_mechanic_license(priv, l1['lid'], 'CUST-0001', years=1, mechanic_name='Lea')
add('L6 mecanicien (parent L1)', l6['token'], True, typ='mechanic')

# L7 : HWID V1 CANONIQUE (AUD-036). Le CLIENT produit l'empreinte via l'algorithme
# partagé (hwid_v1) ; le keygen la LIE telle quelle (aucune reconstruction). On
# utilise les champs du vecteur « full-windows » → empreinte connue/déterministe.
hwid_v1_fields = {
    "cpu": "Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz",
    "mac": "a4:83:e7:1b:2c:3d",
    "platform": "win32-x64",
    "machineId": "",
    "diskSerial": "WD-WX21A1234567",
}
machine_hwid_v1 = hwid_v1.hwid_v1(hwid_v1_fields)
l7 = kc.make_license(priv, 'CUST-0007', 'premium', years=1, seats=1, hwid=machine_hwid_v1)
add('L7 liée au HWID V1 canonique', l7['token'], True, typ='premium', hwidV1Bound=True)

add('I1 expiree', kc.make_license(priv, 'CUST-0006', 'premium', years=-1, seats=1)['token'], False)

t = l1['token']; add('I2 signature alteree', t[:-2] + ('BB' if t.endswith('A') else 'AA'), False)

parts = l2['token'].split('.')
p = json.loads(kc.b64u_dec(parts[2])); p['seats'] = 9999
parts[2] = kc.b64u_enc(json.dumps(p, separators=(',', ':')).encode())
add('I3 payload modifie (sieges gonfles)', '.'.join(parts), False)

# ── Liaison matérielle : validation AVANT signature ─────────────────────────
# Un HWID mal formé était signé sans erreur puis refusé par l'application
# (« Licence invalide ou modifiée »). Chaque cas consigne ce que le générateur
# a réellement fait : accepté+normalisé, ou refusé avant production de jeton.
def _hwid_case(raw):
    normalized = kc.normalize_license_hwid(raw)
    case = {
        'input': raw,
        'normalized': normalized,
        'formatAccepted': kc.is_valid_license_hwid(normalized),
        'signed': False,
        'refused': None,
        'signedHwid': None,
    }
    try:
        info = kc.make_license(priv, 'CUST-HWID', 'premium', years=1, hwid=raw)
        case['signed'] = True
        if info['token']:
            payload = json.loads(kc.b64u_dec(info['token'].split('.')[2]))
            case['signedHwid'] = payload.get('hwid')
    except ValueError as exc:
        case['refused'] = str(exc)
    return case

hwid_binding = {
    'checks': [
        _hwid_case(machine_hwid.upper()),
        _hwid_case('  ' + machine_hwid_v1.upper() + '\n'),
        _hwid_case(machine_hwid[:63]),
        _hwid_case(machine_hwid + '0'),
        _hwid_case('g' * 64),
        _hwid_case('"' + machine_hwid + '"'),
        _hwid_case('HWID1-' + 'a' * 63),
        _hwid_case(''),
    ],
    # Empreinte calculée LOCALEMENT par le keygen : format v0 valide, mais ce
    # n'est PAS celle de l'application (cpu/plateforme/MAC collectés autrement).
    # Conservée comme preuve de la divergence, jamais comme valeur à signer.
    'keygenSelfHwid': kc.get_hwid(),
}

Path(sys.argv[1]).write_text(json.dumps(
    {'publicPem': pub_pem, 'machineHwid': machine_hwid, 'wrongHwid': 'f' * 64,
     'machineHwidV1': machine_hwid_v1, 'wrongHwidV1': 'HWID1-' + 'f' * 64,
     'hwidBinding': hwid_binding,
     'licenses': lics}, indent=1))

kc.PRIV_FILE.unlink()  # ne jamais conserver la clé privée
print(f'OK {len(lics)} jetons (keygen_core officiel)')
