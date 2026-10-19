"""Liaison matérielle du keygen — formats, normalisation et refus avant signature.

Exécution (racine du projet) :
    .venv/bin/python scripts/test_keygen_hwid_binding.py
    python3 scripts/test_keygen_hwid_binding.py

Défaut couvert : un HWID quelconque était signé sans contrôle, puis refusé par
l'application à l'activation (« Licence invalide ou modifiée »). Le générateur
refuse désormais AVANT de produire un jeton. Aucun accès aux clés du projet :
une paire éphémère est générée dans un répertoire temporaire.
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import keygen_core as core

HWID_V0 = "9d22d957986da353734f95a0c3f7a5c7b1e3ce2d3b1f0a0e5c4b3a2918171615"
HWID_V1 = "HWID1-" + "a1b2c3d4" * 8


class HwidFormatTests(unittest.TestCase):
    def test_v0_valide(self):
        self.assertTrue(core.is_valid_license_hwid(HWID_V0))
        self.assertTrue(core.is_valid_license_hwid("  " + HWID_V0.upper() + "\n"))

    def test_v1_valide(self):
        self.assertTrue(core.is_valid_license_hwid(HWID_V1))
        self.assertTrue(core.is_valid_license_hwid(HWID_V1.lower()))

    def test_formats_refuses(self):
        refuses = [
            HWID_V0[:63],                 # tronqué
            HWID_V0 + "0",                # trop long
            "g" * 64,                     # non hexadécimal
            '"' + HWID_V0 + '"',          # guillemets collés
            "HWID1-" + "a" * 63,          # préfixe v1, digest tronqué
            "HWID1-" + "a" * 65,          # préfixe v1, digest trop long
            HWID_V0[:32] + " " + HWID_V0[32:],  # espace interne
            "unknown-disk",               # texte libre
        ]
        for value in refuses:
            with self.subTest(value=value):
                self.assertFalse(core.is_valid_license_hwid(value))

    def test_normalisation(self):
        self.assertEqual(core.normalize_license_hwid("  " + HWID_V1.upper() + "\n"),
                         HWID_V1)
        self.assertEqual(core.normalize_license_hwid("hwid1-" + "A" * 64),
                         "HWID1-" + "a" * 64)
        self.assertEqual(core.normalize_license_hwid(None), "")


class HwidSigningTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        keys_dir = Path(self.tmp.name) / "keys"
        keys_dir.mkdir()
        core.KEYS_DIR = keys_dir
        core.PRIV_FILE = keys_dir / "private.pem"
        core.PUB_FILE = keys_dir / "public.pem"
        core.generate_keys("")
        self.priv = core.load_private_key("")

    def tearDown(self):
        self.tmp.cleanup()

    def _payload(self, info):
        parts = info["token"].split(".")
        self.assertEqual(len(parts), 4)
        return core.verify_token(info["token"])

    def test_hwid_v0_signe_normalise(self):
        info = core.make_license(self.priv, "CUST-HWID", "premium",
                                 hwid="  " + HWID_V0.upper() + "\n")
        payload = self._payload(info)
        self.assertEqual(payload["hwid"], HWID_V0)

    def test_hwid_v1_signe_normalise(self):
        info = core.make_license(self.priv, "CUST-HWID", "premium", hwid=HWID_V1)
        payload = self._payload(info)
        self.assertEqual(payload["hwid"], HWID_V1)

    def test_hwid_mal_forme_refuse_avant_signature(self):
        for bad in [HWID_V0[:63], "g" * 64, '"' + HWID_V0 + '"']:
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    core.make_license(self.priv, "CUST-HWID", "premium", hwid=bad)

    def test_champ_vide_ou_none_non_lie(self):
        for empty in (None, "", "   "):
            with self.subTest(empty=empty):
                info = core.make_license(self.priv, "CUST-HWID", "premium", hwid=empty)
                self.assertNotIn("hwid", self._payload(info))

    def test_mecanicien_meme_controle(self):
        parent = core.make_license(self.priv, "CUST-HWID", "premium")
        info = core.make_mechanic_license(self.priv, parent["lid"], "CUST-HWID",
                                          hwid=HWID_V1.upper())
        self.assertEqual(self._payload(info)["hwid"], HWID_V1)
        with self.assertRaises(ValueError):
            core.make_mechanic_license(self.priv, parent["lid"], "CUST-HWID",
                                       hwid="pas-un-hwid")


class KeygenUiGuardTests(unittest.TestCase):
    """L'interface ne doit plus fabriquer l'empreinte du poste client."""

    def test_le_gui_n_appelle_plus_get_hwid(self):
        source = (Path(__file__).resolve().parent / "keygen_ui.py").read_text(encoding="utf-8")
        self.assertNotIn("core.get_hwid(", source,
                         "le GUI ne doit pas calculer le HWID : celui du keygen "
                         "diffère de celui de l'application")


if __name__ == "__main__":
    unittest.main(verbosity=2)
