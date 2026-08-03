"""
keygen_db.py — GarageFlow Licence DB locale (JSON)
Stockage, révocation, réactivation des licences générées.
"""

import json, os, time
from pathlib import Path
from typing import Optional

ROOT_DIR        = Path(__file__).resolve().parent.parent
DB_FILE         = ROOT_DIR / "keys" / "licenses_db.json"
SERVER_CFG_FILE = ROOT_DIR / "keys" / "server_config.json"


def _load() -> list:
    if not DB_FILE.exists():
        return []
    try:
        return json.loads(DB_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(records: list) -> None:
    DB_FILE.parent.mkdir(exist_ok=True)
    DB_FILE.write_text(
        json.dumps(records, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def add_license(info: dict, client: dict) -> None:
    """Ajoute une nouvelle licence avec les infos client."""
    records = _load()
    records.insert(0, {
        "lid":        info["lid"],
        "token":      info["token"],
        "cid":        info["cid"],
        "type":       info["type"],
        "label":      info.get("label") or "",
        "issued_at":  info["issued_at"],
        "expires_at": info["expires_at"],
        "seats":      info["seats"],
        "hwid":       info.get("hwid") or "",
        "status":     "active",
        "client": {
            "prenom":    client.get("prenom", ""),
            "nom":       client.get("nom", ""),
            "entreprise":client.get("entreprise", ""),
            "email":     client.get("email", ""),
            "tel":       client.get("tel", ""),
            "adresse":   client.get("adresse", ""),
            "ville":     client.get("ville", ""),
        },
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "revoked_at": None,
    })
    _save(records)


def list_licenses() -> list:
    return _load()


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


def search(query: str) -> list:
    q = query.lower()
    return [
        r for r in _load()
        if q in r.get("cid", "").lower()
        or q in r.get("label", "").lower()
        or q in r["client"].get("nom", "").lower()
        or q in r["client"].get("entreprise", "").lower()
        or q in r["client"].get("email", "").lower()
    ]


# ── Server config (URL + API key for remote revocation) ──────────────────────

def load_server_config() -> dict:
    if not SERVER_CFG_FILE.exists():
        return {"url": "", "api_key": ""}
    try:
        return json.loads(SERVER_CFG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"url": "", "api_key": ""}


def save_server_config(url: str, api_key: str) -> None:
    SERVER_CFG_FILE.parent.mkdir(exist_ok=True)
    SERVER_CFG_FILE.write_text(
        json.dumps({"url": url.strip().rstrip("/"), "api_key": api_key.strip()},
                   indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    # Durcit les permissions (fichier contenant la clé API), comme pour private.pem.
    # Sur Windows le chmod POSIX est sans effet réel : on ignore toute erreur.
    try:
        os.chmod(SERVER_CFG_FILE, 0o600)
    except Exception:
        pass
