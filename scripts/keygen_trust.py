"""Read-only P-256 correspondence checks. No network, key rotation or token logging."""
import argparse
import getpass
import hashlib
import json
import re
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def explain(receipt):
    """Human explanation of a refusal (public fingerprints only), then the raw receipt."""
    issuer = receipt.get("issuerFingerprint") or ""
    anchors = receipt.get("anchors") or {}
    expected = {a.get("fingerprint") for a in anchors.values() if a.get("fingerprint")}
    lines = []
    if receipt.get("code") == "KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE" and issuer and len(expected) == 1:
        lines += [
            "La clé privée de ce keygen (keys/private.pem, empreinte " + issuer[:16] + "…) n'est PAS",
            "la clé de licence de production (" + next(iter(expected))[:16] + "…) : une licence signée",
            "avec elle serait refusée par le logiciel. Signature bloquée, rien n'a été écrit.",
            "",
            "Correctif automatique : dans le dossier du projet, lancer",
            "    npm run keys:find-issuer",
            "(retrouve la clé de production sur ce poste — anciens dossiers du projet, .env.server.local —,",
            "vérifiée par empreinte, et l'installe ; la clé actuelle est mise de côté hors du projet).",
            "Ne pas régénérer de clé pour contourner ce contrôle.",
        ]
    elif receipt.get("code") == "KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE":
        lines += [
            "Ancres de clé publique incohérentes ou illisibles : lancer `npm run keys:restore`,",
            "puis `npm run keys:find-issuer`.",
        ]
    return "\n".join(lines + ["", "Détail : " + json.dumps(receipt, ensure_ascii=False)]) if lines else json.dumps(receipt, ensure_ascii=False)


class KeyMatchError(ValueError):
    def __init__(self, receipt):
        super().__init__(explain(receipt))
        self.receipt = receipt


def fingerprint(public_key):
    if not isinstance(public_key, ec.EllipticCurvePublicKey) or not isinstance(public_key.curve, ec.SECP256R1):
        raise ValueError("P256_REQUIRED")
    der = public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()


def embedded_public_key(file, variable):
    text = Path(file).read_text(encoding="utf-8")
    blocks = re.findall(r"const\s+" + re.escape(variable) + r"\s*=\s*\[([\s\S]*?)\]", text)
    if len(blocks) != 1:
        raise ValueError("ANCHOR_UNREADABLE")
    lines = re.findall(r"'([^']*)'", blocks[0])
    return serialization.load_pem_public_key("\n".join(lines).encode("ascii"))


def check_key_match(private_key, root, public_key_file=None):
    """Compare the loaded key, local PEM and both local build anchors, plus optional target PEM.

    public_key_file must come from an independently attested target artifact/operator.
    A matching local checkout does NOT establish the key actually deployed remotely.
    """
    receipt = {"ok": False, "code": "KEY_CHECK_FAILED", "algorithm": "ES256-P256-DER",
               "scope": "local-checkout; remote deployment NOT verified", "anchors": {}}
    try:
        receipt["issuerFingerprint"] = fingerprint(private_key.public_key())
    except Exception:
        receipt["code"] = "P256_REQUIRED"
        raise KeyMatchError(receipt) from None
    root = Path(root)
    sources = [
        ("local-public-pem", lambda: serialization.load_pem_public_key((root / "keys/public.pem").read_bytes())),
        ("pwa-source", lambda: embedded_public_key(root / "src/lib/license/public-key.ts", "_LINES")),
        ("electron-source", lambda: embedded_public_key(root / "electron/main.js", "_PK")),
    ]
    if public_key_file:
        sources.append(("operator-target-pem", lambda: serialization.load_pem_public_key(Path(public_key_file).read_bytes())))
    for name, load in sources:
        try:
            fp = fingerprint(load())
            receipt["anchors"][name] = {"fingerprint": fp, "matches": fp == receipt["issuerFingerprint"]}
        except Exception:
            receipt["anchors"][name] = {"matches": False, "error": "MISSING_INVALID_OR_NON_P256_ANCHOR"}
    if not all(a["matches"] for a in receipt["anchors"].values()):
        receipt["code"] = "KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE"
        raise KeyMatchError(receipt)
    receipt.update(ok=True, code="KEY_MATCH")
    return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description="Lecture seule : compare clés du keygen et ancres locales, jamais une attestation serveur distante.")
    parser.add_argument("--verify-key-match", action="store_true", required=True)
    parser.add_argument("--public-key-file", help="PEM PUBLIC extrait indépendamment de la cible ; aucun téléchargement automatique")
    parser.add_argument("--ask-passphrase", action="store_true", help="Saisie masquée, jamais en argument ni dans les journaux")
    args = parser.parse_args(argv)
    import keygen_core as core
    try:
        password = getpass.getpass("Passphrase du PEM privé : ") if args.ask_passphrase else ""
        key = core.load_private_key(password)
        print(json.dumps(check_key_match(key, core.ROOT_DIR, args.public_key_file), ensure_ascii=False))
        return 0
    except KeyMatchError as error:
        print(json.dumps(error.receipt, ensure_ascii=False))
        return 1
    except Exception:
        print(json.dumps({"ok": False, "code": "PRIVATE_KEY_UNAVAILABLE_OR_UNREADABLE",
                          "hint": "Vérifier le fichier privé autorisé et sa passphrase ; aucune clé créée/modifiée."}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
