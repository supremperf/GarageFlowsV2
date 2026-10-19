"""
Tests du Keygen GarageFlows — licences mécanicien.

Exécution (depuis la racine du projet) :
    python3 scripts/test_keygen.py

Ne dépend PAS de tkinter (n'importe pas keygen_ui) ni des clés réelles du
projet : une paire ECC de test est générée dans un répertoire temporaire, et les
chemins de keygen_core / keygen_db sont redirigés vers ce répertoire.
"""

import os
import sys
import json
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import keygen_core as core
import keygen_db as db


class KeygenMechanicTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        keys_dir = tmp / "keys"
        keys_dir.mkdir()
        # Rediriger keygen_core vers le tmp et générer une paire de test.
        core.KEYS_DIR = keys_dir
        core.PRIV_FILE = keys_dir / "private.pem"
        core.PUB_FILE = keys_dir / "public.pem"
        core.generate_keys("")
        self.priv = core.load_private_key("")
        # Rediriger keygen_db vers le tmp.
        db.DB_FILE = keys_dir / "licenses_db.json"
        db.AUDIT_FILE = keys_dir / "keygen_audit.log"

    def tearDown(self):
        self.tmp.cleanup()

    # ── Génération ────────────────────────────────────────────────────────────
    def test_garage_only(self):
        info = core.make_license(self.priv, "CUST-1", "premium", years=1)
        payload = core.verify_token(info["token"])
        self.assertIsNotNone(payload)
        self.assertEqual(payload["typ"], "premium")
        self.assertNotIn("plid", payload)

    def test_garage_plus_one_mechanic(self):
        parent = core.make_license(self.priv, "CUST-1", "premium")
        m = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1",
                                       mechanic_name="Jean")
        payload = core.verify_token(m["token"])
        self.assertIsNotNone(payload)
        self.assertEqual(payload["typ"], "mechanic")
        self.assertEqual(payload["plid"], parent["lid"])
        self.assertEqual(payload["seats"], 1)
        self.assertEqual(payload["ver"], "2.1")
        self.assertEqual(payload["mn"], "Jean")

    def test_garage_plus_five_unique(self):
        parent = core.make_license(self.priv, "CUST-1", "premium")
        lids = set()
        for i in range(5):
            m = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1",
                                           mechanic_name=f"M{i}")
            lids.add(m["lid"])
        self.assertEqual(len(lids), 5)  # aucun doublon

    def test_mechanic_requires_parent(self):
        with self.assertRaises(ValueError):
            core.make_mechanic_license(self.priv, "", "CUST-1")
        with self.assertRaises(ValueError):
            core.make_mechanic_license(self.priv, "   ", "CUST-1")

    def test_make_license_rejects_mechanic_type(self):
        with self.assertRaises(ValueError):
            core.make_license(self.priv, "CUST-1", "mechanic")

    def test_is_mechanic_payload(self):
        parent = core.make_license(self.priv, "CUST-1", "premium")
        m = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1")
        self.assertTrue(core.is_mechanic_payload(core.verify_token(m["token"])))
        self.assertFalse(core.is_mechanic_payload(core.verify_token(parent["token"])))

    # ── Base locale + statut ──────────────────────────────────────────────────
    def test_db_stores_parent_and_children(self):
        parent = core.make_license(self.priv, "CUST-1", "premium", label="Garage A")
        db.add_license(parent, {})
        children = []
        for i in range(3):
            m = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1",
                                           mechanic_name=f"M{i}")
            db.add_license(m, {})
            children.append(m)
        self.assertEqual(len(db.list_children(parent["lid"])), 3)
        self.assertEqual(len(db.garage_licenses()), 1)  # seul le garage

    def test_individual_revocation(self):
        parent = core.make_license(self.priv, "CUST-1", "premium")
        db.add_license(parent, {})
        m1 = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1")
        m2 = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1")
        db.add_license(m1, {})
        db.add_license(m2, {})
        # Révoquer UNE clé n'affecte ni l'autre ni le parent.
        self.assertTrue(db.set_status(m1["lid"], "revoked"))
        self.assertEqual(db.get_license(m1["lid"])["status"], "revoked")
        self.assertEqual(db.get_license(m2["lid"])["status"], "active")
        self.assertEqual(db.get_license(parent["lid"])["status"], "active")

    def test_suspend_then_reactivate(self):
        parent = core.make_license(self.priv, "CUST-1", "premium")
        db.add_license(parent, {})
        m = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1")
        db.add_license(m, {})
        db.set_status(m["lid"], "suspended")
        self.assertEqual(db.get_license(m["lid"])["status"], "suspended")
        db.set_status(m["lid"], "active")
        self.assertEqual(db.get_license(m["lid"])["status"], "active")

    # ── Audit : jamais de token complet ───────────────────────────────────────
    def test_audit_log_no_full_token(self):
        parent = core.make_license(self.priv, "CUST-1", "premium")
        db.add_license(parent, {})
        m = core.make_mechanic_license(self.priv, parent["lid"], "CUST-1")
        db.add_license(m, {})
        db.audit_log("gen_mechanic", m["lid"], "parent=" + parent["lid"][:8])
        content = db.AUDIT_FILE.read_text(encoding="utf-8")
        self.assertNotIn("GF2.", content)           # aucun token complet
        self.assertNotIn(m["token"], content)
        self.assertIn(m["lid"][:8], content)        # lid tronqué présent


class KeygenCliValidationTests(unittest.TestCase):
    """Valide les garde-fous CLI de --gen-mechanic via le module keygen.py."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        keys_dir = tmp / "keys"
        keys_dir.mkdir()
        core.KEYS_DIR = keys_dir
        core.PRIV_FILE = keys_dir / "private.pem"
        core.PUB_FILE = keys_dir / "public.pem"
        core.generate_keys("")
        self.priv = core.load_private_key("")
        db.DB_FILE = keys_dir / "licenses_db.json"
        db.AUDIT_FILE = keys_dir / "keygen_audit.log"
        # Un garage parent en base locale.
        self.parent = core.make_license(self.priv, "CUST-1", "premium", label="Garage A")
        db.add_license(self.parent, {})
        import keygen
        self.keygen = keygen

    def tearDown(self):
        self.tmp.cleanup()

    def test_count_must_be_positive(self):
        with self.assertRaises(ValueError):
            self.keygen.validate_mechanic_request(self.parent["lid"], 0)
        with self.assertRaises(ValueError):
            self.keygen.validate_mechanic_request(self.parent["lid"], -3)

    def test_count_must_be_int(self):
        with self.assertRaises(ValueError):
            self.keygen.validate_mechanic_request(self.parent["lid"], "abc")

    def test_count_respects_max(self):
        os.environ["GF_KEYGEN_MAX_MECHANIC"] = "5"
        try:
            with self.assertRaises(ValueError):
                self.keygen.validate_mechanic_request(self.parent["lid"], 6)
            # 5 est accepté.
            parent, names = self.keygen.validate_mechanic_request(self.parent["lid"], 5)
            self.assertEqual(parent["lid"], self.parent["lid"])
        finally:
            del os.environ["GF_KEYGEN_MAX_MECHANIC"]

    def test_parent_must_exist(self):
        with self.assertRaises(ValueError):
            self.keygen.validate_mechanic_request("does-not-exist", 1)

    def test_parent_cannot_be_mechanic(self):
        m = core.make_mechanic_license(self.priv, self.parent["lid"], "CUST-1")
        db.add_license(m, {})
        with self.assertRaises(ValueError):
            self.keygen.validate_mechanic_request(m["lid"], 1)

    def test_too_many_names(self):
        with self.assertRaises(ValueError):
            self.keygen.validate_mechanic_request(self.parent["lid"], 1, "A,B,C")

    def test_valid_request(self):
        parent, names = self.keygen.validate_mechanic_request(
            self.parent["lid"], 2, "Alice,Bob")
        self.assertEqual(names, ["Alice", "Bob"])
        self.assertEqual(parent["lid"], self.parent["lid"])


class KeygenInitNeverReplacesTests(unittest.TestCase):
    """--init cree une PREMIERE autorite ; il ne remplace jamais une cle existante."""

    def setUp(self):
        import keygen
        self.keygen = keygen
        self.tmp = tempfile.TemporaryDirectory()
        keys_dir = Path(self.tmp.name) / "keys"
        self.saved = (keygen.KEYS_DIR, keygen.PRIV_FILE, keygen.PUB_FILE)
        keygen.KEYS_DIR = keys_dir
        keygen.PRIV_FILE = keys_dir / "private.pem"
        keygen.PUB_FILE = keys_dir / "public.pem"

    def tearDown(self):
        self.keygen.KEYS_DIR, self.keygen.PRIV_FILE, self.keygen.PUB_FILE = self.saved
        self.tmp.cleanup()

    def test_first_init_creates_pair(self):
        self.keygen.cmd_init(None)
        self.assertTrue(self.keygen.PRIV_FILE.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----"))
        self.assertTrue(self.keygen.PUB_FILE.read_bytes().startswith(b"-----BEGIN PUBLIC KEY-----"))

    def test_existing_private_key_is_never_overwritten(self):
        self.keygen.KEYS_DIR.mkdir()
        self.keygen.PRIV_FILE.write_bytes(b"production-key-placeholder")
        with self.assertRaises(SystemExit) as ctx:
            self.keygen.cmd_init(None)
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertEqual(self.keygen.PRIV_FILE.read_bytes(), b"production-key-placeholder")
        self.assertFalse(self.keygen.PUB_FILE.exists())

    def test_existing_public_key_also_blocks(self):
        self.keygen.KEYS_DIR.mkdir()
        self.keygen.PUB_FILE.write_bytes(b"pinned-public")
        with self.assertRaises(SystemExit):
            self.keygen.cmd_init(None)
        self.assertFalse(self.keygen.PRIV_FILE.exists())
        self.assertEqual(self.keygen.PUB_FILE.read_bytes(), b"pinned-public")


if __name__ == "__main__":
    unittest.main(verbosity=2)
