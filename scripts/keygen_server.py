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
"""

import json
import socket
import urllib.error
import urllib.request
from typing import Optional

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


def _request(url: str, api_key: str, method: str = "GET", payload: dict | None = None,
             timeout: int = DEFAULT_TIMEOUT) -> tuple[int, dict | None, str]:
    """Requête JSON. Retourne (code_http, corps_ou_None, message_erreur)."""
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
            return resp.status, _json(resp), ""
    except urllib.error.HTTPError as e:
        body = _json(e)
        return e.code, body, _http_message(e.code, body, e)
    except socket.timeout:
        return 0, None, "Délai dépassé — le serveur ne répond pas."
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.timeout):
            return 0, None, "Délai dépassé — le serveur ne répond pas."
        return 0, None, "Connexion impossible — vérifiez l'URL du serveur et le réseau."
    except Exception:
        return 0, None, "Connexion impossible — vérifiez l'URL du serveur et le réseau."


def _json(resp) -> Optional[dict]:
    try:
        raw = resp.read()
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def _http_message(code: int, body: Optional[dict], error) -> str:
    if code in (401, 403):
        return "Clé API invalide (GARAGEFLOW_API_KEY) — vérifiez la clé configurée sur le serveur."
    if code == 404:
        return "Route absente sur ce serveur (404) — l'instance ne semble pas à jour."
    if code == 429:
        retry = ""
        try:
            retry = error.headers.get("Retry-After") or ""
        except Exception:
            retry = ""
        return f"Trop de requêtes (rate limit) — réessayez{' dans ' + retry + ' s' if retry else ' dans quelques instants'}."
    if code in (500, 502, 503, 504):
        return f"Serveur indisponible (HTTP {code}) — réessayez plus tard."
    if isinstance(body, dict) and body.get("error"):
        return str(body["error"])
    if isinstance(body, dict) and body.get("message"):
        return str(body["message"])
    return f"Erreur HTTP {code}"


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
    code, body, err = _request(url, api_key, "GET", timeout=timeout)
    if err:
        return False, err
    if code == 200:
        count = ""
        if isinstance(body, dict) and isinstance(body.get("licenses"), list):
            count = f" — {len(body['licenses'])} licence(s) connue(s) du serveur."
        return True, f"Connexion réussie (HTTP 200){count}"
    if code == 403 or code == 401:
        return False, "Clé API invalide (GARAGEFLOW_API_KEY) — vérifiez la clé du serveur."
    return False, _http_message(code, body, None) or f"Réponse inattendue (HTTP {code})"


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
    code, body, err = _request(url, api_key, "POST", {"token": token.strip()})
    if err:
        return False, err
    if code in (200, 201):
        return True, "Licence enregistrée sur le serveur."
    if code == 409:
        return True, "Licence déjà enregistrée sur le serveur."
    if code == 400:
        return False, "Jeton refusé par le serveur (signature ou contenu invalide)."
    return False, _http_message(code, body, None)


def fetch_licenses(server_url: str, api_key: str, timeout: int = DEFAULT_TIMEOUT) -> tuple[bool, list, str]:
    """État serveur des licences : statut, échéance, liaison matérielle, appareils."""
    ok_url, err_url = validate_server_url(server_url)
    if not ok_url:
        return False, [], err_url
    if not (api_key or "").strip():
        return False, [], "Clé API non configurée."
    url = server_url.rstrip("/") + ROUTE_LICENSES
    code, body, err = _request(url, api_key, "GET", timeout=timeout)
    if err:
        return False, [], err
    if code == 200 and isinstance(body, dict) and isinstance(body.get("licenses"), list):
        return True, body["licenses"], ""
    if code in (401, 403):
        return False, [], "Clé API invalide (GARAGEFLOW_API_KEY) — vérifiez la clé du serveur."
    if code == 404:
        return False, [], "Route /api/keygen/licenses absente : instance GarageFlows trop ancienne."
    return False, [], _http_message(code, body, None)


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
    code, body, err = _request(url, api_key, "POST", {"action": action, "reason": reason or ""})
    if err:
        return False, err
    if code == 200:
        note = ""
        if isinstance(body, dict) and body.get("note"):
            note = " " + str(body["note"])
        return True, ("Appareils réinitialisés : sièges libérés." if action == "reset"
                      else "Appareil révoqué.") + note
    if code == 404:
        return False, "Licence ou appareil introuvable sur le serveur."
    return False, _http_message(code, body, None)


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
    code, body, err = _request(url, api_key, "POST", payload)
    if err:
        return False, err
    if code == 200:
        note = ""
        if isinstance(body, dict):
            if body.get("unchanged"):
                return True, "Statut déjà à jour sur le serveur."
            if body.get("note"):
                note = " " + str(body["note"])
        return True, f"Statut « {status} » appliqué sur le serveur.{note}"
    if code == 404:
        detail = ""
        if isinstance(body, dict) and body.get("error"):
            detail = " " + str(body["error"])
        return False, "Licence introuvable sur le serveur (enregistrez-la d'abord)." + detail
    if code == 409:
        return False, (str(body.get("error")) if isinstance(body, dict) and body.get("error")
                       else "Transition refusée par le serveur (machine à états).")
    return False, _http_message(code, body, None)


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
