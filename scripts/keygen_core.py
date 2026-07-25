"""
keygen_core.py — GarageFlow Licence ECC P-256
Gestion des clés, signature et vérification ECDSA-SHA256.
"""

import os, json, base64, uuid, time, hashlib, platform, socket, subprocess
from pathlib import Path

try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.backends import default_backend
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

ROOT_DIR  = Path(__file__).resolve().parent.parent
KEYS_DIR  = ROOT_DIR / "keys"
PRIV_FILE = KEYS_DIR / "private.pem"
PUB_FILE  = KEYS_DIR / "public.pem"

HEADER        = {"alg": "ES256", "typ": "GF-LIC", "v": 2}
LICENSE_TYPES = ["trial", "premium", "enterprise", "admin"]
TYPE_LABELS   = {
    "trial":      "Standard",
    "premium":    "Premium",
    "enterprise": "Pro / Entreprise",
    "admin":      "Admin",
}

def b64u_enc(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def b64u_dec(s: str) -> bytes:
    pad = (4 - len(s) % 4) % 4
    return base64.urlsafe_b64decode(s + "=" * pad)

_HEADER_B64 = b64u_enc(json.dumps(HEADER, separators=(",", ":")).encode())


# ── Clés ─────────────────────────────────────────────────────────────────────

def keys_exist() -> bool:
    return PRIV_FILE.exists() and PUB_FILE.exists()


def generate_keys(passphrase: str = "") -> dict:
    """Génère une nouvelle paire de clés ECC P-256. Retourne les lignes de la clé publique."""
    if not HAS_CRYPTO:
        raise RuntimeError("Module 'cryptography' introuvable. Lancez: pip install cryptography")

    KEYS_DIR.mkdir(exist_ok=True)
    priv = ec.generate_private_key(ec.SECP256R1(), default_backend())

    enc = (serialization.BestAvailableEncryption(passphrase.encode())
           if passphrase else serialization.NoEncryption())

    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=enc,
    )
    PRIV_FILE.write_bytes(priv_pem)
    try:
        PRIV_FILE.chmod(0o600)
    except Exception:
        pass

    pub_pem = priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    PUB_FILE.write_bytes(pub_pem)

    lines = [l for l in pub_pem.decode().strip().splitlines()
             if not l.startswith("-----")]
    return {"pub_lines": lines, "pub_pem": pub_pem.decode()}


def load_private_key(passphrase: str = ""):
    if not PRIV_FILE.exists():
        raise FileNotFoundError(f"Clé privée introuvable: {PRIV_FILE}\nLancez d'abord 'Initialiser les clés'.")
    pw = passphrase.encode() if passphrase else None
    return serialization.load_pem_private_key(
        PRIV_FILE.read_bytes(), password=pw, backend=default_backend()
    )


def load_public_key():
    if not PUB_FILE.exists():
        raise FileNotFoundError(f"Clé publique introuvable: {PUB_FILE}")
    return serialization.load_pem_public_key(PUB_FILE.read_bytes(), backend=default_backend())


# ── Signature ─────────────────────────────────────────────────────────────────

def _sign(priv_key, payload: dict) -> str:
    payload_b64   = b64u_enc(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{_HEADER_B64}.{payload_b64}".encode()
    sig           = priv_key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    return f"GF2.{_HEADER_B64}.{payload_b64}.{b64u_enc(sig)}"


def make_license(priv_key, customer_id: str, license_type: str,
                 years: int = 1, seats: int = 1,
                 hwid: str = None, label: str = None) -> dict:
    if license_type not in LICENSE_TYPES:
        raise ValueError(f"Type invalide. Choisir parmi: {LICENSE_TYPES}")

    now = int(time.time())
    exp = now + years * 365 * 24 * 3600
    lid = str(uuid.uuid4())

    wm_raw = {"c": customer_id, "t": now, "r": os.urandom(6).hex(), "l": label or ""}
    wm     = b64u_enc(json.dumps(wm_raw, separators=(",", ":")).encode())

    payload = {
        "lid": lid, "cid": customer_id, "typ": license_type,
        "iss": now, "exp": exp, "seats": seats,
        "wm": wm, "ver": "2.0",
    }
    if hwid:
        payload["hwid"] = hwid

    return {
        "token":      _sign(priv_key, payload),
        "lid":        lid,
        "cid":        customer_id,
        "type":       license_type,
        "issued_at":  time.strftime("%Y-%m-%d", time.gmtime(now)),
        "expires_at": time.strftime("%Y-%m-%d", time.gmtime(exp)),
        "seats":      seats,
        "hwid":       hwid,
        "label":      label,
    }


# ── Vérification ──────────────────────────────────────────────────────────────

def verify_token(token: str) -> dict | None:
    """Retourne le payload décodé si valide, sinon None."""
    parts = token.strip().split(".")
    if len(parts) != 4 or parts[0] != "GF2":
        return None
    _, header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode()
    try:
        load_public_key().verify(b64u_dec(sig_b64), signing_input, ec.ECDSA(hashes.SHA256()))
    except Exception:
        return None
    try:
        return json.loads(b64u_dec(payload_b64).decode())
    except Exception:
        return None


# ── HWID ─────────────────────────────────────────────────────────────────────

def _get_disk_serial() -> str:
    """Récupère le numéro de série du premier disque dur (Windows uniquement)."""
    if platform.system() != "Windows":
        return "unknown-disk"
    try:
        out = subprocess.check_output(
            ["wmic", "diskdrive", "get", "serialnumber", "/format:list"],
            timeout=3, stderr=subprocess.DEVNULL
        ).decode(errors="ignore")
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("SerialNumber="):
                serial = line.replace("SerialNumber=", "").strip()
                if serial:
                    return serial
    except Exception:
        pass
    return "unknown-disk"


def get_hwid() -> str:
    """Empreinte matérielle SHA-256 : CPU + MAC + plateforme + hostname + disque."""
    import uuid as _uuid
    cpu      = platform.processor() or platform.machine() or "unknown"
    mac      = ":".join(
        f"{((_uuid.getnode() >> (5 - i) * 8) & 0xff):02x}" for i in range(6)
    )
    plat     = f"{platform.system()}-{platform.machine()}"
    hostname = hashlib.sha256(socket.gethostname().encode()).hexdigest()[:16]
    disk     = _get_disk_serial()
    combined = "||GF2-HWID-SALT||".join([cpu, mac, plat, hostname, disk])
    return hashlib.sha256(combined.encode()).hexdigest()
