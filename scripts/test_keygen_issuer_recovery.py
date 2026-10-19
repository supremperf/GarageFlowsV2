"""
Tests : keygen face à une clé privée qui n'est PAS la clé de production.

Cas réel (Windows, dossier extrait d'un ZIP) : ancres = bd8c… (production),
keys/private.pem = 29cc… (paire créée localement) → « Erreur de signature —
KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE ». Le refus est correct et le reste ; ces
tests vérifient que le keygen PROPOSE de retrouver la clé de production
(scripts/find-issuer-key.cjs) au lieu d'un JSON brut, sans jamais lever le
contrôle, ni générer de clé, ni faire transiter la passphrase par argv.

Exécution (depuis la racine du projet) :
    python scripts/test_keygen_issuer_recovery.py

Ne nécessite NI tkinter NI affichage : tkinter est remplacé par une sonde, de
sorte que la logique de décision de keygen_ui est exercée telle quelle.
"""

import os
import sys
import json
import types
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402

import keygen_trust as trust  # noqa: E402


# ── Sonde tkinter (aucune fenêtre) ────────────────────────────────────────────
class _W:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, name):
        return lambda *a, **k: None


class _TkModule(types.ModuleType):
    def __getattr__(self, name):
        return _W


def _install_tk_probe():
    tk = _TkModule("tkinter")
    tk.TclError = type("TclError", (Exception,), {})
    ttk = _TkModule("tkinter.ttk")
    mb = types.ModuleType("tkinter.messagebox")
    for fn in ("showinfo", "showerror", "showwarning", "askyesno"):
        setattr(mb, fn, mock.MagicMock(name=fn))
    sd = _TkModule("tkinter.simpledialog")
    fd = _TkModule("tkinter.filedialog")
    tk.ttk, tk.messagebox, tk.simpledialog, tk.filedialog = ttk, mb, sd, fd
    sys.modules.update({"tkinter": tk, "tkinter.ttk": ttk, "tkinter.messagebox": mb,
                        "tkinter.simpledialog": sd, "tkinter.filedialog": fd})
    return mb


MB = _install_tk_probe()
import keygen_ui as ui  # noqa: E402


class FakeWidget:
    """Widget vivant dont `after` exécute immédiatement (pas de boucle Tk)."""
    def winfo_exists(self):
        return True

    def after(self, _ms, fn):
        fn()


def _pem_pair():
    k = ec.generate_private_key(ec.SECP256R1())
    priv = k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                           serialization.NoEncryption())
    pub = k.public_key().public_bytes(serialization.Encoding.PEM,
                                      serialization.PublicFormat.SubjectPublicKeyInfo)
    return k, priv, pub


def _project(pub_pem: bytes, priv_pem: bytes | None) -> Path:
    """Mini-projet : 3 ancres = pub_pem ; keys/private.pem = priv_pem."""
    root = Path(tempfile.mkdtemp(prefix="gf-kg-"))
    lines = ",\n  ".join(f"'{l}'" for l in pub_pem.decode().strip().splitlines())
    (root / "keys").mkdir()
    (root / "keys/public.pem").write_bytes(pub_pem)
    if priv_pem:
        (root / "keys/private.pem").write_bytes(priv_pem)
    (root / "src/lib/license").mkdir(parents=True)
    (root / "src/lib/license/public-key.ts").write_text(f"const _LINES = [\n  {lines}\n]\n", encoding="utf-8")
    (root / "electron").mkdir()
    (root / "electron/main.js").write_text(f"const _PK = [\n  {lines}\n]\n", encoding="utf-8")
    return root


def _mismatch_error():
    prod_key, _, prod_pub = _pem_pair()
    local_key, local_priv, _ = _pem_pair()
    root = _project(prod_pub, local_priv)
    try:
        trust.check_key_match(local_key, root)
    except trust.KeyMatchError as exc:
        return exc
    raise AssertionError("une clé non conforme doit être refusée")


class MismatchDetection(unittest.TestCase):
    def test_local_key_vs_production_anchors_is_a_mismatch_with_a_human_message(self):
        exc = _mismatch_error()
        self.assertTrue(trust.is_issuer_mismatch(exc))
        msg = str(exc)
        self.assertIn("n'est PAS", msg)
        self.assertIn("Rechercher la clé de production", msg)
        self.assertNotIn("PRIVATE KEY", msg)

    def test_local_pair_with_its_own_public_pem_is_still_an_issuer_mismatch(self):
        # Cas « Initialiser les clés » / config : keys/public.pem = moitié publique de
        # la paire LOCALE. Seules les ancres source définissent la production.
        _, _, prod_pub = _pem_pair()
        local_key, local_priv, local_pub = _pem_pair()
        root = _project(prod_pub, local_priv)
        (root / "keys/public.pem").write_bytes(local_pub)
        with self.assertRaises(trust.KeyMatchError) as ctx:
            trust.check_key_match(local_key, root)
        self.assertTrue(trust.is_issuer_mismatch(ctx.exception))
        self.assertIn("n'est PAS", str(ctx.exception))

    def test_divergent_anchors_or_other_errors_are_not_treated_as_issuer_mismatch(self):
        _, _, pub_a = _pem_pair()
        key_b, _, pub_b = _pem_pair()
        root = _project(pub_a, None)
        (root / "electron/main.js").write_text(
            "const _PK = [\n  " + ",\n  ".join(f"'{l}'" for l in pub_b.decode().strip().splitlines()) + "\n]\n",
            encoding="utf-8")
        with self.assertRaises(trust.KeyMatchError) as ctx:
            trust.check_key_match(key_b, root)
        self.assertFalse(trust.is_issuer_mismatch(ctx.exception))
        self.assertFalse(trust.is_issuer_mismatch(ValueError("bad decrypt")))

    def test_matching_key_passes(self):
        key, priv, pub = _pem_pair()
        self.assertEqual(trust.check_key_match(key, _project(pub, priv))["code"], "KEY_MATCH")


class RunFindIssuer(unittest.TestCase):
    """Plomberie du lancement : cwd, argv SANS passphrase, passphrase sur stdin seulement."""

    def setUp(self):
        self.node = trust.shutil.which("node")
        if not self.node:
            self.skipTest("node absent")
        self.tmp = Path(tempfile.mkdtemp(prefix="gf-run-"))
        self.probe = self.tmp / "probe.cjs"
        self.probe.write_text(
            "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{"
            "console.log(JSON.stringify({argv:process.argv.slice(2),stdin:d,cwd:process.cwd()}));"
            "process.exitCode=d==='fail'?1:0})", encoding="utf-8")

    def test_passphrase_goes_to_stdin_never_argv(self):
        code, out = trust.run_find_issuer(self.tmp, passphrase="s3cr3t-pp", script=self.probe)
        seen = json.loads(out)
        self.assertEqual(code, 0)
        self.assertEqual(seen["argv"], ["--passphrase-stdin"])
        self.assertEqual(seen["stdin"], "s3cr3t-pp")
        self.assertEqual(Path(seen["cwd"]).resolve(), self.tmp.resolve())
        self.assertNotIn("s3cr3t-pp", " ".join(seen["argv"]))

    def test_no_passphrase_no_flag_and_dry_run_flag(self):
        _, out = trust.run_find_issuer(self.tmp, script=self.probe, dry_run=True)
        self.assertEqual(json.loads(out)["argv"], ["--dry-run"])

    def test_exit_code_is_propagated(self):
        code, _ = trust.run_find_issuer(self.tmp, passphrase="fail", script=self.probe)
        self.assertEqual(code, 1)

    def test_missing_node_gives_the_terminal_command(self):
        with mock.patch.object(trust.shutil, "which", return_value=None):
            code, out = trust.run_find_issuer(self.tmp)
        self.assertEqual(code, 127)
        self.assertIn("npm run keys:find-issuer", out)


class KeygenUiDecisions(unittest.TestCase):
    def setUp(self):
        for fn in ("showinfo", "showerror", "showwarning", "askyesno"):
            getattr(MB, fn).reset_mock(return_value=True, side_effect=True)
        self.w = FakeWidget()

    def test_signature_refused_for_local_key_offers_the_search_not_raw_json(self):
        MB.askyesno.return_value = True
        with mock.patch.object(ui, "search_production_key") as search:
            ui._signature_failed(self.w, "…", True, "pp")
        MB.askyesno.assert_called_once()
        self.assertIn("Rechercher maintenant", MB.askyesno.call_args.args[1])
        MB.showerror.assert_not_called()
        search.assert_called_once()
        self.assertEqual(search.call_args.args[1], "pp")

    def test_user_declines_nothing_runs(self):
        MB.askyesno.return_value = False
        with mock.patch.object(ui, "search_production_key") as search:
            ui._signature_failed(self.w, "…", True, "")
        search.assert_not_called()

    def test_other_signature_errors_keep_their_own_message(self):
        with mock.patch.object(ui, "search_production_key") as search:
            ui._signature_failed(self.w, "Clé privée introuvable", False, "")
        MB.showerror.assert_called_once()
        self.assertEqual(MB.showerror.call_args.args[1], "Clé privée introuvable")
        search.assert_not_called()

    def test_search_success_reports_and_refreshes(self):
        found = mock.MagicMock()
        with mock.patch.object(ui, "run_find_issuer", return_value=(0, "✅ installée")), \
             mock.patch.object(ui, "_show_report") as report, \
             mock.patch.object(ui.threading, "Thread", side_effect=lambda target, daemon: types.SimpleNamespace(start=target)):
            ui.search_production_key(self.w, "", on_found=found)
        self.assertIn("vous pouvez générer", report.call_args.args[1])
        found.assert_called_once()

    def test_search_failure_changes_nothing_and_says_so(self):
        found = mock.MagicMock()
        with mock.patch.object(ui, "run_find_issuer", return_value=(1, "❌ aucune")), \
             mock.patch.object(ui, "_show_report") as report, \
             mock.patch.object(ui.threading, "Thread", side_effect=lambda target, daemon: types.SimpleNamespace(start=target)):
            ui.search_production_key(self.w, "", on_found=found)
        self.assertIn("rien n'a été modifié ni généré", report.call_args.args[1])
        found.assert_not_called()

    def _startup(self, keys_exist, load=None):
        app = types.SimpleNamespace(_passphrase="", _keys_changed=lambda: None)
        with mock.patch.object(ui.core, "HAS_CRYPTO", True), \
             mock.patch.object(ui.core, "keys_exist", return_value=keys_exist), \
             mock.patch.object(ui.core, "load_private_key", side_effect=load or (lambda pp: None)), \
             mock.patch.object(ui, "offer_production_key_search") as offer:
            ui.App._check_keys_on_start(app)
        return offer

    def test_startup_without_keys_offers_search_before_any_initialisation(self):
        offer = self._startup(False)
        offer.assert_called_once()
        self.assertIn("N'utilisez PAS", offer.call_args.args[2])

    def test_startup_with_local_non_production_key_offers_search(self):
        exc = _mismatch_error()
        with mock.patch("keygen_trust.check_key_match", side_effect=exc):
            offer = self._startup(True)
        offer.assert_called_once()

    def test_startup_with_production_key_is_silent(self):
        with mock.patch("keygen_trust.check_key_match", return_value={"ok": True, "code": "KEY_MATCH"}):
            offer = self._startup(True)
        offer.assert_not_called()
        MB.showerror.assert_not_called()

    def test_startup_with_encrypted_key_and_no_passphrase_does_not_nag(self):
        offer = self._startup(True, load=lambda pp: (_ for _ in ()).throw(TypeError("Password was not given")))
        offer.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
