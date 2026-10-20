#!/usr/bin/env python3
"""
secret_scan.py — détection locale de secrets dans une capture d'écran.

POURQUOI CE SERVICE
  Une capture d'écran partagée (support, ticket, forum) peut contenir une clé
  API, un mot de passe SMTP ou une URL de base de données. Le partage doit être
  bloqué AVANT l'envoi, pas constaté après.

ARCHITECTURE
  · détection : `scan_text()` — expressions de `patterns.toml`, score,
    chevauchements résolus, masquage. Aucune valeur complète n'en sort ;
  · OCR : Tesseract (binaire local), lecture sur stdin/stdout — AUCUNE image
    écrite sur disque ;
  · transport : HTTP sur 127.0.0.1 uniquement (`--serve`), POST /scan et
    GET /health. Origine non locale refusée, corps limité, pas de CORS ;
  · confidentialité : image jamais persistée, texte jamais journalisé, secret
    jamais renvoyé en clair. `GF_SCREENSHOT_SCAN_PERSIST=true` est REFUSÉ.

CONFIGURATION (variables d'environnement)
  GF_SCREENSHOT_SECRET_SCAN_ENABLED   false → le service répond 503 (fail-closed)
  GF_SCREENSHOT_SCAN_SERVER_URL       URL attendue par les clients (documentaire)
  GF_SCREENSHOT_SCAN_PERSIST          doit rester false/absent
  GF_SCREENSHOT_SCAN_MAX_BYTES        taille maximale d'image (défaut 10 Mio)
  GF_SCREENSHOT_TESSERACT             binaire tesseract (défaut « tesseract »)
  GF_SCREENSHOT_TESSERACT_LANG        langue OCR (défaut « eng »)
  GF_SCREENSHOT_SCAN_PATTERNS         chemin de patterns.toml

USAGE
  python scripts/secret_scan.py --check
  python scripts/secret_scan.py --image capture.png [--json]
  python scripts/secret_scan.py --serve [--port 7070]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Iterable

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATTERNS = ROOT / "patterns.toml"
DEFAULT_PORT = 7070
DEFAULT_MAX_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000
ALLOWED_IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "PNG"),
    (b"\xff\xd8\xff", "JPEG"),
    (b"GIF87a", "GIF"),
    (b"GIF89a", "GIF"),
    (b"BM", "BMP"),
)
VERSION = "1.0.0"


class ScanError(RuntimeError):
    """Erreur métier, message affichable sans secret."""

    def __init__(self, message: str, code: str = "SCAN_ERROR", status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


class OcrUnavailable(ScanError):
    def __init__(self, message: str = "OCR indisponible sur ce poste."):
        super().__init__(message, "OCR_UNAVAILABLE", 503)


# ── Chargement des règles ────────────────────────────────────────────────────

@dataclass(frozen=True)
class Rule:
    id: str
    family: str
    description: str
    regex: re.Pattern
    score: float
    keep_prefix: int
    keep_suffix: int


@dataclass(frozen=True)
class PatternSet:
    rules: tuple[Rule, ...]
    min_score: float
    version: int
    source: str = ""

    def __len__(self) -> int:
        return len(self.rules)


def _toml_load(path: Path) -> dict:
    try:
        import tomllib  # Python 3.11+
        with path.open("rb") as fh:
            return tomllib.load(fh)
    except ModuleNotFoundError:
        try:
            import tomli  # type: ignore[import-not-found]
            with path.open("rb") as fh:
                return tomli.load(fh)
        except ModuleNotFoundError:
            raise ScanError(
                "Lecture TOML impossible : Python 3.11+ (tomllib) ou le paquet tomli est requis.",
                "TOML_UNAVAILABLE",
                500,
            ) from None
    except (OSError, ValueError) as exc:
        raise ScanError(f"Fichier de règles illisible ou TOML invalide : {path.name} ({exc.__class__.__name__}).",
                        "PATTERNS_INVALID", 500) from None


def load_patterns(path: str | os.PathLike | None = None) -> PatternSet:
    cible = Path(path or os.environ.get("GF_SCREENSHOT_SCAN_PATTERNS") or DEFAULT_PATTERNS)
    data = _toml_load(cible)
    settings = data.get("settings") or {}
    try:
        min_score = float(settings.get("min_score", 0.6))
    except (TypeError, ValueError):
        raise ScanError("patterns.toml : settings.min_score invalide.", "PATTERNS_INVALID", 500) from None
    if not 0 <= min_score <= 1:
        raise ScanError("patterns.toml : settings.min_score doit être entre 0 et 1.", "PATTERNS_INVALID", 500)

    rules: list[Rule] = []
    seen: set[str] = set()
    for index, raw in enumerate(data.get("rules") or []):
        identifiant = str(raw.get("id") or f"RULE_{index + 1}").strip()
        if identifiant in seen:
            raise ScanError(f"patterns.toml : identifiant de règle dupliqué « {identifiant} ».",
                            "PATTERNS_INVALID", 500)
        seen.add(identifiant)
        motif = raw.get("regex")
        if not isinstance(motif, str) or not motif.strip():
            raise ScanError(f"patterns.toml : règle « {identifiant} » sans regex.", "PATTERNS_INVALID", 500)
        try:
            compile_ = re.compile(motif)
        except re.error as exc:
            raise ScanError(f"patterns.toml : regex invalide pour « {identifiant} » ({exc.msg}).",
                            "PATTERNS_INVALID", 500) from None
        score = float(raw.get("score", 0.7))
        if not 0 <= score <= 1:
            raise ScanError(f"patterns.toml : score hors [0,1] pour « {identifiant} ».",
                            "PATTERNS_INVALID", 500)
        rules.append(Rule(
            id=identifiant,
            family=str(raw.get("family") or "generic"),
            description=str(raw.get("description") or ""),
            regex=compile_,
            score=score,
            keep_prefix=max(0, int(raw.get("mask_keep_prefix", 3))),
            keep_suffix=max(0, int(raw.get("mask_keep_suffix", 0))),
        ))
    if not rules:
        raise ScanError("patterns.toml ne contient aucune règle.", "PATTERNS_INVALID", 500)
    return PatternSet(tuple(rules), min_score, int(data.get("version", 1)), str(cible))


# ── Détection et masquage ────────────────────────────────────────────────────

@dataclass
class SecretHit:
    type: str
    family: str
    description: str
    start: int
    end: int
    score: float
    value_redacted: str
    # Valeur réelle conservée UNIQUEMENT en mémoire, le temps du masquage.
    _value: str = field(repr=False, default="")

    def public(self) -> dict:
        return {
            "type": self.type,
            "family": self.family,
            "description": self.description,
            "value_redacted": self.value_redacted,
            "score": round(self.score, 3),
            "start": self.start,
            "end": self.end,
        }


def _mask(value: str, keep_prefix: int, keep_suffix: int) -> str:
    # Un secret très court ne doit pas être reconstituable en conservant tout.
    prefix = value[:keep_prefix] if len(value) > keep_prefix + keep_suffix + 2 else value[:1]
    suffix = value[-keep_suffix:] if keep_suffix and len(value) > keep_prefix + keep_suffix + 2 else ""
    return f"{prefix}****{suffix}" if prefix or suffix else "****"


def scan_text(text: str, patterns: PatternSet | None = None) -> dict:
    """Détecte les secrets d'un texte. Ne renvoie JAMAIS la valeur complète."""
    if not isinstance(text, str):
        raise ScanError("Texte attendu.", "INVALID_TEXT", 400)
    jeux = patterns or load_patterns()
    hits: list[SecretHit] = []
    for rule in jeux.rules:
        if rule.score < jeux.min_score:
            continue
        for m in rule.regex.finditer(text):
            if m.re.groups:
                debut, fin = m.start(1), m.end(1)
            else:
                debut, fin = m.start(), m.end()
            valeur = text[debut:fin]
            if not valeur:
                continue
            hits.append(SecretHit(
                type=rule.id, family=rule.family, description=rule.description,
                start=debut, end=fin, score=rule.score,
                value_redacted=_mask(valeur, rule.keep_prefix, rule.keep_suffix),
                _value=valeur,
            ))

    # Chevauchements : on garde le match le plus fiable (score, puis longueur).
    # Une clé OpenAI reconnue par sa règle dédiée ne doit pas être re-masquée
    # partiellement par la règle générique « api_key = … ».
    hits.sort(key=lambda h: (h.start, -h.score, -(h.end - h.start)))
    retenus: list[SecretHit] = []
    for hit in hits:
        if any(not (hit.end <= r.start or hit.start >= r.end) for r in retenus):
            continue
        retenus.append(hit)
    retenus.sort(key=lambda h: h.start)

    return {
        "secrets": [h.public() for h in retenus],
        "count": len(retenus),
        "blocked": bool(retenus),
        "highest_score": max((h.score for h in retenus), default=0.0),
        "raw_text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
        "patterns_version": jeux.version,
    }


def redact_text(text: str, result: dict | None = None, patterns: PatternSet | None = None) -> str:
    """Retourne le texte avec chaque secret remplacé par [SECRET:TYPE]."""
    resultat = result or scan_text(text, patterns)
    if not resultat.get("secrets"):
        return text
    morceaux: list[str] = []
    curseur = 0
    for secret in resultat["secrets"]:
        debut, fin = int(secret["start"]), int(secret["end"])
        morceaux.append(text[curseur:debut])
        morceaux.append(f"[SECRET:{secret['type']}]")
        curseur = fin
    morceaux.append(text[curseur:])
    return "".join(morceaux)


# ── OCR ──────────────────────────────────────────────────────────────────────

def tesseract_path() -> str | None:
    configure = os.environ.get("GF_SCREENSHOT_TESSERACT", "tesseract").strip() or "tesseract"
    if os.path.sep in configure or "/" in configure:
        return configure if Path(configure).is_file() else None
    return shutil.which(configure)


def ocr_available() -> bool:
    return tesseract_path() is not None


def validate_image(data: bytes, max_bytes: int | None = None) -> str:
    """Valide format/taille sans écrire sur disque. Retourne le format détecté."""
    limite = max_bytes if max_bytes is not None else int(
        os.environ.get("GF_SCREENSHOT_SCAN_MAX_BYTES", DEFAULT_MAX_BYTES))
    if not data:
        raise ScanError("Image vide.", "EMPTY_IMAGE", 400)
    if len(data) > limite:
        raise ScanError(f"Image trop volumineuse ({len(data)} octets > {limite}).", "IMAGE_TOO_LARGE", 413)
    format_ = None
    for magic, nom in ALLOWED_IMAGE_MAGIC:
        if data.startswith(magic):
            format_ = nom
            break
    if format_ is None:
        raise ScanError("Format d'image non pris en charge (PNG, JPEG, GIF ou BMP attendu).",
                        "UNSUPPORTED_FORMAT", 415)
    try:
        from PIL import Image  # Pillow optionnel : contrôle anti-bombe uniquement
        Image.MAX_IMAGE_PIXELS = MAX_PIXELS
        import io
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
            if img.width * img.height > MAX_PIXELS:
                raise ScanError("Image aux dimensions excessives.", "IMAGE_TOO_LARGE", 413)
    except ImportError:
        pass
    except ScanError:
        raise
    except Exception:
        raise ScanError("Image illisible ou corrompue.", "INVALID_IMAGE", 415) from None
    return format_


def _default_ocr(data: bytes) -> str:
    binaire = tesseract_path()
    if not binaire:
        raise OcrUnavailable(
            "OCR indisponible : binaire tesseract introuvable. "
            "Installez Tesseract ou définissez GF_SCREENSHOT_TESSERACT."
        )
    langue = os.environ.get("GF_SCREENSHOT_TESSERACT_LANG", "eng").strip() or "eng"
    try:
        proc = subprocess.run(
            [binaire, "stdin", "stdout", "-l", langue, "--psm", "6"],
            input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise OcrUnavailable("OCR interrompu (binaire illisible ou délai dépassé).") from None
    if proc.returncode != 0:
        # Le stderr de tesseract n'est jamais relayé : il peut citer des chemins,
        # jamais un secret, mais reste inutile au client.
        raise OcrUnavailable("OCR en échec (code tesseract non nul).")
    return (proc.stdout or b"").decode("utf-8", errors="replace")


def scan_image(data: bytes, patterns: PatternSet | None = None,
               ocr: Callable[[bytes], str] | None = None,
               max_bytes: int | None = None) -> dict:
    """OCR + détection. Lève OcrUnavailable si aucun moteur n'est disponible."""
    format_ = validate_image(data, max_bytes)
    moteur = ocr or (_default_ocr if ocr_available() else None)
    if moteur is None:
        raise OcrUnavailable()
    texte = moteur(data)
    resultat = scan_text(texte, patterns)
    resultat["image_format"] = format_
    resultat["image_bytes"] = len(data)
    resultat["ocr_text_sha256"] = resultat["raw_text_sha256"]
    # Le texte brut n'est PAS renvoyé : il peut contenir des données personnelles
    # (nom, adresse, numéro) sans rapport avec un secret.
    del resultat["raw_text_sha256"]
    return resultat


# ── Serveur local ────────────────────────────────────────────────────────────

def _enabled() -> bool:
    valeur = (os.environ.get("GF_SCREENSHOT_SECRET_SCAN_ENABLED", "true") or "true").strip().lower()
    return valeur not in {"0", "false", "no", "off", "non"}


def _persist_required() -> bool:
    return (os.environ.get("GF_SCREENSHOT_SCAN_PERSIST", "false") or "false").strip().lower() in {
        "1", "true", "yes", "on", "oui"}


def create_server(port: int = DEFAULT_PORT, host: str = "127.0.0.1",
                  patterns: PatternSet | None = None,
                  ocr: Callable[[bytes], str] | None = None,
                  max_bytes: int | None = None) -> ThreadingHTTPServer:
    """Crée le serveur (sans le démarrer). Bind strictement sur la boucle locale."""
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise ScanError("Le service de scan doit écouter sur la boucle locale uniquement.",
                        "INVALID_BIND", 500)
    if _persist_required():
        raise ScanError(
            "GF_SCREENSHOT_SCAN_PERSIST=true refusé : ce service ne persiste JAMAIS les images.",
            "PERSIST_FORBIDDEN", 500,
        )
    jeux = patterns or load_patterns()
    limite = max_bytes if max_bytes is not None else int(
        os.environ.get("GF_SCREENSHOT_SCAN_MAX_BYTES", DEFAULT_MAX_BYTES))
    moteur = ocr
    etat = {"requetes": 0, "verrou": threading.Lock()}

    class Handler(BaseHTTPRequestHandler):
        server_version = f"GarageFlowsSecretScan/{VERSION}"
        sys_version = ""

        # Aucune journalisation de corps, d'en-tête ni de texte.
        def log_message(self, fmt, *args):  # noqa: A003
            if os.environ.get("GF_SCREENSHOT_SCAN_VERBOSE") == "1":
                super().log_message(fmt, *args)

        def _json(self, status: int, payload: dict) -> None:
            corps = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(corps)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(corps)

        def _origine_locale(self) -> bool:
            origine = self.headers.get("Origin")
            if not origine:
                return True
            try:
                from urllib.parse import urlparse
                hote = urlparse(origine).hostname or ""
            except ValueError:
                return False
            return hote in {"127.0.0.1", "::1", "localhost"}

        def do_GET(self):  # noqa: N802
            if self.path.split("?")[0] == "/health":
                self._json(200, {
                    "ok": True,
                    "service": "garageflows-secret-scan",
                    "version": VERSION,
                    "enabled": _enabled(),
                    "ocrAvailable": bool(moteur) or ocr_available(),
                    "patterns": len(jeux),
                    "patternsVersion": jeux.version,
                    "persist": False,
                    "maxBytes": limite,
                })
                return
            self._json(404, {"ok": False, "code": "NOT_FOUND", "reason": "Route inconnue."})

        def do_POST(self):  # noqa: N802
            if self.path.split("?")[0] != "/scan":
                self._json(404, {"ok": False, "code": "NOT_FOUND", "reason": "Route inconnue."})
                return
            if not self._origine_locale():
                self._json(403, {"ok": False, "code": "ORIGIN_FORBIDDEN",
                                 "reason": "Origine non locale refusée."})
                return
            if not _enabled():
                self._json(503, {"ok": False, "code": "SCAN_DISABLED",
                                 "reason": "Le scan des captures est désactivé par configuration."})
                return
            with etat["verrou"]:
                etat["requetes"] += 1
            try:
                longueur = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                longueur = 0
            if longueur <= 0:
                self._json(411, {"ok": False, "code": "LENGTH_REQUIRED",
                                 "reason": "Content-Length requis."})
                return
            if longueur > limite:
                self._json(413, {"ok": False, "code": "IMAGE_TOO_LARGE",
                                 "reason": f"Image trop volumineuse (> {limite} octets)."})
                return
            corps = self.rfile.read(longueur)
            try:
                resultat = scan_image(corps, jeux, moteur or (_default_ocr if ocr_available() else None), limite)
            except ScanError as exc:
                self._json(exc.status, {"ok": False, "code": exc.code, "reason": str(exc)})
                return
            except Exception:  # noqa: BLE001 - jamais de détail interne au client
                self._json(500, {"ok": False, "code": "INTERNAL",
                                 "reason": "Erreur interne du service de scan."})
                return
            # `blocked` est la décision par défaut : le client DOIT bloquer le
            # partage tant qu'un secret est présent.
            self._json(200, {"ok": True, **resultat})

    serveur = ThreadingHTTPServer((host, port), Handler)
    serveur.daemon_threads = True
    serveur.patterns = jeux  # type: ignore[attr-defined]
    serveur.scan_ocr = moteur  # type: ignore[attr-defined]
    serveur.max_bytes = limite  # type: ignore[attr-defined]
    return serveur


def serve_forever(port: int = DEFAULT_PORT, host: str = "127.0.0.1") -> int:
    try:
        serveur = create_server(port, host)
    except OSError as exc:
        print(f"Impossible d'écouter sur {host}:{port} ({exc.__class__.__name__}).", file=sys.stderr)
        return 1
    except ScanError as exc:
        print(f"Configuration refusée : {exc}", file=sys.stderr)
        return 1
    hote_reel, port_reel = serveur.server_address[:2]
    print(f"GarageFlows secret-scan {VERSION} — http://{hote_reel}:{port_reel}")
    print(f"  règles          : {len(serveur.patterns)} (version {serveur.patterns.version})")  # type: ignore[attr-defined]
    print(f"  OCR disponible  : {'oui' if ocr_available() else 'non (503 en attendant tesseract)'}")
    print("  persistance     : aucune (images jamais écrites sur disque)")
    try:
        serveur.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        serveur.server_close()
    return 0


def serve_in_thread(port: int = 0, **kwargs) -> tuple[ThreadingHTTPServer, threading.Thread, int]:
    """Démarre le serveur en tâche de fond (tests/intégration). Retourne le port réel."""
    serveur = create_server(port, **kwargs)
    port_reel = serveur.server_address[1]
    thread = threading.Thread(target=serveur.serve_forever, daemon=True)
    thread.start()
    return serveur, thread, port_reel


# ── CLI ──────────────────────────────────────────────────────────────────────

def _print_resultat(resultat: dict) -> None:
    print(f"Secrets détectés : {resultat['count']}")
    for secret in resultat["secrets"]:
        print(f"  · {secret['type']:<28} score={secret['score']:.2f} "
              f"position={secret['start']}..{secret['end']} valeur={secret['value_redacted']}")
    if resultat["blocked"]:
        print("PARTAGE BLOQUÉ : masquez ou retirez les secrets avant diffusion.")
    else:
        print("Aucun secret détecté.")


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Détection de secrets dans une capture d'écran.")
    parser.add_argument("--serve", action="store_true", help="démarre le service HTTP local")
    parser.add_argument("--port", type=int, default=int(os.environ.get("GF_SCREENSHOT_SCAN_PORT", DEFAULT_PORT)))
    parser.add_argument("--image", help="capture à analyser")
    parser.add_argument("--text", help="texte à analyser (diagnostic)")
    parser.add_argument("--redact", action="store_true", help="affiche le texte masqué")
    parser.add_argument("--json", action="store_true", help="sortie JSON")
    parser.add_argument("--check", action="store_true", help="affiche l'état du service")
    parser.add_argument("--patterns", help="chemin de patterns.toml")
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        jeux = load_patterns(args.patterns)
    except ScanError as exc:
        print(f"Configuration invalide : {exc}", file=sys.stderr)
        return 2

    if args.check:
        etat = {
            "version": VERSION,
            "patterns": len(jeux),
            "patternsVersion": jeux.version,
            "patternsPath": jeux.source,
            "enabled": _enabled(),
            "ocrAvailable": ocr_available(),
            "persist": False,
            "maxBytes": int(os.environ.get("GF_SCREENSHOT_SCAN_MAX_BYTES", DEFAULT_MAX_BYTES)),
        }
        print(json.dumps(etat, ensure_ascii=False, indent=2) if args.json else
              "\n".join(f"{k}: {v}" for k, v in etat.items()))
        # --check est un diagnostic : il réussit même si l'OCR est absent, et
        # affiche `ocrAvailable: false` pour que l'appelant décide (fail-closed).
        return 0

    if args.serve:
        return serve_forever(args.port)

    if args.image:
        try:
            data = Path(args.image).read_bytes()
            resultat = scan_image(data, jeux)
        except FileNotFoundError:
            print(f"Image introuvable : {args.image}", file=sys.stderr)
            return 2
        except ScanError as exc:
            print(f"{exc.code}: {exc}", file=sys.stderr)
            return 2
        if args.json:
            print(json.dumps({"ok": True, **resultat}, ensure_ascii=False, indent=2))
        else:
            _print_resultat(resultat)
        return 1 if resultat["blocked"] else 0

    if args.text is not None:
        resultat = scan_text(args.text, jeux)
        if args.redact:
            print(redact_text(args.text, resultat))
        elif args.json:
            print(json.dumps({"ok": True, **resultat}, ensure_ascii=False, indent=2))
        else:
            _print_resultat(resultat)
        return 1 if resultat["blocked"] else 0

    parser.print_help()
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
