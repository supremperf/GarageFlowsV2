#!/usr/bin/env python3
"""
test_secret_scan.py — tests du service de détection de secrets dans les captures.

TOUTES les valeurs utilisées ici sont FICTIVES et construites pour ressembler à
des secrets (préfixes + caractères aléatoires). Aucune clé réelle ne figure dans
ce fichier, et aucune image n'est écrite sur disque par le service.

Exécution :
    python3 scripts/test_secret_scan.py
"""

import base64
import json
import os
import sys
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

import secret_scan as scan  # noqa: E402

# PNG 1×1 valide (octets publics, sans contenu).
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

# ── Valeurs FACTICES (jamais des credentials réels) ──────────────────────────
FAUX = {
    "OPENAI_API_KEY": "sk-proj-" + "A1b2C3d4E5f6G7h8I9j0" * 2,
    "ANTHROPIC_API_KEY": "sk-ant-" + "aB3dE5fG7hI9jK1lM3nO" * 2,
    "STRIPE_SECRET_KEY": "sk_live_" + "a1B2c3D4e5F6g7H8i9J0k1L2",
    "GITHUB_TOKEN": "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8",
    "GITHUB_FINE_GRAINED_TOKEN": "github_pat_" + "11ABCDEFG0123456789_" + "aBcDeFgHiJkLmNoPqRsTuVwXyZ",
    "GITLAB_TOKEN": "glpat-" + "a1B2c3D4e5F6g7H8i9J0",
    "AWS_ACCESS_KEY_ID": "AKIA" + "IOSFODNN7EXAMPLE".replace("I", "1").replace("O", "0"),
    "GOOGLE_API_KEY": "AIza" + "A" * 35,
    "SLACK_TOKEN": "xoxb-" + "123456789012-123456789012-aBcDeFgHiJkLmNoPqRsTuVwX",
    "SENDGRID_API_KEY": "SG." + "aBcDeFgHiJkLmNoP" + "." + "qRsTuVwXyZaBcDeFgHiJkLmNoPqRsTuVwXyZ01234",
}

PATTERNS = scan.load_patterns(ROOT / "patterns.toml")


def ids(resultat):
    return [s["type"] for s in resultat["secrets"]]


class TestPatterns(unittest.TestCase):
    def test_chargement(self):
        self.assertGreaterEqual(len(PATTERNS), 20)
        self.assertEqual(PATTERNS.version, 1)
        self.assertAlmostEqual(PATTERNS.min_score, 0.6)
        self.assertEqual(PATTERNS.source, str(ROOT / "patterns.toml"))

    def test_regex_invalide_refusee(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".toml", delete=False, encoding="utf-8") as fh:
            fh.write("version = 1\n[[rules]]\nid='X'\nregex='('\nscore=0.9\n")
            chemin = fh.name
        try:
            with self.assertRaises(scan.ScanError) as ctx:
                scan.load_patterns(chemin)
            self.assertEqual(ctx.exception.code, "PATTERNS_INVALID")
        finally:
            os.unlink(chemin)

    def test_fichier_absent(self):
        with self.assertRaises(scan.ScanError):
            scan.load_patterns("/nonexistent/patterns.toml")


class TestDetection(unittest.TestCase):
    def test_familles_principales(self):
        for identifiant, valeur in FAUX.items():
            with self.subTest(famille=identifiant):
                resultat = scan.scan_text(f"variable = {valeur}", PATTERNS)
                self.assertIn(identifiant, ids(resultat), resultat["secrets"])

    def test_aucun_secret(self):
        texte = "Bonjour, la vidange du véhicule AB-123-CD est terminée. Total : 89,00 €."
        resultat = scan.scan_text(texte, PATTERNS)
        self.assertEqual(resultat["count"], 0)
        self.assertFalse(resultat["blocked"])

    def test_masquage_ne_restitue_jamais_la_valeur(self):
        for identifiant, valeur in FAUX.items():
            with self.subTest(famille=identifiant):
                resultat = scan.scan_text(valeur, PATTERNS)
                self.assertTrue(resultat["secrets"])
                for secret in resultat["secrets"]:
                    self.assertNotIn(valeur, secret["value_redacted"])
                    self.assertIn("****", secret["value_redacted"])
                    self.assertLess(len(secret["value_redacted"]), len(valeur))

    def test_positions_exactes(self):
        texte = "avant " + FAUX["GITHUB_TOKEN"] + " après"
        resultat = scan.scan_text(texte, PATTERNS)
        secret = resultat["secrets"][0]
        self.assertEqual(texte[secret["start"]:secret["end"]], FAUX["GITHUB_TOKEN"])

    def test_plusieurs_secrets(self):
        texte = f"{FAUX['OPENAI_API_KEY']} et {FAUX['GITHUB_TOKEN']}"
        resultat = scan.scan_text(texte, PATTERNS)
        self.assertEqual(resultat["count"], 2)
        self.assertTrue(resultat["blocked"])
        self.assertEqual(resultat["raw_text_sha256"], __import__("hashlib").sha256(texte.encode()).hexdigest())

    def test_chevauchement_resolu_par_score(self):
        """Une clé OpenAI ne doit pas être re-masquée par la règle générique."""
        texte = f"OPENAI_API_KEY={FAUX['OPENAI_API_KEY']}"
        resultat = scan.scan_text(texte, PATTERNS)
        self.assertEqual(ids(resultat), ["OPENAI_API_KEY"])
        self.assertEqual(resultat["count"], 1)

    def test_jeton_nu_non_signale(self):
        """20 caractères isolés ne constituent pas un secret sans contexte."""
        resultat = scan.scan_text("référence interne : aBcDeFgHiJkLmNoPqRsT", PATTERNS)
        self.assertEqual(resultat["count"], 0)

    def test_mot_de_passe_smtp_en_contexte(self):
        resultat = scan.scan_text("SMTP_PASSWORD=MotDePasseFactice123!", PATTERNS)
        self.assertIn("SMTP_PASSWORD", ids(resultat))

    def test_url_base_de_donnees(self):
        url = "postgresql://user:MotDePasseFactice@db.example.invalid:5432/garage"
        resultat = scan.scan_text(url, PATTERNS)
        self.assertIn("POSTGRES_URL_WITH_PASSWORD", ids(resultat))
        self.assertNotIn("MotDePasseFactice", json.dumps(resultat))

    def test_bloc_de_cle_privee(self):
        resultat = scan.scan_text("-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----", PATTERNS)
        self.assertIn("PRIVATE_KEY_BLOCK", ids(resultat))

    def test_redaction(self):
        texte = f"clé={FAUX['GITHUB_TOKEN']} fin"
        resultat = scan.scan_text(texte, PATTERNS)
        masque = scan.redact_text(texte, resultat)
        self.assertNotIn(FAUX["GITHUB_TOKEN"], masque)
        self.assertIn("[SECRET:GITHUB_TOKEN]", masque)


class TestValidationImage(unittest.TestCase):
    def test_png_valide(self):
        self.assertEqual(scan.validate_image(PNG_1PX), "PNG")

    def test_format_invalide(self):
        with self.assertRaises(scan.ScanError) as ctx:
            scan.validate_image(b"ceci n'est pas une image")
        self.assertEqual(ctx.exception.code, "UNSUPPORTED_FORMAT")

    def test_image_vide(self):
        with self.assertRaises(scan.ScanError) as ctx:
            scan.validate_image(b"")
        self.assertEqual(ctx.exception.code, "EMPTY_IMAGE")

    def test_image_trop_volumineuse(self):
        with self.assertRaises(scan.ScanError) as ctx:
            scan.validate_image(PNG_1PX, max_bytes=10)
        self.assertEqual(ctx.exception.code, "IMAGE_TOO_LARGE")

    def test_image_corrompue(self):
        with self.assertRaises(scan.ScanError) as ctx:
            scan.validate_image(b"\x89PNG\r\n\x1a\n" + b"pas-un-png-valide")
        self.assertEqual(ctx.exception.code, "INVALID_IMAGE")


class TestScanImage(unittest.TestCase):
    def test_ocr_injecte_et_aucun_texte_brut(self):
        texte = f"OPENAI_API_KEY={FAUX['OPENAI_API_KEY']}"
        resultat = scan.scan_image(PNG_1PX, PATTERNS, ocr=lambda _b: texte)
        self.assertEqual(resultat["image_format"], "PNG")
        self.assertEqual(resultat["count"], 1)
        self.assertTrue(resultat["blocked"])
        self.assertNotIn("raw_text_sha256", resultat)
        self.assertNotIn(FAUX["OPENAI_API_KEY"], json.dumps(resultat))

    def test_ocr_imprecis_espace_parasite_dans_le_jeton(self):
        # Sortie réelle de Tesseract 5.3 sur une capture : espaces insérées
        # au milieu des jetons. Elles masquaient la clé OpenAI et la clé Stripe.
        openai = FAUX["OPENAI_API_KEY"]
        stripe = FAUX["STRIPE_SECRET_KEY"]
        texte = (f"export OPENAI_API_KEY={openai[:3]} {openai[3:8]} {openai[8:]}\n"
                 f"{stripe[:20]} {stripe[20:]}\n")
        resultat = scan.scan_image(PNG_1PX, PATTERNS, ocr=lambda _b: texte)
        self.assertEqual(ids(resultat), ["OPENAI_API_KEY", "STRIPE_SECRET_KEY"])
        self.assertTrue(resultat["blocked"])
        # Les positions désignent le texte OCR d'origine, espaces comprises.
        premier = resultat["secrets"][0]
        self.assertEqual(texte[premier["start"]:premier["end"]].replace(" ", ""), openai)
        self.assertNotIn(openai, json.dumps(resultat))
        self.assertNotIn(stripe[8:], json.dumps(resultat))

    def test_ocr_compactage_sans_faux_positif_generique(self):
        # Recoller les mots d'une phrase ordinaire ne doit rien signaler.
        texte = "password : mon chien est noir\nTotal TTC : 245,00 EUR\n"
        resultat = scan.scan_image(PNG_1PX, PATTERNS, ocr=lambda _b: texte)
        self.assertEqual(resultat["count"], 0)
        self.assertFalse(resultat["blocked"])

    def test_ocr_compactage_ne_dedouble_pas(self):
        texte = f"cle {FAUX['GITHUB_TOKEN']} fin"
        resultat = scan.scan_image(PNG_1PX, PATTERNS, ocr=lambda _b: texte)
        self.assertEqual(ids(resultat), ["GITHUB_TOKEN"])

    @unittest.skipUnless(scan.ocr_available(), "Tesseract absent : OCR réel non exécutable")
    def test_ocr_reel_tesseract(self):
        try:
            from PIL import Image, ImageDraw, ImageFont
        except ImportError:
            self.skipTest("Pillow absent : impossible de produire une capture")
        polices = [p for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
                               "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
                               "C:/Windows/Fonts/consola.ttf") if Path(p).exists()]
        if not polices:
            self.skipTest("Aucune police à chasse fixe disponible")
        police = ImageFont.truetype(polices[0], 28)
        import io

        def capture(lignes):
            img = Image.new("RGB", (1400, 60 + 50 * len(lignes)), "white")
            dessin = ImageDraw.Draw(img)
            for i, ligne in enumerate(lignes):
                dessin.text((20, 20 + 50 * i), ligne, fill="black", font=police)
            tampon = io.BytesIO()
            img.save(tampon, "PNG")
            return tampon.getvalue()

        propre = scan.scan_image(capture(["Planning atelier : vidange Clio", "Total TTC : 245,00 EUR"]), PATTERNS)
        self.assertFalse(propre["blocked"])
        sale = scan.scan_image(capture([f"OPENAI_API_KEY={FAUX['OPENAI_API_KEY']}",
                                        FAUX["STRIPE_SECRET_KEY"]]), PATTERNS)
        self.assertTrue(sale["blocked"])
        self.assertIn("OPENAI_API_KEY", ids(sale))
        self.assertIn("STRIPE_SECRET_KEY", ids(sale))

    def test_ocr_indisponible(self):
        ancien = os.environ.get("GF_SCREENSHOT_TESSERACT")
        os.environ["GF_SCREENSHOT_TESSERACT"] = "/nonexistent/tesseract"
        try:
            with self.assertRaises(scan.OcrUnavailable):
                scan.scan_image(PNG_1PX, PATTERNS)
        finally:
            if ancien is None:
                os.environ.pop("GF_SCREENSHOT_TESSERACT", None)
            else:
                os.environ["GF_SCREENSHOT_TESSERACT"] = ancien


class TestServeur(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.texte = f"capture de support\nOPENAI_API_KEY={FAUX['OPENAI_API_KEY']}\nfin"
        cls.serveur, cls.thread, cls.port = scan.serve_in_thread(
            port=0, patterns=PATTERNS, ocr=lambda _b: cls.texte, max_bytes=2048,
        )
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.serveur.shutdown()
        cls.serveur.server_close()
        cls.thread.join(timeout=5)

    def _post(self, chemin, corps, headers=None):
        req = urllib.request.Request(self.base + chemin, data=corps, method="POST",
                                     headers={"Content-Type": "image/png", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read().decode())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read().decode())

    def test_health(self):
        with urllib.request.urlopen(self.base + "/health", timeout=5) as r:
            payload = json.loads(r.read().decode())
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["service"], "garageflows-secret-scan")
        self.assertTrue(payload["ocrAvailable"])
        self.assertFalse(payload["persist"])

    def test_scan_image(self):
        status, payload = self._post("/scan", PNG_1PX)
        self.assertEqual(status, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["count"], 1)
        self.assertTrue(payload["blocked"])
        self.assertNotIn(FAUX["OPENAI_API_KEY"], json.dumps(payload))
        self.assertNotIn("capture de support", json.dumps(payload))

    def test_format_refuse(self):
        status, payload = self._post("/scan", b"pas une image")
        self.assertEqual(status, 415)
        self.assertEqual(payload["code"], "UNSUPPORTED_FORMAT")

    def test_taille_refusee(self):
        status, payload = self._post("/scan", b"\x89PNG\r\n\x1a\n" + b"x" * 4096)
        self.assertEqual(status, 413)
        self.assertEqual(payload["code"], "IMAGE_TOO_LARGE")

    def test_origine_distante_refusee(self):
        status, payload = self._post("/scan", PNG_1PX, {"Origin": "https://evil.example"})
        self.assertEqual(status, 403)
        self.assertEqual(payload["code"], "ORIGIN_FORBIDDEN")

    def test_origine_locale_acceptee(self):
        status, _ = self._post("/scan", PNG_1PX, {"Origin": "http://127.0.0.1:4028"})
        self.assertEqual(status, 200)

    def test_route_inconnue(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(self.base + "/inconnue", timeout=5)
        self.assertEqual(ctx.exception.code, 404)

    def test_scan_desactive_fail_closed(self):
        ancien = os.environ.get("GF_SCREENSHOT_SECRET_SCAN_ENABLED")
        os.environ["GF_SCREENSHOT_SECRET_SCAN_ENABLED"] = "false"
        try:
            status, payload = self._post("/scan", PNG_1PX)
        finally:
            if ancien is None:
                os.environ.pop("GF_SCREENSHOT_SECRET_SCAN_ENABLED", None)
            else:
                os.environ["GF_SCREENSHOT_SECRET_SCAN_ENABLED"] = ancien
        self.assertEqual(status, 503)
        self.assertEqual(payload["code"], "SCAN_DISABLED")

    def test_persistance_refusee(self):
        ancien = os.environ.get("GF_SCREENSHOT_SCAN_PERSIST")
        os.environ["GF_SCREENSHOT_SCAN_PERSIST"] = "true"
        try:
            with self.assertRaises(scan.ScanError) as ctx:
                scan.create_server(0, patterns=PATTERNS, ocr=lambda _b: "")
            self.assertEqual(ctx.exception.code, "PERSIST_FORBIDDEN")
        finally:
            if ancien is None:
                os.environ.pop("GF_SCREENSHOT_SCAN_PERSIST", None)
            else:
                os.environ["GF_SCREENSHOT_SCAN_PERSIST"] = ancien

    def test_bind_non_local_refuse(self):
        with self.assertRaises(scan.ScanError):
            scan.create_server(0, host="0.0.0.0", patterns=PATTERNS, ocr=lambda _b: "")

    def test_aucune_image_ecrite(self):
        """Le service ne crée aucun fichier : le dossier courant n'est pas modifié."""
        avant = {p.name for p in Path.cwd().iterdir()}
        self.assertEqual(self._post("/scan", PNG_1PX)[0], 200)
        apres = {p.name for p in Path.cwd().iterdir()}
        self.assertEqual(avant, apres)


if __name__ == "__main__":
    unittest.main(verbosity=2)
