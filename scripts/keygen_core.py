"""
keygen_core.py — GarageFlows Licence ECC P-256
Gestion des clés, signature et vérification ECDSA-SHA256.
"""

import os, json, base64, uuid, time, hashlib, platform, socket, subprocess, re
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
LICENSE_TYPES = ["trial", "premium", "enterprise", "admin", "mechanic"]
TYPE_LABELS   = {
    "trial":      "Standard",
    "premium":    "Premium",
    "enterprise": "Pro / Entreprise",
    "admin":      "Admin",
    "mechanic":   "Mécanicien",
}

# ── Offre commerciale du keygen ──────────────────────────────────────────────
# Seules deux offres sont vendues depuis le keygen. Les types `trial`, `admin`
# et `mechanic` restent dans le format de jeton (compatibilité du parc installé
# et des outils historiques) mais ne sont PLUS proposés à la génération :
# une licence « mécanicien » se crée via le mode dédié, jamais via ce choix.
KEYGEN_OFFER_TYPES = ["premium", "enterprise"]
KEYGEN_TYPE_LABELS = {
    "premium":    "PREMIUM",
    "enterprise": "ENTREPRISE",
}

# ── Durées ───────────────────────────────────────────────────────────────────
# Exigence : une durée se saisit en JOURS (1, 7, 30, 90, 180, 365, 730…), pas
# seulement en années. Le mois et l'année restent disponibles comme raccourcis
# de saisie, convertis en jours selon une base EXPLICITE et documentée
# (1 mois = 30 jours, 1 an = 365 jours) — aucune conversion calendaire implicite
# qui produirait une expiration différente de celle annoncée au client.
DURATION_UNITS = ("jours", "mois", "annees")
DAYS_PER_UNIT  = {"jours": 1, "mois": 30, "annees": 365}
DURATION_UNIT_LABELS = {"jours": "jour(s)", "mois": "mois", "annees": "an(s)"}
DAY_SECONDS = 24 * 3600


def duration_days(value, unit) -> int:
    """Convertit (valeur, unité) en nombre ENTIER de jours. Lève si invalide."""
    try:
        amount = int(str(value).strip())
    except (TypeError, ValueError):
        raise ValueError("Durée invalide : la valeur doit être un nombre entier.") from None
    unit = (unit or "").strip()
    if unit not in DAYS_PER_UNIT:
        raise ValueError(f"Unité de durée inconnue : {unit!r}. Attendu : {', '.join(DURATION_UNITS)}.")
    if amount < 1:
        raise ValueError("Durée invalide : la valeur doit être au moins 1.")
    if amount > 36500:
        raise ValueError("Durée invalide : 36 500 jours (100 ans) au maximum.")
    return amount * DAYS_PER_UNIT[unit]


def duration_label(days: int) -> str:
    """Libellé lisible d'une durée exprimée en jours."""
    days = int(days)
    if days % 365 == 0 and days >= 365:
        n = days // 365
        return f"{n} an(s) ({days} jours)"
    if days % 30 == 0 and days >= 30:
        n = days // 30
        return f"{n} mois ({days} jours)"
    return f"{days} jour(s)"

def b64u_enc(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def b64u_dec(s: str) -> bytes:
    pad = (4 - len(s) % 4) % 4
    return base64.urlsafe_b64decode(s + "=" * pad)

_HEADER_B64 = b64u_enc(json.dumps(HEADER, separators=(",", ":")).encode())


# ── Liaison matérielle (HWID) ────────────────────────────────────────────────
#
# DEUX formats sont acceptés par le vérificateur de l'application
# (`src/lib/license/verify.ts`) : v0 (64 hex) et v1 canonique
# (`HWID1-<64 hex>`). Un HWID quelconque — texte libre, guillemets, espaces
# internes, valeur tronquée — est SIGNÉ sans erreur par le générateur, puis
# REFUSÉ à l'activation : le garage voit « Licence invalide ou modifiée » sur
# une licence qui vient d'être créée. On refuse donc ici, AVANT de signer.
_HWID_V0_RE = re.compile(r"^[0-9a-f]{64}$")
_HWID_V1_RE = re.compile(r"^HWID1-[0-9a-f]{64}$")


def normalize_license_hwid(value) -> str:
    """Normalisation identique au vérificateur, en conservant la forme canonique.

    - v0 : espaces de bord retirés, hexadécimal en minuscules ;
    - v1 : préfixe « HWID1- » conservé tel quel, digest en minuscules
      (`verifyHwid` normalise les deux côtés, la casse du préfixe est donc
      indifférente à la vérification, mais le jeton reste lisible).
    """
    raw = str(value or "").strip()
    if raw[:6].lower() == "hwid1-":
        return "HWID1-" + raw[6:].lower()
    return raw.lower()


def is_valid_license_hwid(value) -> bool:
    """Le HWID est-il au format accepté par l'application (v0 ou v1) ?"""
    normalized = normalize_license_hwid(value)
    return bool(_HWID_V0_RE.match(normalized) or _HWID_V1_RE.match(normalized))


def _checked_hwid(hwid):
    """Valide et normalise un HWID avant signature ; vide/None = non lié."""
    if hwid is None:
        return None
    normalized = normalize_license_hwid(hwid)
    if not normalized:
        return None
    if not is_valid_license_hwid(normalized):
        raise ValueError(
            "HWID invalide : attendu 64 caractères hexadécimaux (v0) ou "
            "'HWID1-' suivi de 64 hexadécimaux (v1). "
            "Copier l'empreinte produite par le POSTE CLIENT — l'empreinte "
            "calculée localement par le keygen est différente et serait refusée."
        )
    return normalized


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
        raise FileNotFoundError(f"Clé privée introuvable: {PRIV_FILE}\nRestaurer la clé privée autorisée ; ne pas initialiser pour contourner un incident.")
    pw = passphrase.encode() if passphrase else None
    return serialization.load_pem_private_key(
        PRIV_FILE.read_bytes(), password=pw, backend=default_backend()
    )


def load_checked_private_key(passphrase: str = ""):
    """GUI signing boundary: fail before minting/persisting if any local anchor differs.

    Does not attest a remote deployment. Never regenerate keys to bypass this check.
    """
    from keygen_trust import check_key_match
    key = load_private_key(passphrase)
    check_key_match(key, ROOT_DIR)
    return key


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


def _resolve_duration(years, duration) -> int:
    """Durée totale en jours. `duration` (dict {value, unit}) prime sur `years`.

    `years` reste accepté pour la compatibilité des outils historiques
    (scripts/keygen.py --years) ; il est converti en jours sur la même base
    qu'avant (1 an = 365 jours), donc aucune licence existante ne change.
    """
    if duration:
        return duration_days(duration.get("value"), duration.get("unit"))
    try:
        years = int(years)
    except (TypeError, ValueError):
        raise ValueError("Durée invalide : `years` doit être un nombre entier.") from None
    # `years` N'EST PAS borné volontairement : les fixtures de test signent des
    # licences déjà expirées avec `years=-1` (comportement historique conservé —
    # c'est le seul moyen de produire un jeton périmé signé par la vraie clé).
    # Seule la saisie GUI (`duration`) impose 1 jour minimum.
    return years * 365


def make_license(priv_key, customer_id: str, license_type: str,
                 years: int = 1, seats: int = 1,
                 hwid: str = None, label: str = None,
                 duration: dict = None, enforce_offer: bool = False) -> dict:
    """Signe une licence garage.

    duration : {"value": int, "unit": "jours"|"mois"|"annees"} — durée exacte en
    jours. `enforce_offer=True` restreint le type aux offres commerciales du
    keygen (PREMIUM / ENTREPRISE) ; laissé à False pour les outils historiques.
    """
    if license_type == "mechanic":
        raise ValueError("Utilisez make_mechanic_license pour les licences mécanicien.")
    if enforce_offer and license_type not in KEYGEN_OFFER_TYPES:
        raise ValueError(
            "Type commercial invalide. Seules les offres PREMIUM et ENTREPRISE "
            f"sont proposées : {KEYGEN_OFFER_TYPES}"
        )
    if license_type not in LICENSE_TYPES:
        raise ValueError(f"Type invalide. Choisir parmi: {LICENSE_TYPES}")

    hwid = _checked_hwid(hwid)
    days = _resolve_duration(years, duration)

    now = int(time.time())
    exp = now + days * DAY_SECONDS
    lid = str(uuid.uuid4())
    # UUID d'identification DISTINCT du LID : même format, autre valeur. Il est
    # SIGNÉ (champ `u` du filigrane) pour rester infalsifiable, et sert de
    # référence de dossier côté éditeur quand le LID est déjà publié.
    luid = str(uuid.uuid4())

    wm_raw = {"c": customer_id, "t": now, "r": os.urandom(6).hex(), "l": label or "", "u": luid}
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
        "uuid":       luid,
        "cid":        customer_id,
        "type":       license_type,
        "issued_at":  time.strftime("%Y-%m-%d", time.gmtime(now)),
        "expires_at": time.strftime("%Y-%m-%d", time.gmtime(exp)),
        "issued_at_iso":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "expires_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(exp)),
        "seats":      seats,
        "hwid":       hwid,
        "label":      label,
        "duration_days":   days,
        "duration_label":  duration_label(days),
        "bound_hwid":      bool(hwid),
    }


def make_mechanic_license(priv_key, parent_lid: str, customer_id: str,
                          years: int = 1, mechanic_name: str | None = None,
                          hwid: str | None = None, label: str | None = None,
                          duration: dict = None) -> dict:
    """Génère une licence mécanicien (typ='mechanic', ver='2.1', seats=1)
    liée à une licence garage parente via 'plid'. 'mn' est un indice
    d'attribution optionnel (nom du mécanicien)."""
    if not parent_lid or not str(parent_lid).strip():
        raise ValueError("parent_lid est obligatoire pour une licence mécanicien.")

    hwid = _checked_hwid(hwid)
    days = _resolve_duration(years, duration)

    now = int(time.time())
    exp = now + days * DAY_SECONDS
    lid = str(uuid.uuid4())
    luid = str(uuid.uuid4())

    wm_raw = {"c": customer_id, "t": now, "r": os.urandom(6).hex(), "l": label or "", "u": luid}
    wm     = b64u_enc(json.dumps(wm_raw, separators=(",", ":")).encode())

    payload = {
        "lid": lid, "cid": customer_id, "typ": "mechanic",
        "iss": now, "exp": exp, "seats": 1,
        "wm": wm, "ver": "2.1",
        "plid": parent_lid,
    }
    if mechanic_name:
        payload["mn"] = mechanic_name
    if hwid:
        payload["hwid"] = hwid

    return {
        "token":         _sign(priv_key, payload),
        "lid":           lid,
        "uuid":          luid,
        "cid":           customer_id,
        "type":          "mechanic",
        "issued_at":     time.strftime("%Y-%m-%d", time.gmtime(now)),
        "expires_at":    time.strftime("%Y-%m-%d", time.gmtime(exp)),
        "issued_at_iso":  time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "expires_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(exp)),
        "seats":         1,
        "hwid":          hwid,
        "label":         label,
        "parent_lid":    parent_lid,
        "mechanic_name": mechanic_name,
        "duration_days":   days,
        "duration_label":  duration_label(days),
        "bound_hwid":      bool(hwid),
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


def is_mechanic_payload(payload) -> bool:
    """Retourne True si le payload décodé est celui d'une licence mécanicien."""
    return isinstance(payload, dict) and payload.get("typ") == "mechanic"


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
    """Empreinte LOCALE du keygen — DIAGNOSTIC uniquement, jamais une liaison.

    ATTENTION : ce n'est PAS l'empreinte calculée par l'application.

    Electron (`electron/main.js` / `src/lib/license/hwid.ts`) part de
    `os.cpus()[0].model`, `os.platform()-os.arch()` (ex. « win32-x64 ») et
    `os.networkInterfaces()` ; cette fonction Python part de
    `platform.processor()`, `platform.system()-platform.machine()` (ex.
    « Windows-AMD64 ») et `uuid.getnode()` (qui peut être aléatoire quand aucune
    MAC n'est disponible). Les deux valeurs DIFFÈRENT sur la même machine, au
    minimum par la chaîne de plateforme. Une licence signée avec cette valeur est
    donc refusée à l'activation (« Licence invalide ou modifiée »).

    Le HWID d'une licence DOIT être produit par le POSTE CLIENT (HWID V1
    canonique) puis collé/importé dans le keygen, ou fourni par `--bind-hwid`.
    Conservé ici pour les fixtures et le diagnostic local uniquement.
    """
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
