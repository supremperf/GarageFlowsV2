"""
keygen_server.py — Client HTTP du Keygen vers l'instance GarageFlows.

SOURCE UNIQUE DE CONFIGURATION : l'URL du serveur vit dans
keys/server_config.json (préremplie par défaut) et n'est codée en dur nulle
part ailleurs. Les routes appelées ici EXISTENT :
  · POST /api/admin/licenses/create        — enregistrement d'un jeton signé (x-gf-key)
  · GET  /api/keygen/licenses              — état serveur des licences (x-gf-key)
  · POST /api/keygen/licenses/[lid]/hwid   — réinitialisation matérielle (x-gf-key)
  · POST /api/keygen/licenses/[lid]/status — changement de statut (x-gf-key)

Aucune route n'est inventée : toute route utilisée ici est déclarée dans
`src/lib/__tests__/routes-sans-appelant.test.ts` et couverte par
`src/lib/license/__tests__/keygen-api-contract.test.ts`.

Les messages d'erreur sont traduits en français et n'exposent JAMAIS le jeton de
licence ni la clé API.

PRÉCÉDENCE DES ERREURS (corrigé le 2026-10-21). `_request` calculait un message
générique pour TOUTE réponse HTTP d'erreur, et chaque appelant commençait par
`if err: return False, err` : les branches par code de chaque fonction
(404 « licence introuvable », 409 « déjà enregistrée », 400 « jeton refusé »)
étaient donc INATTEIGNABLES. Conséquence observée : une activation sur une
licence non encore enregistrée répondait `404 {"code":"NOT_FOUND"}`, et le
Keygen affichait « Route absente sur ce serveur » — un défaut de routage
imaginaire, alors que la route existe et avait correctement répondu.

`_request` ne renvoie plus désormais qu'une erreur de TRANSPORT (connexion,
délai, réponse illisible). Le classement par code HTTP appartient à l'appelant,
et un 404 est distingué selon qu'il porte ou non un corps JSON applicatif :
  · corps JSON avec `error`/`code` → la route a répondu : RESSOURCE absente ;
  · aucun corps JSON              → la ROUTE elle-même est absente.
"""

import json
import socket
import urllib.error
import urllib.request
from typing import NamedTuple, Optional

USER_AGENT = "GarageFlow-KeygenGUI/3"
DEFAULT_TIMEOUT = 10

# Routes réellement servies par l'application.
ROUTE_CREATE = "/api/admin/licenses/create"
ROUTE_LICENSES = "/api/keygen/licenses"
# Les segments entre accolades sont substitués à l'appel : ce sont les seules
# routes paramétrées du contrat Keygen ↔ serveur.
ROUTE_HWID = "/api/keygen/licenses/{lid}/hwid"
ROUTE_STATUS = "/api/keygen/licenses/{lid}/status"


def validate_server_url(url: str) -> tuple[bool, str]:
    """Valide l'URL serveur. https:// requis ; http:// toléré pour un hôte local."""
    u = (url or "").strip()
    if not u:
        return False, "URL du serveur vide — saisissez une adresse (https://…)."
    if not (u.startswith("http://") or u.startswith("https://")):
        return False, "URL invalide — elle doit commencer par http:// ou https://."
    rest = u.split("://", 1)[1].strip()
    if not rest or rest.startswith("/"):
        return False, "URL invalide — hôte du serveur manquant."
    host = rest.split("/")[0].split(":")[0]
    if u.startswith("http://") and host not in ("localhost", "127.0.0.1", "[::1]"):
        return False, "http:// n'est accepté que pour un hôte local (localhost, 127.0.0.1)."
    return True, ""


class Reponse(NamedTuple):
    """Résultat d'un appel HTTP.

    `erreur_transport` n'est renseignée QUE si la requête n'a pas abouti
    (connexion, délai) : une réponse HTTP d'erreur est un succès de transport,
    classée par l'appelant selon son code. Cette séparation est ce qui empêche
    un message générique de masquer un refus métier.
    """
    code: int
    body: dict | None
    erreur_transport: str
    retry_after: str = ""
    corps_illisible: bool = False


def _request(url: str, api_key: str, method: str = "GET", payload: dict | None = None,
             timeout: int = DEFAULT_TIMEOUT) -> Reponse:
    """Requête JSON. Voir `Reponse` : le code HTTP n'est JAMAIS traduit ici."""
    data = json.dumps(payload or {}).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url, data=data,
        headers={
            "Content-Type": "application/json",
            "x-gf-key": api_key or "",
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body, illisible = _json(resp)
            return Reponse(resp.status, body, "", "", illisible)
    except urllib.error.HTTPError as e:
        body, illisible = _json(e)
        retry = ""
        try:
            retry = e.headers.get("Retry-After") or ""
        except Exception:
            retry = ""
        return Reponse(e.code, body, "", retry, illisible)
    except socket.timeout:
        return Reponse(0, None, "Délai dépassé — le serveur ne répond pas.")
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.timeout):
            return Reponse(0, None, "Délai dépassé — le serveur ne répond pas.")
        return Reponse(0, None, "Connexion impossible — vérifiez l'URL du serveur et le réseau.")
    except Exception:
        return Reponse(0, None, "Connexion impossible — vérifiez l'URL du serveur et le réseau.")


def _json(resp) -> tuple[Optional[dict], bool]:
    """(corps_json_ou_None, corps_illisible).

    `corps_illisible` vaut True quand la réponse porte des octets qui ne sont
    pas du JSON d'objet : c'est le cas d'une page d'erreur HTML, donc le signe
    qu'on n'a pas parlé à la route attendue. Sans cette distinction, « aucun
    corps » et « corps invalide » étaient confondus.
    """
    try:
        raw = resp.read()
    except Exception:
        return None, False
    if not raw:
        return None, False
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except Exception:
        return None, True
    return (parsed, False) if isinstance(parsed, dict) else (None, True)


def _message_serveur(body):
    """Message applicatif porté par la réponse, s'il y en a un."""
    if isinstance(body, dict):
        for champ in ("error", "message"):
            if body.get(champ):
                return str(body[champ])
    return ""


def _http_message(resp: "Reponse", *, ressource: str = "La ressource demandée") -> str:
    """Traduit un code HTTP en message précis, SANS jamais tout ramener à un 404.

    Chaque code a sa cause et son geste correctif. Le message applicatif du
    serveur est préféré quand il existe : c'est lui qui sait pourquoi il refuse.
    """
    code, body = resp.code, resp.body
    serveur = _message_serveur(body)

    if code == 400:
        return serveur or "Requête invalide (400) — données refusées par le serveur."
    if code in (401, 403):
        return "Clé API invalide (GARAGEFLOW_API_KEY) — vérifiez la clé configurée sur le serveur."
    if code == 404:
        # DISCRIMINATION ESSENTIELLE. Un corps JSON applicatif prouve que la
        # route a été atteinte et a répondu : c'est la RESSOURCE qui manque.
        # Sans corps JSON (page d'erreur HTML de Next.js), c'est la ROUTE.
        if serveur:
            return serveur
        if isinstance(body, dict):
            return ressource + " est introuvable sur le serveur (404)."
        return ("Route absente sur ce serveur (404) — l'instance déployée ne connaît pas "
                "cette route ; elle n'est probablement pas à jour.")
    if code == 405:
        return ("Méthode HTTP refusée par la route (405) — le Keygen et l'instance ne sont "
                "pas de la même version.")
    if code == 409:
        return serveur or "Conflit (409) — l'état du serveur ne permet pas cette opération."
    if code == 422:
        return serveur or "Données non valides (422) — le serveur a refusé le contenu."
    if code == 429:
        suite = (" dans " + resp.retry_after + " s") if resp.retry_after else " dans quelques instants"
        return "Trop de requêtes (rate limit) — réessayez" + suite + "."
    if code == 500:
        return serveur or "Erreur interne du serveur (500) — consultez les journaux de l'instance."
    if code in (502, 503, 504):
        return "Serveur indisponible (HTTP " + str(code) + ") — réessayez plus tard."
    if resp.corps_illisible:
        return ("Réponse inattendue du serveur (HTTP " + str(code) + ") : le contenu n'est "
                "pas du JSON. L'URL ne pointe peut-être pas sur une instance GarageFlows.")
    return serveur or ("Erreur HTTP " + str(code))


def test_connection(server_url: str, api_key: str, timeout: int = 8) -> tuple[bool, str]:
    """Teste la configuration : la route d'état des licences répond-elle ?

    `GET /api/keygen/licenses` est une lecture authentifiée : une clé API
    invalide renvoie 403, une instance injoignable une erreur réseau. Aucune
    écriture n'est effectuée.
    """
    ok_url, err_url = validate_server_url(server_url)
    if not ok_url:
        return False, err_url
    if not (api_key or "").strip():
        return False, "Clé API requise pour interroger le serveur."
    url = server_url.rstrip("/") + ROUTE_LICENSES
    resp = _request(url, api_key, "GET", timeout=timeout)
    if resp.erreur_transport:
        return False, resp.erreur_transport
    if resp.code == 200:
        if not isinstance(resp.body, dict):
            return False, ("Réponse du serveur illisible (JSON attendu) — l'URL ne pointe "
                           "peut-être pas sur une instance GarageFlows.")
        count = ""
        if isinstance(resp.body.get("licenses"), list):
            count = " — %d licence(s) connue(s) du serveur." % len(resp.body["licenses"])
        return True, "Connexion réussie (HTTP 200)" + count
    return False, _http_message(resp, ressource="La route d'état des licences")


def register_license(server_url: str, api_key: str, token: str) -> tuple[bool, str]:
    """Enregistre un jeton DÉJÀ SIGNÉ sur le serveur (POST /api/admin/licenses/create)."""
    ok_url, err_url = validate_server_url(server_url)
    if not ok_url:
        return False, err_url
    if not (api_key or "").strip():
        return False, "Clé API non configurée."
    if not (token or "").strip():
        return False, "Jeton vide — rien à enregistrer."
    url = server_url.rstrip("/") + ROUTE_CREATE
    resp = _request(url, api_key, "POST", {"token": token.strip()})
    if resp.erreur_transport:
        return False, resp.erreur_transport
    if resp.code in (200, 201):
        return True, "Licence enregistrée sur le serveur."
    if resp.code == 409:
        # Idempotent côté serveur : la licence est déjà connue, l'objectif est atteint.
        return True, "Licence déjà enregistrée sur le serveur."
    if resp.code == 400:
        # Le serveur vérifie la SIGNATURE avant d'enregistrer : son motif est la
        # seule information utile ici (clé de signature non déployée, jeton altéré,
        # licence expirée…). Le masquer rendait le diagnostic impossible.
        motif = _message_serveur(resp.body)
        return False, ("Jeton refusé par le serveur : " + motif if motif
                       else "Jeton refusé par le serveur (signature ou contenu invalide).")
    return False, _http_message(resp, ressource="La route d'enregistrement")


def fetch_licenses(server_url: str, api_key: str, timeout: int = DEFAULT_TIMEOUT) -> tuple[bool, list, str]:
    """État serveur des licences : statut, échéance, liaison matérielle, appareils."""
    ok_url, err_url = validate_server_url(server_url)
    if not ok_url:
        return False, [], err_url
    if not (api_key or "").strip():
        return False, [], "Clé API non configurée."
    url = server_url.rstrip("/") + ROUTE_LICENSES
    resp = _request(url, api_key, "GET", timeout=timeout)
    if resp.erreur_transport:
        return False, [], resp.erreur_transport
    if resp.code == 200:
        if isinstance(resp.body, dict) and isinstance(resp.body.get("licenses"), list):
            return True, resp.body["licenses"], ""
        return False, [], "Réponse du serveur illisible (liste de licences attendue)."
    return False, [], _http_message(resp, ressource="La route d'état des licences")


def reset_hwid(server_url: str, api_key: str, lid: str, *,
               action: str = "reset", reason: str = "") -> tuple[bool, str]:
    """Réinitialisation matérielle administrative (POST /api/keygen/licenses/[lid]/hwid)."""
    ok_url, err_url = validate_server_url(server_url)
    if not ok_url:
        return False, err_url
    if not (api_key or "").strip():
        return False, "Clé API non configurée."
    if not (lid or "").strip():
        return False, "LID manquant."
    if action not in ("reset", "revoke"):
        return False, "Action invalide (reset | revoke)."
    url = server_url.rstrip("/") + ROUTE_HWID.format(lid=lid.strip())
    resp = _request(url, api_key, "POST", {"action": action, "reason": reason or ""})
    if resp.erreur_transport:
        return False, resp.erreur_transport
    if resp.code == 200:
        note = ""
        if isinstance(resp.body, dict) and resp.body.get("note"):
            note = " " + str(resp.body["note"])
        return True, ("Appareils réinitialisés : sièges libérés." if action == "reset"
                      else "Appareil révoqué.") + note
    return False, _http_message(resp, ressource="Cette licence ou cet appareil")


def set_status(server_url: str, api_key: str, lid: str, status: str, *,
               confirm_reactivation: bool = False, reason: str = "") -> tuple[bool, str]:
    """Change le statut serveur d'une licence (POST /api/keygen/licenses/[lid]/status).

    Remplace l'ancien appel à `/api/admin/licenses/revoke-by-key`, retiré
    définitivement : sans cette route, le Keygen mettait sa base locale à jour
    et le serveur ignorait tout — local et réel divergeaient en silence.
    """
    ok_url, err_url = validate_server_url(server_url)
    if not ok_url:
        return False, err_url
    if not (api_key or "").strip():
        return False, "Clé API non configurée."
    if not (lid or "").strip():
        return False, "LID manquant."
    if status not in ("active", "suspended", "revoked"):
        return False, "Statut invalide (active | suspended | revoked)."
    url = server_url.rstrip("/") + ROUTE_STATUS.format(lid=lid.strip())
    payload = {"status": status}
    if status == "active":
        payload["confirmReactivation"] = bool(confirm_reactivation)
    if reason:
        payload["reason"] = reason
    resp = _request(url, api_key, "POST", payload)
    if resp.erreur_transport:
        return False, resp.erreur_transport
    if resp.code == 200:
        note = ""
        if isinstance(resp.body, dict):
            if resp.body.get("unchanged"):
                return True, "Statut déjà à jour sur le serveur."
            if resp.body.get("note"):
                note = " " + str(resp.body["note"])
        return True, "Statut « " + status + " » appliqué sur le serveur." + note
    if resp.code == 404 and isinstance(resp.body, dict):
        # La route a répondu : c'est la LICENCE qui n'est pas enregistrée.
        # Le geste correctif est explicite, et distinct d'un défaut de routage.
        return False, ("Licence introuvable sur le serveur : enregistrez-la d'abord "
                       "(bouton « Enregistrer sur le serveur »).")
    return False, _http_message(resp, ressource="Cette licence")


def merge_server_state(local_record: dict, server_row) -> dict:
    """Fusionne une ligne serveur dans la fiche locale (sans jamais perdre le token local)."""
    if not isinstance(server_row, dict):
        return local_record
    patch = {}
    # Le contrat de collecte expose `expiryAt` (nom historique du serveur) ; la
    # fiche locale et l'IHM lisent `expiresAt`. Les deux noms coexistaient sans
    # conversion : la date d'expiration serveur n'arrivait jamais dans la fiche.
    # Une seule normalisation, ici, pour tous les appelants.
    aliases = {"expiryAt": "expiresAt"}
    for key in ("status", "hwid", "activatedAt", "lastSeenAt", "seats", "expiresAt", "expiryAt",
                "deviceCount", "activeDeviceCount", "bound"):
        if key in server_row:
            patch[aliases.get(key, key)] = server_row[key]
    if not patch:
        return local_record
    merged = dict(local_record)
    merged["server"] = dict(merged.get("server") or {}, **patch)
    return merged
