"""
keygen_updates.py — Signature et vérification des mises à jour depuis le Keygen.

PRINCIPE : aucune réinvention de format.
  · la signature est produite par `scripts/sign-release-manifest.mjs`, le seul
    outil du dépôt dont la sortie est acceptée par le client ;
  · la vérification est faite par `electron/update-verify.js`, le module
    réellement embarqué dans chaque poste (via scripts/keygen-verify-update.cjs).

SÉCURITÉ : la clé privée Ed25519 n'est JAMAIS lue depuis le dépôt, jamais
affichée, jamais journalisée. Elle provient de l'environnement de confiance de
l'opérateur :
  · GF_UPDATE_SIGNING_KEY      — PEM PKCS#8 Ed25519 ;
  · GF_UPDATE_SIGNING_KEY_FILE — chemin vers ce PEM (saisi dans le Keygen).
Aucune fonction de ce module ne recherche, n'extrait ni ne reconstruit une clé.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SIGN_SCRIPT = ROOT_DIR / "scripts" / "sign-release-manifest.mjs"
VERIFY_SCRIPT = ROOT_DIR / "scripts" / "keygen-verify-update.cjs"
CLIENT_VERIFIER = ROOT_DIR / "electron" / "update-verify.js"

INSTALLER_EXTENSIONS = {".exe", ".msi", ".dmg", ".zip", ".appimage", ".deb"}
NODE_TIMEOUT = 300  # secondes — le hachage d'un installeur peut être long


class UpdateError(RuntimeError):
    """Erreur métier de la chaîne de signature (message affichable en clair)."""


def node_executable() -> str | None:
    return shutil.which("node") or shutil.which("node.exe")


# Variables que le système d'exploitation doit conserver quoi qu'il arrive.
# Sous Windows, Node initialise son générateur aléatoire via RtlGenRandom : sans
# SystemRoot, il s'interrompt sur « Assertion failed: ncrypto::CSPRNG » AVANT
# d'exécuter la moindre instruction. Un appelant qui restreint l'environnement
# pour maîtriser les variables GF_* ne doit pas, pour autant, empêcher Node de
# démarrer : ces variables ne portent aucun secret.
_ENV_SYSTEME = ("SystemRoot", "windir", "SystemDrive", "COMSPEC", "PATHEXT",
                "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
                "TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE",
                "HOME", "LANG", "LC_ALL")


def _env_complet(env: dict | None) -> dict | None:
    """Complète un environnement fourni par les variables système manquantes.

    `None` (héritage complet) est laissé tel quel. Aucune variable applicative
    n'est ajoutée : seules celles dont dépend le démarrage de l'interpréteur.
    """
    if env is None:
        return None
    complet = dict(env)
    for nom in _ENV_SYSTEME:
        if nom not in complet and os.environ.get(nom):
            complet[nom] = os.environ[nom]
    return complet


def _run_node(args: list, timeout: int = NODE_TIMEOUT, stdin_data: str | None = None,
              env: dict | None = None) -> tuple[int, str]:
    """Lance Node dans la racine du projet. Retourne (code, sortie)."""
    node = node_executable()
    if not node:
        return 127, ("Node.js est introuvable sur ce poste : la signature et la vérification des mises à jour "
                     "passent par les outils Node du dépôt.")
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.run(
            [node, *args], cwd=str(ROOT_DIR), input=stdin_data,
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=timeout, env=_env_complet(env or None), **kwargs,
        )
    except subprocess.TimeoutExpired:
        return 124, "Opération interrompue : durée maximale dépassée."
    except OSError as exc:
        return 126, f"Impossible de lancer Node.js ({exc.__class__.__name__})."
    out = (proc.stdout or "") + ("\n" + proc.stderr if (proc.stderr or "").strip() else "")
    return proc.returncode, out.strip()


# ── Informations fichier ─────────────────────────────────────────────────────

def sha256_file(path, chunk: int = 1024 * 1024) -> str:
    """SHA-256 d'un fichier, lu par blocs (un installeur peut dépasser 100 Mo)."""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def file_info(path) -> dict:
    p = Path(path)
    if not p.exists():
        raise UpdateError(f"Fichier introuvable : {p}")
    if not p.is_file():
        raise UpdateError(f"Ce chemin n'est pas un fichier : {p}")
    return {
        "path":     str(p),
        "name":     p.name,
        "size":     p.stat().st_size,
        "size_human": _human_size(p.stat().st_size),
        "ext":      p.suffix.lower(),
        "sha256":   sha256_file(p),
    }


def _human_size(size: int) -> str:
    size = float(size)
    for unit in ("o", "Ko", "Mo", "Go"):
        if size < 1024 or unit == "Go":
            return f"{size:.0f} {unit}" if unit == "o" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} Go"


def is_probable_installer(path) -> bool:
    """Extension réellement utilisée par les livrables GarageFlows."""
    return Path(path).suffix.lower() in INSTALLER_EXTENSIONS


# ── Clés et vérificateur client ──────────────────────────────────────────────

def client_public_keys() -> dict:
    """Clés publiques Ed25519 connues des postes (lue dans electron/update-verify.js)."""
    code, out = _run_node([
        "-e",
        "const uv=require('./electron/update-verify.js');"
        "process.stdout.write(JSON.stringify(uv.PUBLIC_KEYS))",
    ], timeout=30)
    if code != 0:
        return {}
    try:
        data = json.loads(out)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def client_allowed_hosts() -> list:
    """Domaines de téléchargement acceptés par les postes."""
    try:
        text = CLIENT_VERIFIER.read_text(encoding="utf-8")
    except Exception:
        return []
    m = re.search(r"const\s+ALLOWED_DOWNLOAD_HOSTS\s*=\s*new Set\(\[([\s\S]*?)\]\)", text)
    if not m:
        return []
    return sorted(set(re.findall(r"'([^']+)'", m.group(1))))


def signing_key_available(extra_env: dict | None = None) -> tuple[bool, str]:
    """La clé privée de signature est-elle présente dans l'environnement ?

    Ne renvoie QUE l'origine disponible (variable ou fichier) — jamais la valeur.
    """
    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)
    if (env.get("GF_UPDATE_SIGNING_KEY") or "").strip():
        return True, "variable d'environnement GF_UPDATE_SIGNING_KEY"
    key_file = (env.get("GF_UPDATE_SIGNING_KEY_FILE") or "").strip()
    if key_file:
        return (True, f"fichier {key_file}") if Path(key_file).exists() else (False, f"fichier absent : {key_file}")
    return False, "aucune clé de signature configurée (GF_UPDATE_SIGNING_KEY ou GF_UPDATE_SIGNING_KEY_FILE)"


# ── Signature ────────────────────────────────────────────────────────────────

def sign_update(file: str, version: str, download_url: str, *,
                channel: str = "stable", platform: str = "win32", arch: str = "x64",
                key_id: str | None = None, min_version: str | None = None,
                release_notes: str | None = None, out: str | None = None,
                key_file: str | None = None, allow_mismatch: bool = False,
                env: dict | None = None) -> dict:
    """Signe un installeur via `scripts/sign-release-manifest.mjs`.

    Retourne { ok, output, manifest_path }. Lève UpdateError si les prérequis
    (Node, fichier, clé) ne sont pas réunis : on ne signe jamais « à vide ».
    """
    if not node_executable():
        raise UpdateError("Node.js est introuvable : la signature des mises à jour passe par scripts/sign-release-manifest.mjs.")
    if not SIGN_SCRIPT.exists():
        raise UpdateError(f"Outil de signature absent : {SIGN_SCRIPT}")

    info = file_info(file)
    if info["size"] == 0:
        raise UpdateError("Fichier vide : rien à signer.")

    version = (version or "").strip()
    if not re.match(r"^\d+\.\d+\.\d+(?:[-+].+)?$", version):
        raise UpdateError("Version invalide : format SemVer attendu (ex. 1.2.0).")

    download_url = (download_url or "").strip()
    if not download_url.lower().startswith("https://"):
        raise UpdateError("URL de téléchargement invalide : le client exige du HTTPS.")

    env = dict(os.environ if env is None else env)
    if key_file:
        if not Path(key_file).exists():
            raise UpdateError(f"Clé de signature introuvable : {key_file}")
        env["GF_UPDATE_SIGNING_KEY_FILE"] = str(Path(key_file).resolve())
        env.pop("GF_UPDATE_SIGNING_KEY", None)
    if not (env.get("GF_UPDATE_SIGNING_KEY") or "").strip() and not (env.get("GF_UPDATE_SIGNING_KEY_FILE") or "").strip():
        raise UpdateError(
            "Aucune clé privée de signature disponible. Renseignez GF_UPDATE_SIGNING_KEY "
            "ou GF_UPDATE_SIGNING_KEY_FILE dans l'environnement du Keygen, ou choisissez "
            "le fichier de clé dans le formulaire."
        )

    args = [str(SIGN_SCRIPT), "--file", str(Path(file).resolve()),
            "--version", version, "--download-url", download_url]
    if channel:
        args += ["--channel", channel]
    if platform:
        args += ["--platform", platform]
    if arch:
        args += ["--arch", arch]
    if key_id:
        args += ["--key-id", key_id]
    if min_version:
        args += ["--min-version", min_version]
    if release_notes:
        args += ["--release-notes", release_notes]
    if out:
        args += ["--out", str(Path(out).resolve())]
    if allow_mismatch:
        args += ["--allow-mismatch"]

    code, output = _run_node(args, env=env)
    manifest_path = out or str(Path(file).with_suffix("")) + ".manifest.json"
    return {
        "ok": code == 0,
        "code": code,
        "output": output,
        "manifest_path": manifest_path if code == 0 else "",
    }


# ── Vérification (par le vérificateur RÉEL du client) ────────────────────────

def verify_signed_manifest(manifest_path, *, current_version: str | None = None,
                           channel: str | None = None, platform: str | None = None,
                           arch: str | None = None,
                           public_keys: dict | None = None) -> dict:
    """Vérifie un manifeste avec `electron/update-verify.js` (module du poste client).

    `public_keys` ajoute des ancres de confiance SUPPLÉMENTAIRES ({keyId: PEM})
    pour une vérification ciblée — une clé de recette, ou une clé attestée par
    l'opérateur. Elles ne remplacent jamais les clés embarquées dans les postes.
    """
    if not node_executable():
        return {"ok": False, "code": "NODE_ABSENT", "reason": "Node.js est introuvable : vérification impossible."}
    if not VERIFY_SCRIPT.exists():
        return {"ok": False, "code": "OUTIL_ABSENT", "reason": f"Outil absent : {VERIFY_SCRIPT}"}
    if not Path(manifest_path).exists():
        return {"ok": False, "code": "ABSENT", "reason": f"Manifeste introuvable : {manifest_path}"}

    args = [str(VERIFY_SCRIPT), str(Path(manifest_path).resolve())]
    if public_keys:
        args += ["--public-keys", json.dumps(public_keys, ensure_ascii=False)]
    if current_version:
        args += ["--current-version", current_version]
    if channel:
        args += ["--channel", channel]
    if platform:
        args += ["--platform", platform]
    if arch:
        args += ["--arch", arch]

    code, out = _run_node(args, timeout=60)
    try:
        data = json.loads(out.strip().splitlines()[-1])
    except Exception:
        return {"ok": False, "code": "SORTIE_ILLISIBLE", "reason": out[:400] or "Sortie illisible du vérificateur."}
    data["exit_code"] = code
    return data
