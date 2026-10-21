#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Parcours de bout en bout du Keygen contre une instance GarageFlows RÉELLE.

Génération → signature → enregistrement → activation → persistance →
suspension → révocation → réactivation, plus tous les refus attendus. Aucun
composant simulé : vrai client HTTP du Keygen (`keygen_server.py`), vraies
routes Next.js, vraie base, vraie signature ECDSA P-256.

POURQUOI CE SCRIPT EXISTE. Le Keygen répondait « Route absente sur ce serveur
(404) » à toute tentative d'activation. La route existait et répondait
correctement : c'était un 404 MÉTIER (licence inconnue de la base) que le client
Python traduisait en défaut de routage, sur une licence que rien n'enregistrait
jamais côté serveur. Deux défauts invisibles aux tests unitaires, parce qu'ils
vivaient dans l'enchaînement des étapes. Ce parcours les rend détectables.

    USAGE
      # instance de recette locale, base jetable
      cp prisma/garageflow-template.db prisma/recette.db
      DATABASE_URL="file:./recette.db" GARAGEFLOW_API_KEY="<clé de recette>" \\
        RATE_LIMIT_LICENSE_ACTIVATE_MAX=40 npx next dev -p 4199
      # puis, dans un autre terminal
      GF_E2E_URL=http://localhost:4199 GF_E2E_KEY="<clé de recette>" \\
        python scripts/test_keygen_e2e.py

    GARDE-FOU. Le script ÉCRIT (licences de test, activations, révocations). Il
    refuse donc toute cible qui n'est pas une boucle locale, sauf
    GF_E2E_ALLOW_REMOTE=1 — à ne poser que sur une instance de recette dédiée,
    JAMAIS sur la production : l'autorité de signature locale doit par ailleurs
    être celle que la cible vérifie, sinon tout enregistrement est refusé en 400.

Sans GF_E2E_URL, le script ne teste rien et le dit (code de sortie 0) : il ne
prétend jamais avoir validé une chaîne qu'il n'a pas parcourue.
"""

import hashlib
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RACINE / "scripts"))
os.chdir(RACINE)

import keygen_core as core          # noqa: E402
import keygen_server as server      # noqa: E402

HOTES_LOCAUX = ("localhost", "127.0.0.1", "[::1]", "::1")
HWID = "HWID1-" + hashlib.sha256(b"poste-de-recette-e2e").hexdigest()

resultats = []


def etape(nom, attendu, obtenu, ok):
    resultats.append((bool(ok), nom, attendu, obtenu))
    print(f"  [{'OK  ' if ok else 'ÉCHEC'}] {nom}\n          attendu : {attendu}"
          f"\n          obtenu  : {obtenu}")


def cible():
    """URL et clé de l'instance de recette, avec garde-fou sur la destination."""
    url = (os.environ.get("GF_E2E_URL") or "").strip().rstrip("/")
    cle = (os.environ.get("GF_E2E_KEY") or "").strip()
    if not url:
        print("GF_E2E_URL absente : AUCUN parcours exécuté (voir l'en-tête de ce fichier).")
        print("Rien n'a été vérifié — ce n'est pas un succès.")
        sys.exit(0)
    if not cle:
        print("GF_E2E_KEY absente : la clé API de l'instance de recette est requise.")
        sys.exit(2)
    hote = (urllib.parse.urlparse(url).hostname or "").lower()
    if hote not in HOTES_LOCAUX and os.environ.get("GF_E2E_ALLOW_REMOTE") != "1":
        print(f"Cible refusée ({hote}) : ce parcours ÉCRIT des licences de test.")
        print("Posez GF_E2E_ALLOW_REMOTE=1 uniquement sur une instance de recette dédiée.")
        sys.exit(2)
    return url, cle


URL, CLE = cible()


def activer(token, hwid=HWID, install_id=None):
    """POST /api/license/activate — exactement ce que fait le poste Electron."""
    charge = {"license": token, "version": "1.1.0", "os": "win32", "arch": "x64",
              "name": "Poste de recette E2E"}
    if hwid:
        charge["hwid"] = hwid
    if install_id:
        charge["installId"] = install_id
    req = urllib.request.Request(
        URL + "/api/license/activate", data=json.dumps(charge).encode(),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        brut = e.read().decode()
        try:
            return e.code, json.loads(brut)
        except Exception:
            return e.code, {"brut": brut[:200]}
    except Exception as exc:
        return 0, {"erreur": f"{type(exc).__name__}: {exc}"}


print("=" * 78)
print("  PARCOURS DE BOUT EN BOUT — KEYGEN → API → BASE → ACTIVATION")
print("  instance :", URL)
print("=" * 78)

print("\n0. Connexion au serveur")
ok, msg = server.test_connection(URL, CLE)
etape("test_connection", "connexion réussie", msg, ok)
if not ok:
    print("\nInstance injoignable ou clé API refusée : parcours interrompu.")
    sys.exit(1)

print("\n1. Génération et signature (autorité locale)")
cle_privee = core.load_checked_private_key("")
from cryptography.hazmat.primitives import serialization as _ser   # noqa: E402
empreinte = hashlib.sha256(cle_privee.public_key().public_bytes(
    _ser.Encoding.DER, _ser.PublicFormat.SubjectPublicKeyInfo)).hexdigest()
lic = core.make_license(cle_privee, "E2E-RECETTE", "premium", seats=2,
                        label="licence de recette E2E",
                        duration={"value": 30, "unit": "jours"}, enforce_offer=True)
etape("signature produite", "jeton GF2 signé",
      f"lid={lic['lid'][:8]}… autorité={empreinte[:16]}… expire={lic['expires_at']}",
      lic["token"].startswith("GF2."))

print("\n2. Enregistrement sur le serveur (POST /api/admin/licenses/create)")
ok, msg = server.register_license(URL, CLE, lic["token"])
etape("register_license", "enregistrée", msg, ok)
print("\n2b. Réenregistrement : idempotence (409 traité comme succès)")
ok, msg = server.register_license(URL, CLE, lic["token"])
etape("register_license (2ᵉ fois)", "déjà enregistrée, succès", msg, ok)

print("\n3. État serveur (GET /api/keygen/licenses)")
ok, licences, msg = server.fetch_licenses(URL, CLE)
trouvee = next((l for l in licences if l.get("licenseId") == lic["lid"]), None)
etape("fetch_licenses", "licence présente côté serveur",
      f"{len(licences)} licence(s), la nôtre : {'présente' if trouvee else 'ABSENTE'}",
      ok and trouvee is not None)

print("\n4. ACTIVATION par le poste client (POST /api/license/activate)")
code, corps = activer(lic["token"])
etape("activation", "HTTP 200 ok=true",
      f"HTTP {code} ok={corps.get('ok')} type={corps.get('licenseType')}",
      code == 200 and corps.get("ok") is True)

print("\n4b. Seconde activation du MÊME poste (réentrance)")
code, corps = activer(lic["token"])
etape("réactivation même poste", "HTTP 200 ok=true", f"HTTP {code} ok={corps.get('ok')}",
      code == 200 and corps.get("ok") is True)

print("\n4c. Persistance côté serveur")
ok, licences, _ = server.fetch_licenses(URL, CLE)
trouvee = next((l for l in licences if l.get("licenseId") == lic["lid"]), None) or {}
etape("persistance", "première activation horodatée et appareil compté",
      f"activatedAt={trouvee.get('activatedAt')} deviceCount={trouvee.get('deviceCount')} "
      f"activeDeviceCount={trouvee.get('activeDeviceCount')}",
      bool(trouvee.get("activatedAt")))

print("\n5. Suspension (POST /api/keygen/licenses/[lid]/status)")
ok, msg = server.set_status(URL, CLE, lic["lid"], "suspended")
etape("set_status suspended", "statut appliqué", msg, ok)
print("\n5b. Une licence suspendue est refusée à l'activation")
code, corps = activer(lic["token"])
etape("activation sur licence suspendue", "refus ok=false code=LICENSE_SUSPENDED",
      f"HTTP {code} ok={corps.get('ok')} code={corps.get('code')}",
      corps.get("ok") is False and corps.get("code") == "LICENSE_SUSPENDED")
print("\n5c. Retour à actif")
ok, msg = server.set_status(URL, CLE, lic["lid"], "active")
etape("set_status active", "statut appliqué", msg, ok)
code, corps = activer(lic["token"])
etape("activation rétablie", "HTTP 200 ok=true", f"HTTP {code} ok={corps.get('ok')}",
      code == 200 and corps.get("ok") is True)

print("\n6. Réinitialisation matérielle (POST /api/keygen/licenses/[lid]/hwid)")
ok, msg = server.reset_hwid(URL, CLE, lic["lid"], action="reset", reason="recette e2e")
etape("reset_hwid", "sièges libérés", msg, ok)

print("\n7. Révocation")
ok, msg = server.set_status(URL, CLE, lic["lid"], "revoked", reason="recette e2e : révocation")
etape("set_status revoked", "révoquée", msg, ok)
print("\n7b. Une licence révoquée ne peut plus être activée")
code, corps = activer(lic["token"])
etape("activation sur licence révoquée", "refus ok=false code=LICENSE_REVOKED",
      f"HTTP {code} ok={corps.get('ok')} code={corps.get('code')}",
      corps.get("ok") is False and corps.get("code") == "LICENSE_REVOKED")
print("\n7c. Réactivation d'une révoquée SANS motif : refus attendu (machine à états)")
ok, msg = server.set_status(URL, CLE, lic["lid"], "active")
etape("réactivation sans motif", "refus", msg, not ok)
print("\n7d. Réactivation AVEC motif : acceptée")
ok, msg = server.set_status(URL, CLE, lic["lid"], "active",
                            confirm_reactivation=True, reason="recette e2e : remise en service")
etape("réactivation avec motif", "acceptée", msg, ok)

print("\n8. Refus attendus")

# Contrat documenté : pour une licence GARAGE, le JETON SIGNÉ fait autorité. Une
# licence valide inconnue de la base s'auto-enregistre à l'activation (la base
# sert à la révocation, pas à autoriser). Seule la clé privée ouvre : cf. plus bas.
inconnue = core.make_license(cle_privee, "E2E-AUTO-ENREG", "premium",
                             duration={"value": 30, "unit": "jours"}, enforce_offer=True)
code, corps = activer(inconnue["token"])
etape("licence valide inconnue de la base", "activée et auto-enregistrée",
      f"HTTP {code} ok={corps.get('ok')}", code == 200 and corps.get("ok") is True)
ok, licences, _ = server.fetch_licenses(URL, CLE)
presente = any(l.get("licenseId") == inconnue["lid"] for l in licences)
etape("auto-enregistrement visible du Keygen", "présente dans la liste serveur",
      "présente" if presente else "absente", presente)

# LE cas qui produisait « Route absente sur ce serveur » : licence jamais
# enregistrée ET jamais activée. Le message doit nommer la LICENCE.
jamais_vue = core.make_license(cle_privee, "E2E-JAMAIS-VUE", "premium",
                               duration={"value": 30, "unit": "jours"}, enforce_offer=True)
ok, msg = server.set_status(URL, CLE, jamais_vue["lid"], "active")
etape("statut sur licence inconnue du serveur", "message désignant la LICENCE, pas la route",
      msg, (not ok) and "enregistrez-la" in msg and "Route absente" not in msg)

altere = lic["token"][:-6] + "AAAAAA"
code, corps = activer(altere)
etape("jeton altéré (signature)", "refus ok=false code=LICENSE_INVALID",
      f"HTTP {code} ok={corps.get('ok')} code={corps.get('code')}",
      corps.get("ok") is False and corps.get("code") == "LICENSE_INVALID")

from cryptography.hazmat.primitives.asymmetric import ec as _ec   # noqa: E402
autre = core.make_license(_ec.generate_private_key(_ec.SECP256R1()), "E2E-AUTRE-AUTORITE",
                          "premium", duration={"value": 30, "unit": "jours"}, enforce_offer=True)
code, corps = activer(autre["token"])
etape("jeton d'une autre autorité", "refus ok=false",
      f"HTTP {code} ok={corps.get('ok')} code={corps.get('code')}", corps.get("ok") is False)
ok, msg = server.register_license(URL, CLE, autre["token"])
etape("enregistrement d'un jeton d'une autre autorité", "refus", msg, not ok)

expiree = core.make_license(cle_privee, "E2E-EXPIREE", "premium", years=-1)
ok, msg = server.register_license(URL, CLE, expiree["token"])
etape("enregistrement d'une licence expirée", "refus avec motif du serveur", msg,
      (not ok) and "expir" in msg.lower())

autre_hwid = "HWID1-" + hashlib.sha256(b"autre-poste").hexdigest()
liee = core.make_license(cle_privee, "E2E-HWID", "premium", hwid=autre_hwid,
                         duration={"value": 30, "unit": "jours"}, enforce_offer=True)
ok, msg = server.register_license(URL, CLE, liee["token"])
etape("enregistrement d'une licence liée à un HWID", "enregistrée", msg, ok)
code, corps = activer(liee["token"], hwid=HWID)
etape("activation avec mauvais HWID", "refus", f"HTTP {code} code={corps.get('code')}",
      code == 403)
code, corps = activer(liee["token"], hwid=autre_hwid)
etape("activation avec le BON HWID", "HTTP 200 ok=true", f"HTTP {code} ok={corps.get('ok')}",
      code == 200 and corps.get("ok") is True)

ok, msg = server.test_connection(URL, "mauvaise-cle-api-sur-32-caract")
etape("clé API invalide", "refus désignant la clé API", msg, (not ok) and "API" in msg)

# ── 9. Le limiteur de débit est RÉELLEMENT actif ────────────────────────────
# Un parcours qui passe ne dit pas si la protection est encore branchée : on
# épuise le quota de l'instance de recette et on exige le refus.
print("\n9. Limiteur de débit sur l'activation")
quota = int(os.environ.get("GF_E2E_ACTIVATE_MAX", "40"))
dernier = (0, {})
for _ in range(quota + 5):
    dernier = activer(lic["token"])
    if dernier[0] == 429:
        break
etape("limiteur d'activation", "refus 429 passé le quota", f"HTTP {dernier[0]}",
      dernier[0] == 429)

print("\n" + "=" * 78)
echecs = [r for r in resultats if not r[0]]
print(f"  BILAN : {len(resultats) - len(echecs)}/{len(resultats)} étapes conformes")
for _ok, nom, attendu, obtenu in echecs:
    print(f"    - {nom} | attendu {attendu} | obtenu {obtenu}")
print("=" * 78)
sys.exit(1 if echecs else 0)
