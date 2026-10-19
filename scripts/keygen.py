"""
GarageFlows License Keygen v2 — ECC P-256 / ECDSA-SHA256
=========================================================

Security design:
  - Asymmetric cryptography (ECDSA with NIST P-256 / secp256r1)
  - Only the private key can CREATE licenses — anyone can VERIFY them
  - Licenses are signed JWT-like tokens:  GF2.<header>.<payload>.<sig>
  - Watermark: each license embeds an opaque blob identifying the customer,
    allowing forensic tracing if a cracked license appears online
  - Hardware binding: optional HWID field locks a license to one machine
  - Expiry + type enforcement (trial / premium / enterprise / admin)

Usage (Windows — run from project root):
  python scripts\keygen.py --init                                   # First time: generate key pair
  python scripts\keygen.py --admin                                  # Generate admin license
  python scripts\keygen.py --gen --customer CUST-001                # Single user license
  python scripts\keygen.py --gen --customer CUST-001 --type trial --years 1
  python scripts\keygen.py --batch 10 --type premium --years 2      # Bulk generation
  python scripts\keygen.py --gen-mechanic --parent-lid <LID> --count 3 --names "A,B,C"
                                                                    # Mechanic keys for a garage
  python scripts\keygen.py --verify <token>                         # Verify any token
  python scripts\keygen.py --hwid                                   # LOCAL keygen fingerprint (NOT the app HWID)

Requirements (run once):
  pip install cryptography
"""

import os, sys, json, base64, uuid, time, hashlib, argparse, getpass, platform
from pathlib import Path

# ── Dependency check ───────────────────────────────────────────────────────────
try:
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.backends import default_backend
except ImportError:
    print("Missing dependency. Install with:  pip install cryptography")
    sys.exit(1)

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT_DIR  = Path(__file__).resolve().parent.parent
KEYS_DIR  = ROOT_DIR / "keys"
PRIV_FILE = KEYS_DIR / "private.pem"
PUB_FILE  = KEYS_DIR / "public.pem"

# ── Local modules (mechanic licenses + local DB + audit) ───────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parent))
import keygen_core
import keygen_db

# ── Token constants ────────────────────────────────────────────────────────────
HEADER        = {"alg": "ES256", "typ": "GF-LIC", "v": 2}
LICENSE_TYPES = frozenset(["trial", "premium", "enterprise", "admin"])

# ── Base64url helpers ──────────────────────────────────────────────────────────
def b64u_enc(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def b64u_dec(s: str) -> bytes:
    pad = (4 - len(s) % 4) % 4
    return base64.urlsafe_b64decode(s + "=" * pad)

_HEADER_B64 = b64u_enc(json.dumps(HEADER, separators=(",", ":")).encode())

# ── Key management ─────────────────────────────────────────────────────────────
def cmd_init(passphrase):
    """Create the FIRST key pair of a new licence authority — never a replacement.

    An existing keys/private.pem may be the production issuer key: overwriting
    it would make every licence ever signed unverifiable and is irreversible.
    Both files are therefore created exclusively ('xb'); an existing file aborts
    the command without touching anything. A rotation is an operator decision
    (docs/VERIFICATION_CLE_EMETTRICE.md), not a side effect of --init.
    """
    KEYS_DIR.mkdir(exist_ok=True)
    existing = [p for p in (PRIV_FILE, PUB_FILE) if p.exists()]
    if existing:
        print("\nRefus : une autorite de licence existe deja :")
        for p in existing:
            print(f"  - {p}")
        print("--init ne remplace JAMAIS une cle (la cle privee peut etre celle de production).")
        print("Verifier la correspondance : python scripts/keygen_trust.py --verify-key-match")
        sys.exit(2)

    priv = ec.generate_private_key(ec.SECP256R1(), default_backend())
    enc  = (serialization.BestAvailableEncryption(passphrase.encode())
            if passphrase else serialization.NoEncryption())

    priv_pem = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=enc,
    )
    pub_pem = priv.public_key().public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    with open(PRIV_FILE, "xb") as fh:
        fh.write(priv_pem)
    try:
        PRIV_FILE.chmod(0o600)
    except Exception:
        pass
    with open(PUB_FILE, "xb") as fh:
        fh.write(pub_pem)

    print("\n" + "="*60)
    print("  ECC P-256 key pair generated")
    print("="*60)
    print(f"  Private key : {PRIV_FILE}")
    print(f"  Public key  : {PUB_FILE}")
    print()
    print("  CRITICAL — keep private.pem PRIVATE:")
    print("  • keys/ is git-ignored: never commit private.pem to any repository")
    print("  • Back it up in a secure offline location")
    print()
    # Ne JAMAIS recopier les lignes a la main : la cle publique est ancree a TROIS
    # endroits (electron/main.js `_PK`, src/lib/license/public-key.ts `_LINES`,
    # REFERENCE_FP du test de coherence) et une copie partielle bloque
    # `npm run dist` (« Public anchors disagree »). Seul keys:sync les deplace
    # ensemble, apres approbation de la nouvelle autorite par l'exploitant.
    print("  Nouvelle autorite = les licences existantes ne seront plus valides.")
    print("  Apres approbation, propager la cle PUBLIQUE a tous les ancrages :")
    print("    npm run keys:sync")
    print("    npm run keys:check")
    print("  Ne copiez aucun tableau a la main.")
    print("\n" + "="*60 + "\n")


def _load_private(passphrase=None):
    if not PRIV_FILE.exists():
        print(f"Private key not found: {PRIV_FILE}")
        print("Run:  python scripts/keygen.py --init")
        sys.exit(1)
    pw = passphrase.encode() if passphrase else None
    return serialization.load_pem_private_key(
        PRIV_FILE.read_bytes(), password=pw, backend=default_backend()
    )

def _load_public():
    if not PUB_FILE.exists():
        print(f"Public key not found: {PUB_FILE}")
        sys.exit(1)
    return serialization.load_pem_public_key(PUB_FILE.read_bytes(), backend=default_backend())

# ── License signing ────────────────────────────────────────────────────────────
def _sign(priv_key, payload: dict) -> str:
    payload_b64   = b64u_enc(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{_HEADER_B64}.{payload_b64}".encode()
    sig           = priv_key.sign(signing_input, ec.ECDSA(hashes.SHA256()))
    return f"GF2.{_HEADER_B64}.{payload_b64}.{b64u_enc(sig)}"


def make_license(priv_key, customer_id: str, license_type: str,
                 years=1, seats=1, hwid=None, label=None) -> dict:
    if license_type not in LICENSE_TYPES:
        raise ValueError(f"Invalid type. Choose from: {sorted(LICENSE_TYPES)}")

    if hwid is not None:
        hwid = keygen_core.normalize_license_hwid(hwid)
        if not keygen_core.is_valid_license_hwid(hwid):
            raise ValueError(
                "HWID invalide : attendu 64 hex (v0) ou 'HWID1-' + 64 hex (v1). "
                "Utiliser l'empreinte produite par le poste client (--bind-hwid)."
            )

    now = int(time.time())
    exp = now + years * 365 * 24 * 3600

    # Watermark: opaque forensic marker. Decode it later to identify leaks.
    wm_raw = {"c": customer_id, "t": now, "r": os.urandom(6).hex(), "l": label or ""}
    wm     = b64u_enc(json.dumps(wm_raw, separators=(",", ":")).encode())

    payload = {
        "lid":   str(uuid.uuid4()),
        "cid":   customer_id,
        "typ":   license_type,
        "iss":   now,
        "exp":   exp,
        "seats": seats,
        "wm":    wm,
        "ver":   "2.0",
    }
    if hwid:
        payload["hwid"] = hwid

    return {
        "token":      _sign(priv_key, payload),
        "lid":        payload["lid"],
        "cid":        customer_id,
        "type":       license_type,
        "issued_at":  time.strftime("%Y-%m-%d", time.gmtime(now)),
        "expires_at": time.strftime("%Y-%m-%d", time.gmtime(exp)),
        "seats":      seats,
        "hwid":       hwid,
        "label":      label,
    }

# ── Mechanic license generation ────────────────────────────────────────────────
DEFAULT_MAX_MECHANIC = 20

def max_mechanic_count() -> int:
    """Limite de clés mécanicien par génération (env GF_KEYGEN_MAX_MECHANIC, défaut 20)."""
    try:
        val = int(os.environ.get("GF_KEYGEN_MAX_MECHANIC", ""))
        return val if val >= 1 else DEFAULT_MAX_MECHANIC
    except (TypeError, ValueError):
        return DEFAULT_MAX_MECHANIC


def validate_mechanic_request(parent_lid, count, names_arg=None) -> tuple:
    """Valide les arguments de --gen-mechanic.
    Retourne (enregistrement_parent, liste_noms) ou lève ValueError avec un
    message clair : count entier >= 1 et <= GF_KEYGEN_MAX_MECHANIC, parent-lid
    obligatoire, existant dans la base locale et de type non-mechanic, pas plus
    de noms que de clés demandées."""
    max_count = max_mechanic_count()
    if isinstance(count, bool) or not isinstance(count, int):
        raise ValueError(f"--count doit être un entier (reçu: {count!r})")
    if count < 1:
        raise ValueError(f"--count doit être un entier >= 1 (reçu: {count})")
    if count > max_count:
        raise ValueError(
            f"--count dépasse la limite autorisée ({max_count}). "
            "Ajustez la variable d'environnement GF_KEYGEN_MAX_MECHANIC si nécessaire."
        )
    if not parent_lid or not str(parent_lid).strip():
        raise ValueError("--parent-lid est obligatoire avec --gen-mechanic")
    parent = keygen_db.get_license(str(parent_lid).strip())
    if parent is None:
        raise ValueError(
            f"Licence parente introuvable dans la base locale: {parent_lid}\n"
            "Générez d'abord la licence garage (ou vérifiez le LID)."
        )
    if parent.get("type") == "mechanic":
        raise ValueError(
            "La licence parente doit être une licence garage "
            "(trial/premium/enterprise/admin), pas une clé mécanicien."
        )
    names = []
    if names_arg:
        names = [n.strip() for n in str(names_arg).split(",") if n.strip()]
        if len(names) > count:
            raise ValueError(
                f"Trop de noms fournis ({len(names)}) pour --count {count}."
            )
    return parent, names


def cmd_gen_mechanic(args):
    """Génère N clés mécanicien liées à une licence garage de la base locale."""
    try:
        parent, names = validate_mechanic_request(args.parent_lid, args.count, args.names)
    except ValueError as exc:
        print(f"\nERREUR: {exc}\n")
        sys.exit(1)

    pk  = _load_private(args.passphrase)
    cid = parent.get("cid", "")
    print("\n" + "="*70)
    print(f"  MECHANIC LICENSES — parent {parent['lid']}")
    print("="*70)
    infos = []
    for i in range(args.count):
        name  = names[i] if i < len(names) else None
        label = args.label or name or f"Mécanicien {i+1}"
        info  = keygen_core.make_mechanic_license(
            pk, parent["lid"], cid, years=args.years,
            mechanic_name=name, label=label,
        )
        keygen_db.add_license(info, {})
        keygen_db.audit_log("gen_mechanic", info["lid"],
                            f"parent={parent['lid'][:8]}…")
        infos.append(info)
        print(f"\n[{i+1:>3}] {label}")
        print(f"      {info['token']}")
        print(f"      lid={info['lid']}")
    print("\n" + "-"*70)
    print(f"  parent   : {parent['lid']}  ({parent.get('label') or cid})")
    print(f"  count    : {len(infos)}")
    print(f"  expires  : {infos[0]['expires_at']}")
    print("="*70 + "\n")


# ── Verification ───────────────────────────────────────────────────────────────
def verify_token(token: str):
    parts = token.strip().split(".")
    if len(parts) != 4 or parts[0] != "GF2":
        return None
    _, header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode()
    try:
        _load_public().verify(b64u_dec(sig_b64), signing_input, ec.ECDSA(hashes.SHA256()))
    except Exception:
        return None
    try:
        return json.loads(b64u_dec(payload_b64).decode())
    except Exception:
        return None

# ── HWID ───────────────────────────────────────────────────────────────────────
def _disk_serial() -> str:
    """Return the primary disk serial number, or '' on failure."""
    try:
        sys_name = platform.system()
        if sys_name == "Windows":
            import subprocess
            out = subprocess.check_output(
                ["wmic", "diskdrive", "get", "SerialNumber"],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode(errors="ignore")
            serials = [l.strip() for l in out.splitlines() if l.strip() and "SerialNumber" not in l]
            return serials[0] if serials else ""
        elif sys_name == "Darwin":
            import subprocess
            out = subprocess.check_output(
                ["system_profiler", "SPStorageDataType", "-json"],
                timeout=5, stderr=subprocess.DEVNULL
            ).decode(errors="ignore")
            import json as _json
            data = _json.loads(out)
            entries = data.get("SPStorageDataType", [])
            if entries:
                serial = entries[0].get("_deviceIdentifier") or entries[0].get("bsd_name", "")
                return serial
            return ""
        else:
            # Linux: try common sysfs paths
            for dev in ("/sys/block/sda/device/serial",
                        "/sys/block/nvme0n1/device/serial",
                        "/sys/block/vda/device/serial"):
                try:
                    with open(dev) as f:
                        return f.read().strip()
                except OSError:
                    continue
            # Fallback: udevadm
            import subprocess
            for blk in ("sda", "nvme0n1", "vda"):
                try:
                    out = subprocess.check_output(
                        ["udevadm", "info", "--query=property", f"--name=/dev/{blk}"],
                        timeout=5, stderr=subprocess.DEVNULL
                    ).decode(errors="ignore")
                    for line in out.splitlines():
                        if line.startswith("ID_SERIAL="):
                            return line.split("=", 1)[1].strip()
                except Exception:
                    continue
            return ""
    except Exception:
        return ""


def get_hwid() -> str:
    import socket, uuid as _uuid
    cpu      = platform.processor() or platform.machine() or "unknown"
    mac      = ":".join(
        f"{((_uuid.getnode() >> (5-i)*8) & 0xff):02x}" for i in range(6)
    )
    plat     = f"{platform.system()}-{platform.machine()}"
    hostname = hashlib.sha256(socket.gethostname().encode()).hexdigest()[:16]
    # COHÉRENCE CRITIQUE : l'empreinte DOIT être identique à keygen_core.get_hwid
    # et electron/main.js (sinon une licence liée au matériel ne validerait jamais).
    # Même sel « ||GF2-HWID-SALT|| » et même repli disque « unknown-disk ».
    disk     = _disk_serial() or "unknown-disk"
    combined = "||GF2-HWID-SALT||".join([cpu, mac, plat, hostname, disk])
    return hashlib.sha256(combined.encode()).hexdigest()

# ── Watermark decoder ─────────────────────────────────────────────────────────
def decode_watermark(wm: str):
    try:
        raw = json.loads(b64u_dec(wm).decode())
        return {
            "customer":  raw.get("c"),
            "label":     raw.get("l", ""),
            "issued_at": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(raw.get("t", 0))),
            "nonce":     raw.get("r"),
        }
    except Exception:
        return None

# ── CLI ────────────────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser(
        description="GarageFlows License Keygen v2 — ECC P-256",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--init",       action="store_true")
    p.add_argument("--passphrase", type=str)
    p.add_argument("--gen",        action="store_true")
    p.add_argument("--gen-mechanic", action="store_true", dest="gen_mechanic",
                   help="Génère des clés mécanicien liées à une licence garage (--parent-lid)")
    p.add_argument("--parent-lid", type=str, default=None, dest="parent_lid",
                   metavar="LID", help="LID de la licence garage parente (base locale)")
    p.add_argument("--count",      type=int, default=1, metavar="N",
                   help="Nombre de clés mécanicien à générer (défaut 1)")
    p.add_argument("--names",      type=str, default=None, metavar='"Nom1,Nom2,..."',
                   help="Noms des mécaniciens, séparés par des virgules (optionnel)")
    p.add_argument("--admin",      action="store_true")
    p.add_argument("--verify",     type=str, metavar="TOKEN")
    p.add_argument("--batch",      type=int, metavar="N")
    p.add_argument("--hwid",       action="store_true")
    p.add_argument("--watermark",  type=str, metavar="WM")
    p.add_argument("--customer",   type=str)
    p.add_argument("--type",       type=str, default="premium",
                   choices=sorted(LICENSE_TYPES))
    p.add_argument("--years",      type=int, default=1)
    p.add_argument("--seats",      type=int, default=1)
    p.add_argument("--bind-hwid",  type=str, default=None, metavar="HWID",
                   dest="bind_hwid")
    p.add_argument("--label",      type=str, default=None)
    args = p.parse_args()

    if args.hwid:
        # Diagnostic LOCAL uniquement. Cette empreinte n'est pas celle calculée
        # par Electron (cpu/platform/mac collectés différemment) : la signer
        # dans une licence produirait un rejet à l'activation.
        print(
            "\nEmpreinte LOCALE du keygen (diagnostic) :\n"
            f"  {get_hwid()}\n\n"
            "ATTENTION : ce n'est PAS l'empreinte du poste client. Pour lier une\n"
            "licence, relever le HWID dans GarageFlows sur le poste à activer et\n"
            "le passer à --bind-hwid.\n"
        )
        return

    if args.bind_hwid is not None:
        normalized = keygen_core.normalize_license_hwid(args.bind_hwid)
        if not keygen_core.is_valid_license_hwid(normalized):
            p.error("--bind-hwid : HWID invalide (64 hex v0, ou 'HWID1-' + 64 hex v1)")
        args.bind_hwid = normalized

    if args.init:
        pp = args.passphrase
        if pp is None:
            pp = getpass.getpass("Passphrase (blank = no encryption): ") or None
        cmd_init(pp)
        return

    if args.verify:
        pl = verify_token(args.verify)
        if pl is None:
            print("\nINVALID — signature mismatch or malformed\n")
            sys.exit(1)
        now = int(time.time())
        exp = pl.get("exp", 0)
        print("\n" + "="*60)
        print(f"  {'VALID' if exp >= now else 'VALID BUT EXPIRED'}")
        print("="*60)
        for k, v in pl.items():
            if k == "wm":
                wm = decode_watermark(v)
                print(f"  wm → {wm}")
            else:
                val = time.strftime("%Y-%m-%d", time.gmtime(v)) if k in ("iss", "exp") else v
                print(f"  {k:<8}: {val}")
        if pl.get("typ") == "mechanic":
            print("-"*60)
            print(f"  Licence MÉCANICIEN — parent (plid): {pl.get('plid', '(absent!)')}")
            print(f"  Nom suggéré (mn)                  : {pl.get('mn', '(non fourni)')}")
        print("="*60 + "\n")
        return

    if args.watermark:
        print(json.dumps(decode_watermark(args.watermark), indent=2))
        return

    if args.admin:
        pk   = _load_private(args.passphrase)
        info = make_license(pk, "ADMIN", "admin", years=10, seats=999,
                            label="GarageFlows Admin")
        print("\n" + "="*70)
        print("  ADMIN LICENSE")
        print("="*70)
        print(f"  {info['token']}")
        print("-"*70)
        print(f"  LID: {info['lid']}  |  expires: {info['expires_at']}")
        print("="*70 + "\n")
        return

    if args.gen_mechanic:
        cmd_gen_mechanic(args)
        return

    if args.batch:
        pk = _load_private(args.passphrase)
        print(f"\nGenerating {args.batch} x {args.type} ({args.years}yr, {args.seats} seat(s))\n")
        for i in range(args.batch):
            cid  = args.customer or f"CUST-{i+1:04d}"
            info = make_license(pk, cid, args.type, args.years, args.seats,
                                args.bind_hwid, args.label)
            keygen_db.add_license(info, {})
            keygen_db.audit_log("gen_batch", info["lid"], f"cid={cid}")
            print(f"[{i+1:>3}] {info['token']}")
            print(f"      cid={info['cid']}  expires={info['expires_at']}  lid={info['lid']}\n")
        return

    if args.gen:
        if not args.customer:
            p.error("--customer required")
        pk   = _load_private(args.passphrase)
        info = make_license(pk, args.customer, args.type, args.years,
                            args.seats, args.bind_hwid, args.label)
        # Enregistrement dans la base locale du keygen (keys/licenses_db.json).
        # Sans lui, « --gen-mechanic --parent-lid <LID> » — pourtant documenté
        # dans l'en-tête de ce fichier — échouait TOUJOURS avec « Licence parente
        # introuvable dans la base locale » : seuls cmd_gen_mechanic et
        # keygen_ui.py appelaient add_license, jamais --gen ni --batch.
        keygen_db.add_license(info, {})
        keygen_db.audit_log("gen", info["lid"], f"cid={args.customer}")
        print("\n" + "="*70)
        print("  LICENSE GENERATED")
        print("="*70)
        print(f"\n  {info['token']}\n")
        print("-"*70)
        for key in ("cid", "type", "seats", "issued_at", "expires_at", "hwid", "label", "lid"):
            if info[key] is not None:
                print(f"  {key:<12}: {info[key]}")
        print("="*70 + "\n")
        return

    p.print_help()


if __name__ == "__main__":
    main()
