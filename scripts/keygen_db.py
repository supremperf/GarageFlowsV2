"""
keygen_db.py — GarageFlows Licence DB locale (JSON)
Stockage, révocation, réactivation, recherche et synchronisation des licences générées.

Le fichier est un tableau JSON de fiches. Chaque fiche porte :
  · les identifiants (lid, uuid, cid, type) ;
  · la durée et les dates (duration_days, issued_at, expires_at) ;
  · la liaison matérielle (hwid fourni au moment de la signature, état d'activation
    relevé sur le serveur : activated_at, last_check_at) ;
  · les informations CLIENT complètes (nom, prénom, entreprise, adresse, code
    postal, ville, pays, e-mail, téléphone, informations complémentaires).

Toute lecture tolère les anciennes fiches : les champs absents sont complétés
par `normalize()` plutôt que de faire disparaître une licence déjà vendue.
"""

import json, os, time
from pathlib import Path
from typing import Optional

ROOT_DIR        = Path(__file__).resolve().parent.parent
DB_FILE         = ROOT_DIR / "keys" / "licenses_db.json"
SERVER_CFG_FILE = ROOT_DIR / "keys" / "server_config.json"
AUDIT_FILE      = ROOT_DIR / "keys" / "keygen_audit.log"

# Adresse préremplie de l'instance GarageFlows. Modifiable et persistée dans
# keys/server_config.json — jamais codée en dur ailleurs (une seule source).
DEFAULT_SERVER_URL = "https://app.garageflows.fr"

CLIENT_FIELDS = ("prenom", "nom", "entreprise", "email", "tel",
                 "adresse", "code_postal", "ville", "pays", "infos")


def _load() -> list:
    if not DB_FILE.exists():
        return []
    try:
        data = json.loads(DB_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [normalize(r) for r in data if isinstance(r, dict)]


def _save(records: list) -> None:
    DB_FILE.parent.mkdir(exist_ok=True)
    DB_FILE.write_text(
        json.dumps([normalize(r) for r in records], indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    try:
        os.chmod(DB_FILE, 0o600)
    except Exception:
        pass


def normalize(record: dict) -> dict:
    """Complète une fiche ancienne ou partielle sans jamais rien perdre."""
    r = dict(record or {})
    client = r.get("client") or {}
    full = {field: str(client.get(field, "") or "") for field in CLIENT_FIELDS}
    # Anciennes fiches : « Ville / CP » était un seul champ. On le conserve tel
    # quel dans `ville` et on NE fabrique pas de code postal : une valeur
    # devinée serait fausse sur un document commercial.
    if not full["code_postal"]:
        full["code_postal"] = str(client.get("cp", "") or "")
    if not full["pays"]:
        full["pays"] = str(client.get("pays", "") or "")
    full["infos"] = str(client.get("infos", "") or client.get("notes", "") or "")
    r["client"] = full
    r.setdefault("uuid", "")
    r.setdefault("lid", "")
    r.setdefault("token", "")
    r.setdefault("cid", "")
    r.setdefault("type", "")
    r.setdefault("label", "")
    r.setdefault("status", "active")
    r.setdefault("hwid", "")
    r.setdefault("parent_lid", "")
    r.setdefault("mechanic_name", "")
    r.setdefault("seats", 1)
    r.setdefault("issued_at", "")
    r.setdefault("expires_at", "")
    r.setdefault("duration_days", 0)
    r.setdefault("duration_label", "")
    r.setdefault("bound_hwid", bool(r.get("hwid")))
    r.setdefault("activated_at", "")
    r.setdefault("last_check_at", "")
    r.setdefault("server_synced_at", "")
    r.setdefault("created_at", "")
    r.setdefault("revoked_at", None)
    return r


def add_license(info: dict, client: dict) -> None:
    """Ajoute une nouvelle licence avec les infos client complètes."""
    records = _load()
    records.insert(0, normalize({
        "lid":        info["lid"],
        "uuid":       info.get("uuid", ""),
        "token":      info["token"],
        "cid":        info["cid"],
        "type":       info["type"],
        "label":      info.get("label") or "",
        "issued_at":  info["issued_at"],
        "expires_at": info["expires_at"],
        "issued_at_iso":  info.get("issued_at_iso", ""),
        "expires_at_iso": info.get("expires_at_iso", ""),
        "seats":      info["seats"],
        "hwid":       info.get("hwid") or "",
        "bound_hwid": info.get("bound_hwid", bool(info.get("hwid"))),
        "duration_days":  info.get("duration_days", 0),
        "duration_label": info.get("duration_label", ""),
        "parent_lid":    info.get("parent_lid") or "",
        "mechanic_name": info.get("mechanic_name") or "",
        "status":     "active",
        "client": client,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "revoked_at": None,
    }))
    _save(records)


def update_license(lid: str, patch: dict) -> bool:
    """Met à jour des champs d'une fiche existante (synchronisation serveur, HWID…)."""
    if not lid:
        return False
    records = _load()
    for r in records:
        if r.get("lid") == lid:
            for key, value in (patch or {}).items():
                if key == "client" and isinstance(value, dict):
                    merged = dict(r.get("client") or {})
                    merged.update(value)
                    r["client"] = merged
                else:
                    r[key] = value
            _save(records)
            return True
    return False


def list_licenses() -> list:
    return _load()


def list_children(parent_lid: str) -> list:
    """Retourne les clés mécanicien rattachées à une licence garage (par lid parent)."""
    return [
        r for r in _load()
        if r.get("type") == "mechanic" and r.get("parent_lid") == parent_lid
    ]


def garage_licenses() -> list:
    """Retourne les licences non-mechanic (garage), pour les sélecteurs."""
    return [r for r in _load() if r.get("type") != "mechanic"]


def set_status(lid: str, status: str) -> bool:
    """Passe le statut d'une licence à 'active', 'revoked' ou 'suspended'."""
    records = _load()
    for r in records:
        if r["lid"] == lid:
            r["status"] = status
            r["revoked_at"] = time.strftime("%Y-%m-%dT%H:%M:%S") if status == "revoked" else None
            _save(records)
            return True
    return False


def delete_license(lid: str) -> bool:
    records = _load()
    before  = len(records)
    records = [r for r in records if r["lid"] != lid]
    if len(records) < before:
        _save(records)
        return True
    return False


def get_license(lid: str) -> Optional[dict]:
    for r in _load():
        if r["lid"] == lid:
            return r
    return None


def get_by_uuid(uuid_value: str) -> Optional[dict]:
    needle = (uuid_value or "").strip().lower()
    if not needle:
        return None
    for r in _load():
        if (r.get("uuid") or "").lower() == needle:
            return r
    return None


def search(query: str) -> list:
    """Recherche large : identifiants ET informations client.

    Couvre nom, prénom, entreprise, e-mail, téléphone, ville, code postal, pays,
    ID client, étiquette, LID, UUID et HWID. Une recherche sur un identifiant
    long (LID/UUID/HWID) fonctionne aussi sur un préfixe.
    """
    return search_licenses(query)


def search_licenses(query: str, records: list | None = None) -> list:
    q = (query or "").strip().lower()
    rows = _load() if records is None else [normalize(r) for r in records]
    if not q:
        return rows
    out = []
    for r in rows:
        c = r.get("client") or {}
        haystack = " ".join([
            str(r.get("cid", "")), str(r.get("label", "")), str(r.get("lid", "")),
            str(r.get("uuid", "")), str(r.get("hwid", "")), str(r.get("type", "")),
            # La CLÉ elle-même est cherchable : un client qui rappelle en
            # dictant sa licence est le cas le plus fréquent au support.
            str(r.get("token", "")),
            str(c.get("nom", "")), str(c.get("prenom", "")), str(c.get("entreprise", "")),
            str(c.get("email", "")), str(c.get("tel", "")), str(c.get("adresse", "")),
            str(c.get("code_postal", "")), str(c.get("ville", "")), str(c.get("pays", "")),
            str(c.get("infos", "")),
        ]).lower()
        if q in haystack:
            out.append(r)
    return out


# Libellés d'interface → type interne. « ENTREPRISE » est le libellé commercial
# du type `enterprise` : sans cette table, le filtre ne trouvait jamais rien et
# l'utilisateur voyait une liste vide sans comprendre pourquoi.
TYPE_ALIASES = {
    "premium": "premium",
    "entreprise": "enterprise",
    "enterprise": "enterprise",
    "mécanicien": "mechanic",
    "mecanicien": "mechanic",
    "mechanic": "mechanic",
    "standard": "trial",
    "trial": "trial",
    "admin": "admin",
}


def filter_licenses(records: list, type_filter: str = "Tous", status_filter: str = "Tous") -> list:
    """Filtres « type » (Tous / PREMIUM / ENTREPRISE / Garages / Mécaniciens) et statut."""
    rows = [normalize(r) for r in records]
    tf = (type_filter or "Tous").strip()
    sf = (status_filter or "Tous").strip()
    out = []
    for r in rows:
        is_mechanic = r.get("type") == "mechanic"
        if tf not in ("Tous", ""):
            tf_low = tf.lower()
            if tf_low == "garages":
                if is_mechanic:
                    continue
            elif tf_low in ("mécaniciens", "mecaniciens"):
                if not is_mechanic:
                    continue
            else:
                attendu = TYPE_ALIASES.get(tf_low, tf_low)
                if str(r.get("type", "")).lower() != attendu:
                    continue
        if sf not in ("Tous", ""):
            if str(r.get("status", "")).lower() != sf.lower():
                continue
        out.append(r)
    return out


def sort_licenses(records: list, key: str = "created_at", descending: bool = True) -> list:
    """Tri par date de création ou d'expiration (les deux sont ISO → tri sûr)."""
    rows = [normalize(r) for r in records]
    if key == "expires_at":
        def _k(r):
            return r.get("expires_at_iso") or r.get("expires_at") or ""
    elif key == "client":
        def _k(r):
            c = r.get("client") or {}
            return (f"{c.get('nom','')} {c.get('prenom','')}".strip()
                    or str(r.get("label", ""))).lower()
    else:
        def _k(r):
            return r.get("created_at") or r.get("issued_at_iso") or ""
    return sorted(rows, key=_k, reverse=descending)


def is_expired(record: dict, now: float | None = None) -> bool:
    """Expiration calculée sur la date du poste (le serveur reste l'autorité)."""
    iso = record.get("expires_at_iso") or ""
    if iso:
        try:
            import datetime as _dt
            exp = _dt.datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=_dt.timezone.utc)
            ref = _dt.datetime.fromtimestamp(now if now else time.time(), tz=_dt.timezone.utc)
            return exp < ref
        except Exception:
            pass
    date = record.get("expires_at") or ""
    return bool(date) and date < time.strftime("%Y-%m-%d", time.gmtime(now or time.time()))


def effective_status(record: dict, now: float | None = None) -> str:
    """Statut affiché : révoqué/suspendu priment, sinon expirée si échéance passée."""
    status = record.get("status") or "active"
    if status in ("revoked", "suspended"):
        return status
    return "expired" if is_expired(record, now) else status


# ── Server config (URL + API key for remote operations) ──────────────────────

def load_server_config() -> dict:
    cfg = {"url": DEFAULT_SERVER_URL, "api_key": ""}
    if SERVER_CFG_FILE.exists():
        try:
            data = json.loads(SERVER_CFG_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                cfg["url"] = str(data.get("url") or DEFAULT_SERVER_URL)
                cfg["api_key"] = str(data.get("api_key") or "")
        except Exception:
            pass
    return cfg


def save_server_config(url: str, api_key: str) -> None:
    SERVER_CFG_FILE.parent.mkdir(exist_ok=True)
    SERVER_CFG_FILE.write_text(
        json.dumps({"url": (url or "").strip().rstrip("/"), "api_key": (api_key or "").strip()},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    # Durcit les permissions (fichier contenant la clé API), comme pour private.pem.
    # Sur Windows le chmod POSIX est sans effet réel : on ignore toute erreur.
    try:
        os.chmod(SERVER_CFG_FILE, 0o600)
    except Exception:
        pass


# ── Journal d'audit local (keys/keygen_audit.log) ────────────────────────────

def audit_log(action: str, lid: str = "", detail: str = "") -> None:
    """Journalise un événement dans keys/keygen_audit.log.
    Format : \"ISO8601 | action | lid tronqué à 8 chars + '…' | detail\".
    JAMAIS de token complet ni de données client dans ce journal."""
    ts       = time.strftime("%Y-%m-%dT%H:%M:%S")
    lid_safe = (lid[:8] + "…") if lid else ""
    line     = f"{ts} | {action} | {lid_safe} | {detail}\n"
    try:
        AUDIT_FILE.parent.mkdir(exist_ok=True)
        with AUDIT_FILE.open("a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass  # le journal ne doit jamais bloquer une opération
