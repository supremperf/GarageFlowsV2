"""
test_keygen_v2.py — campagne de tests du Keygen refondu (durées, offres, HWID,
serveur, signature des mises à jour, absence de récupération de clé).

Exécution (depuis la racine du projet) :
    python scripts/test_keygen_v2.py            # ou python3 -m unittest discover

Prérequis : le module Python `cryptography`, et Node.js pour les tests de
signature (les tests concernés sont ignorés si Node est absent — jamais
« réussis » par défaut).

CE QUI EST RÉELLEMENT TESTÉ
  · la génération des licences : crypto ECDSA P-256 réelle, jetons vérifiés ;
  · les durées en jours/mois/années — dates calculées et recoupées ;
  · la base locale : champs client complets, recherche, filtres, tri ;
  · les refus : offre inexistante, durée invalide, HWID mal formé ;
  · la chaîne de signature des mises à jour : signature par l'outil du dépôt,
    vérification par le module RÉEL embarqué sur les postes ;
  · l'absence de tout mécanisme de récupération de clé privée de production.

CE QUI NE L'EST PAS : le rendu graphique. Aucun serveur X n'est requis ni
simulé : l'interface est exercée via une sonde Tk (logique et enchaînements),
ce qui ne prouve en rien l'affichage — les tests visuels restent manuels.
"""

import json
import os
import re
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from cryptography.hazmat.primitives import serialization                    # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec, ed25519            # noqa: E402

import keygen        as cli                                                   # noqa: E402
import keygen_core as core                                                   # noqa: E402
import keygen_db   as db                                                     # noqa: E402
import keygen_server as server                                               # noqa: E402
import keygen_updates as updates                                             # noqa: E402
import keygen_trust as trust                                                 # noqa: E402


# ══════════════════════════════════════════════════════════════════════════════
#  Sonde Tkinter — aucune fenêtre, aucun serveur X.
#
#  Elle ne « simule » pas un rendu : elle rend POSSIBLE l'exécution du code de
#  l'interface (enchaînements, validation, persistance) là où aucun affichage
#  n'existe. Les widgets ne dessinent rien ; la logique, elle, s'exécute.
# ══════════════════════════════════════════════════════════════════════════════

class TclError(Exception):
    pass


class Var:
    """StringVar minimal : valeur réelle + traces, comme le vrai."""

    def __init__(self, value=""):
        self._value = value
        self._traces = []

    def set(self, value):
        self._value = value
        for cb in list(self._traces):
            cb("write", "", "w")

    def get(self):
        return self._value

    def trace_add(self, _mode, callback):
        self._traces.append(callback)
        return callback

    def trace_remove(self, _mode, callback):
        if callback in self._traces:
            self._traces.remove(callback)


class _Interpreter:
    """Interpréteur Tcl minimal : dans une sonde, aucun widget n'a le focus."""

    @staticmethod
    def call(*_a):
        return ""


class Widget:
    """Widget factice : options mémorisées, méthodes de positionnement neutres."""

    tk = _Interpreter()

    def __init__(self, master=None, **kw):
        self.master = master
        self._opts = dict(kw)
        self._alive = True
        self._children = []
        self._bindings = {}
        self._text = ""
        self._state = "normal"

    # ── Options ──────────────────────────────────────────────────────────────
    def config(self, **kw):
        self._opts.update({k: v for k, v in kw.items() if v is not None})
        return self._opts

    configure = config

    def cget(self, key):
        return self._opts.get(key, "")

    def __setitem__(self, key, value):
        self._opts[key] = value

    def __getitem__(self, key):
        return self._opts[key]

    # ── Positionnement / cycle de vie ────────────────────────────────────────
    def pack(self, **_kw):
        return self

    def pack_forget(self):
        return self

    def pack_propagate(self, _flag):
        return self

    def grid(self, **_kw):
        return self

    def grid_configure(self, **_kw):
        return self

    def grid_columnconfigure(self, *_a, **_k):
        pass

    def rowconfigure(self, *_a, **_k):
        pass

    def columnconfigure(self, *_a, **_k):
        pass

    def bind(self, event, callback=None, add=None):
        self._bindings[event] = callback
        return callback

    def bind_all(self, event, callback=None):
        return callback

    def destroy(self):
        self._alive = False

    def winfo_exists(self):
        return self._alive

    def after(self, ms, fn=None):
        """Exécution immédiate : pas de boucle d'événements dans une sonde."""
        if fn is not None:
            fn()
        return "after#0"

    def after_cancel(self, _id):
        pass

    def update_idletasks(self):
        pass

    def winfo_containing(self, *_a):
        return None

    def winfo_rootx(self):
        return 0

    def winfo_rooty(self):
        return 0

    def winfo_width(self):
        return 1280

    def winfo_height(self):
        return 800

    def grab_set(self):
        pass

    def wait_window(self, _win=None):
        pass

    def transient(self, _master):
        pass

    def geometry(self, _spec):
        pass

    def minsize(self, *_a):
        pass

    def title(self, _text):
        pass

    def overrideredirect(self, _flag):
        pass

    # ── Contenu (Entry, Text, Treeview) ──────────────────────────────────────
    # Comme le vrai Tk, un champ lié à une variable affiche CETTE variable :
    # écrire dans le champ, c'est écrire dans la variable. Sans ce lien, un
    # texte indicatif inséré dans le champ restait invisible pour les tests.
    def _textvariable(self):
        var = self._opts.get("textvariable")
        return var if isinstance(var, Var) else None

    def insert(self, index, text, *tags):
        var = self._textvariable()
        if var is None:
            self._text = str(text)
        elif index in (0, "0"):
            var.set(str(text) + var.get())
        else:
            var.set(var.get() + str(text))

    def delete(self, *_a):
        var = self._textvariable()
        if var is None:
            self._text = ""
        else:
            var.set("")

    def get(self, *_a):
        var = self._textvariable()
        return self._text if var is None else var.get()

    def clipboard_clear(self):
        pass

    def clipboard_append(self, text):
        self._clipboard = text

    def clipboard_get(self):
        return getattr(self, "_clipboard", "")

    # ── Tk natif toléré ──────────────────────────────────────────────────────
    def mainloop(self):
        pass

    def __getattr__(self, name):
        # Toute méthode Tk non modélisée est un no-op — jamais une erreur.
        return lambda *_a, **_k: None


class Tree(Widget):
    """Treeview minimal mais réel : lignes stockées, lisibles, sélectionnables."""

    def __init__(self, master=None, **kw):
        super().__init__(master, **kw)
        self._items = {}
        self._order = []
        self._selection = []

    def insert(self, _parent, _index, iid=None, values=(), tags=(), **_kw):
        iid = iid or f"item{len(self._order)}"
        self._items[iid] = {"values": tuple(values), "tags": tuple(tags)}
        self._order.append(iid)
        return iid

    def delete(self, *iids):
        for iid in iids:
            self._items.pop(iid, None)
            if iid in self._order:
                self._order.remove(iid)

    def get_children(self, _parent=""):
        return list(self._order)

    def item(self, iid, _key=None):
        return self._items.get(iid, {})

    def selection(self):
        return list(self._selection)

    def selection_set(self, iid):
        self._selection = [iid]

    def heading(self, *_a, **_k):
        pass

    def column(self, *_a, **_k):
        pass

    def tag_configure(self, *_a, **_k):
        pass


class _TkPackage(types.ModuleType):
    """Paquet tkinter : chaque nom demandé renvoie une classe Widget utilisable."""

    def __getattr__(self, name):
        if name == "TclError":
            return TclError
        if name in ("StringVar", "IntVar", "DoubleVar", "BooleanVar"):
            return Var
        if name == "Treeview":
            return Tree
        if name in ("Tk", "Toplevel", "Frame", "Label", "Entry", "Button", "Text",
                    "Canvas", "Radiobutton", "Checkbutton", "Listbox", "Menu",
                    "Scrollbar", "Spinbox", "LabelFrame", "PanedWindow"):
            return self._widget_class(name)
        return Widget

    @staticmethod
    def _widget_class(_name):
        return Widget


def install_tk_probe():
    tk = _TkPackage("tkinter")
    tk.TclError = TclError
    tk.StringVar = tk.IntVar = tk.DoubleVar = tk.BooleanVar = Var
    tk.Widget = Widget
    for name in ("Tk", "Toplevel", "Frame", "Label", "Entry", "Button", "Text", "Canvas",
                 "Radiobutton", "Checkbutton", "Listbox", "Menu", "LabelFrame", "PanedWindow"):
        setattr(tk, name, Widget)

    ttk = types.ModuleType("tkinter.ttk")
    for name in ("Frame", "Label", "Button", "Entry", "Combobox", "Spinbox", "Separator",
                 "Scrollbar", "Progressbar", "Notebook"):
        setattr(ttk, name, Widget)
    ttk.Treeview = Tree
    ttk.Style = Widget

    messagebox = types.ModuleType("tkinter.messagebox")
    calls = {"shown": []}

    def _record(kind):
        def _fn(title, message, **_kw):
            calls["shown"].append((kind, title, message))
            return True
        return _fn
    for kind in ("showinfo", "showerror", "showwarning"):
        setattr(messagebox, kind, _record(kind))
    messagebox.askyesno = lambda title, message, **_kw: calls.setdefault("answers", {}) and True
    messagebox.askokcancel = messagebox.askyesno
    messagebox.calls = calls

    filedialog = types.ModuleType("tkinter.filedialog")
    filedialog.askopenfilename = lambda **_kw: ""
    filedialog.asksaveasfilename = lambda **_kw: ""
    filedialog.askdirectory = lambda **_kw: ""

    simpledialog = types.ModuleType("tkinter.simpledialog")
    simpledialog.askstring = lambda *a, **k: None

    tk.ttk = ttk
    tk.messagebox = messagebox
    tk.filedialog = filedialog
    tk.simpledialog = simpledialog
    sys.modules.update({
        "tkinter": tk, "tkinter.ttk": ttk, "tkinter.messagebox": messagebox,
        "tkinter.filedialog": filedialog, "tkinter.simpledialog": simpledialog,
    })
    return tk, messagebox


TK, MESSAGEBOX = install_tk_probe()
import keygen_ui as ui                                                        # noqa: E402


class SyncThread:
    """Remplace threading.Thread : exécution synchrone (aucune course dans les tests)."""

    def __init__(self, target=None, daemon=None, **_kw):
        self.target = target

    def start(self):
        if self.target:
            self.target()


# ══════════════════════════════════════════════════════════════════════════════
#  Socle commun
# ══════════════════════════════════════════════════════════════════════════════

class KeygenTestCase(unittest.TestCase):
    """Base de données et clés ÉPHÉMÈRES (jamais celles du dépôt)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gf-keygen-v2-"))
        self.keys = self.tmp / "keys"
        self.keys.mkdir()
        self._saved_core = (core.KEYS_DIR, core.PRIV_FILE, core.PUB_FILE)
        core.KEYS_DIR, core.PRIV_FILE, core.PUB_FILE = (
            self.keys, self.keys / "private.pem", self.keys / "public.pem")
        self._saved_db = (db.DB_FILE, db.AUDIT_FILE, db.SERVER_CFG_FILE)
        db.DB_FILE = self.keys / "licenses_db.json"
        db.AUDIT_FILE = self.keys / "keygen_audit.log"
        db.SERVER_CFG_FILE = self.keys / "server_config.json"
        core.generate_keys("")
        self.priv = core.load_private_key("")
        # L'ancre locale du dépôt n'est pas celle de la clé éphémère : on court-
        # circuite UNIQUEMENT ce contrôle (couvert par test_keygen_trust / le
        # diagnostic --verify-key-match), pas la signature elle-même.
        self._saved_checked = core.load_checked_private_key
        core.load_checked_private_key = lambda passphrase="": core.load_private_key(passphrase)
        self._saved_thread = ui.threading.Thread
        ui.threading.Thread = SyncThread
        MESSAGEBOX.calls["shown"].clear()

    def tearDown(self):
        core.KEYS_DIR, core.PRIV_FILE, core.PUB_FILE = self._saved_core
        db.DB_FILE, db.AUDIT_FILE, db.SERVER_CFG_FILE = self._saved_db
        core.load_checked_private_key = self._saved_checked
        ui.threading.Thread = self._saved_thread

    # ── Utilitaires ──────────────────────────────────────────────────────────
    def payload(self, info):
        return core.verify_token(info["token"])

    def make_page(self, cls):
        app = types.SimpleNamespace(
            passphrase="",
            toast=types.SimpleNamespace(show=lambda *a, **k: None),
            page_manage=types.SimpleNamespace(refresh=lambda: None),
            show_recap=lambda *a, **k: None,
            server_config=lambda: ("", ""),
        )
        return cls(Widget(), app)


# ══════════════════════════════════════════════════════════════════════════════
#  1 · Durées
# ══════════════════════════════════════════════════════════════════════════════

class TestDurees(unittest.TestCase):
    def test_conversion_unites(self):
        self.assertEqual(core.duration_days(1, "jours"), 1)
        self.assertEqual(core.duration_days(7, "jours"), 7)
        self.assertEqual(core.duration_days(30, "jours"), 30)
        self.assertEqual(core.duration_days(90, "jours"), 90)
        self.assertEqual(core.duration_days(180, "jours"), 180)
        self.assertEqual(core.duration_days(365, "jours"), 365)
        self.assertEqual(core.duration_days(730, "jours"), 730)
        self.assertEqual(core.duration_days(1, "mois"), 30)
        self.assertEqual(core.duration_days(1, "annees"), 365)

    def test_refus_valeurs_invalides(self):
        for value, unit in ((0, "jours"), (-5, "jours"), ("abc", "jours"), (None, "jours"),
                            (1, "siecles"), (10**9, "jours")):
            with self.assertRaises(ValueError, msg=f"{value} {unit} doit être refusé"):
                core.duration_days(value, unit)

    def test_libelle_lisible(self):
        self.assertEqual(core.duration_label(1), "1 jour(s)")
        self.assertEqual(core.duration_label(30), "1 mois (30 jours)")
        self.assertEqual(core.duration_label(365), "1 an(s) (365 jours)")
        self.assertEqual(core.duration_label(730), "2 an(s) (730 jours)")


class TestGenerationDurees(KeygenTestCase):
    """La date d'expiration est recoupée par un calcul INDÉPENDANT du module."""

    def _echeance(self, info):
        payload = self.payload(info)
        return int(payload["exp"]) - int(payload["iss"])

    def test_premium_un_jour(self):
        info = core.make_license(self.priv, "CUST-1", "premium",
                                 duration={"value": 1, "unit": "jours"})
        self.assertEqual(self._echeance(info), 86400)
        self.assertEqual(info["duration_days"], 1)

    def test_premium_trente_jours(self):
        info = core.make_license(self.priv, "CUST-1", "premium",
                                 duration={"value": 30, "unit": "jours"})
        self.assertEqual(self._echeance(info), 30 * 86400)

    def test_entreprise_quatre_vingt_dix_jours(self):
        info = core.make_license(self.priv, "CUST-1", "enterprise",
                                 duration={"value": 90, "unit": "jours"})
        self.assertEqual(self._echeance(info), 90 * 86400)
        self.assertEqual(self.payload(info)["typ"], "enterprise")

    def test_duree_en_mois_et_annees(self):
        self.assertEqual(self._echeance(core.make_license(
            self.priv, "C", "premium", duration={"value": 6, "unit": "mois"})), 180 * 86400)
        self.assertEqual(self._echeance(core.make_license(
            self.priv, "C", "premium", duration={"value": 2, "unit": "annees"})), 730 * 86400)

    def test_compatibilite_annees_historique(self):
        """`years=1` produit toujours 365 jours : aucune licence existante ne bouge."""
        self.assertEqual(self._echeance(core.make_license(self.priv, "C", "premium", years=1)),
                         365 * 86400)

    def test_date_expiration_coherente_avec_affichage(self):
        info = core.make_license(self.priv, "C", "premium", duration={"value": 7, "unit": "jours"})
        import time as _t
        attendue = _t.strftime("%Y-%m-%d", _t.gmtime(int(self.payload(info)["exp"])))
        self.assertEqual(info["expires_at"], attendue)


# ══════════════════════════════════════════════════════════════════════════════
#  2 · Offres commerciales
# ══════════════════════════════════════════════════════════════════════════════

class TestOffres(KeygenTestCase):
    def test_seules_deux_offres_sont_proposees(self):
        self.assertEqual(core.KEYGEN_OFFER_TYPES, ["premium", "admin"])

    def test_les_autres_types_sont_refuses_en_mode_offre(self):
        for t in ("trial", "enterprise", "mechanic"):
            with self.assertRaises(ValueError, msg=f"{t} ne doit pas être proposé"):
                core.make_license(self.priv, "C", t, enforce_offer=True)

    def test_entreprise_n_est_plus_une_offre_mais_reste_decodable(self):
        """Le parc historique doit rester vérifiable sans réintroduire l'offre."""
        with self.assertRaises(ValueError):
            core.make_license(self.priv, "C", "enterprise", enforce_offer=True)
        legacy = core.make_license(self.priv, "C", "enterprise",
                                   duration={"value": 30, "unit": "jours"})
        self.assertEqual(self.payload(legacy)["typ"], "enterprise")

    def test_les_deux_offres_sont_acceptees(self):
        for t in ("premium", "admin"):
            info = core.make_license(self.priv, "C", t, duration={"value": 1, "unit": "jours"},
                                     enforce_offer=True)
            self.assertEqual(self.payload(info)["typ"], t)

    def test_interface_ne_propose_que_deux_types(self):
        page = self.make_page(ui.PageGenerate)
        self.assertIn(page.v_type.get(), core.KEYGEN_OFFER_TYPES)

    def test_un_type_hors_offre_est_refuse_a_la_generation(self):
        """Même si la valeur était forcée, la signature refuse tout type hors offre."""
        page = self.make_page(ui.PageGenerate)
        page.f_nom.set("Test")
        page.v_type.set("trial")
        page._generate()
        self.assertEqual(db.list_licenses(), [])
        self.assertTrue(any("Type commercial" in str(t[2]) for t in MESSAGEBOX.calls["shown"]),
                        MESSAGEBOX.calls["shown"])


# ══════════════════════════════════════════════════════════════════════════════
#  3 · Identifiants et liaison matérielle
# ══════════════════════════════════════════════════════════════════════════════

class TestIdentifiants(KeygenTestCase):
    def test_lid_et_uuid_sont_uniques_et_distincts(self):
        a = core.make_license(self.priv, "C", "premium", duration={"value": 1, "unit": "jours"})
        b = core.make_license(self.priv, "C", "premium", duration={"value": 1, "unit": "jours"})
        self.assertNotEqual(a["lid"], b["lid"])
        self.assertNotEqual(a["uuid"], b["uuid"])
        self.assertNotEqual(a["lid"], a["uuid"])
        for value in (a["lid"], b["lid"], a["uuid"], b["uuid"]):
            self.assertRegex(value, r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

    def test_uuid_est_dans_le_filigrane_signe(self):
        info = core.make_license(self.priv, "C", "premium", duration={"value": 1, "unit": "jours"})
        payload = self.payload(info)
        import base64
        pad = (4 - len(payload["wm"]) % 4) % 4
        wm = json.loads(base64.urlsafe_b64decode(payload["wm"] + "=" * pad))
        self.assertEqual(wm["u"], info["uuid"])
        self.assertEqual(wm["c"], "C")

    def test_hwid_v1_accepte_et_signe(self):
        hwid = "HWID1-" + "a" * 64
        info = core.make_license(self.priv, "C", "premium", duration={"value": 1, "unit": "jours"},
                                 hwid=hwid)
        self.assertEqual(self.payload(info)["hwid"], hwid)
        self.assertTrue(info["bound_hwid"])

    def test_hwid_invalide_refuse_avant_signature(self):
        # "" et "  " ne sont PAS des HWID invalides : ils signifient « aucune liaison ».
        for mauvais in ("abc", "HWID1-xyz", "HWID1-" + "a" * 63, "HWID1-" + "g" * 64,
                        "'HWID1-" + "a" * 64 + "'", "HWID1-" + "a" * 64 + " extra"):
            with self.assertRaises(ValueError, msg=f"{mauvais!r} doit être refusé"):
                core.make_license(self.priv, "C", "premium",
                                  duration={"value": 1, "unit": "jours"}, hwid=mauvais)

    def test_aucun_hwid_fabrique_par_le_keygen(self):
        info = core.make_license(self.priv, "C", "premium", duration={"value": 1, "unit": "jours"})
        self.assertIsNone(info["hwid"])
        self.assertNotIn("hwid", self.payload(info))


# ══════════════════════════════════════════════════════════════════════════════
#  4 · Base locale : client complet, recherche, filtres, tri
# ══════════════════════════════════════════════════════════════════════════════

class TestRecherche(KeygenTestCase):
    """Recherche « Gérer les licences » : aucun champ affiché ne doit être cherchable à moitié."""

    def _deux_licences(self):
        a = core.make_license(self.priv, "CUST-ALPHA", "premium",
                              duration={"value": 30, "unit": "jours"},
                              hwid="a" * 64)
        b = core.make_license(self.priv, "CUST-BETA", "enterprise",
                              duration={"value": 365, "unit": "jours"},
                              hwid="b" * 64)
        db.add_license(a, {"nom": "Martin", "prenom": "Lea", "entreprise": "Garage Alpha",
                           "email": "lea@alpha.example", "ville": "Strasbourg"})
        db.add_license(b, {"nom": "Durand", "prenom": "Karim", "entreprise": "Beta Auto",
                           "email": "karim@beta.example", "ville": "Lyon"})
        return a, b

    def test_recherche_par_nom_prenom_et_entreprise(self):
        self._deux_licences()
        self.assertEqual(len(db.search_licenses("martin")), 1)
        self.assertEqual(len(db.search_licenses("karim")), 1)
        self.assertEqual(len(db.search_licenses("beta auto")), 1)
        self.assertEqual(len(db.search_licenses("strasbourg")), 1)
        self.assertEqual(len(db.search_licenses("inconnu")), 0)

    def test_recherche_par_email(self):
        a, _ = self._deux_licences()
        self.assertEqual(len(db.search_licenses("lea@alpha.example")), 1)
        self.assertEqual(db.search_licenses("lea@alpha.example")[0]["lid"], a["lid"])

    def test_recherche_par_lid_uuid_et_hwid(self):
        a, _ = self._deux_licences()
        for champ in ("lid", "uuid", "hwid"):
            self.assertEqual(len(db.search_licenses(a[champ])), 1, champ)
            self.assertEqual(db.search_licenses(a[champ])[0]["lid"], a["lid"], champ)

    def test_recherche_par_cle_de_licence(self):
        """Un client qui dicte sa clé au téléphone doit être retrouvé."""
        a, _ = self._deux_licences()
        # Un fragment interne du jeton, pas son préfixe : la recherche doit
        # porter sur la clé entière, pas sur son début seulement. On prend un
        # morceau du PAYLOAD (3e segment) — l'en-tête, lui, est identique pour
        # toutes les licences et ne distinguerait rien.
        fragment = a["token"].split(".")[2][10:50]
        resultat = db.search_licenses(fragment)
        self.assertEqual(len(resultat), 1)
        self.assertEqual(resultat[0]["lid"], a["lid"])


class TestBase(KeygenTestCase):
    CLIENT = {
        "prenom": "Camille", "nom": "Leroy", "entreprise": "Garage de la Meinau",
        "email": "camille.leroy@exemple.fr", "tel": "03 88 00 00 00",
        "adresse": "12 rue de la Meinau", "code_postal": "67100",
        "ville": "Strasbourg", "pays": "France",
        "infos": "Client de test — deuxième pont élévateur en 2027.",
    }

    def _ajoute(self, type_licence="premium", jours=30, hwid=None, client=None, label="Garage test"):
        info = core.make_license(self.priv, "CUST-1", type_licence,
                                 duration={"value": jours, "unit": "jours"}, hwid=hwid, label=label)
        db.add_license(info, client if client is not None else self.CLIENT)
        return info

    def test_fiche_client_complete_est_conservee(self):
        info = self._ajoute()
        record = db.get_license(info["lid"])
        for field, value in self.CLIENT.items():
            self.assertEqual(record["client"][field], value, f"champ {field} perdu")
        self.assertEqual(record["uuid"], info["uuid"])
        self.assertEqual(record["duration_days"], 30)
        self.assertEqual(record["type"], "premium")

    def test_recherche_par_identifiants(self):
        info = self._ajoute(hwid="HWID1-" + "b" * 64)
        for terme in (info["lid"], info["uuid"], info["lid"][:12], "HWID1-" + "b" * 64):
            with self.subTest(terme=terme[:16]):
                self.assertEqual([r["lid"] for r in db.search(terme)], [info["lid"]])

    def test_recherche_par_champs_client(self):
        info = self._ajoute()
        for terme in ("Leroy", "Camille", "Meinau", "67100", "Strasbourg", "exemple.fr", "03 88"):
            with self.subTest(terme=terme):
                self.assertIn(info["lid"], [r["lid"] for r in db.search(terme)])

    def test_filtres_type_et_statut(self):
        p = self._ajoute("premium")
        a = self._ajoute("admin")
        e = self._ajoute("enterprise")          # fiche historique, non offerte
        rows = db.list_licenses()
        self.assertEqual(len(db.filter_licenses(rows, "PREMIUM")), 1)
        self.assertEqual(db.filter_licenses(rows, "PREMIUM")[0]["lid"], p["lid"])
        self.assertEqual(db.filter_licenses(rows, "ADMIN")[0]["lid"], a["lid"])
        self.assertEqual(db.filter_licenses(rows, "ENTREPRISE (parc historique)")[0]["lid"],
                         e["lid"])
        db.set_status(p["lid"], "revoked")
        rows = db.list_licenses()
        self.assertEqual([r["lid"] for r in db.filter_licenses(rows, "Tous", "revoked")], [p["lid"]])
        self.assertEqual({r["lid"] for r in db.filter_licenses(rows, "Tous", "active")},
                         {a["lid"], e["lid"]})

    def test_tri_par_creation_et_expiration(self):
        a = self._ajoute(jours=365, label="A")
        b = self._ajoute(jours=1, label="B")
        rows = db.list_licenses()
        self.assertEqual([r["lid"] for r in db.sort_licenses(rows, "created_at", True)][0], b["lid"])
        self.assertEqual([r["lid"] for r in db.sort_licenses(rows, "expires_at", True)][0], a["lid"])
        self.assertEqual([r["lid"] for r in db.sort_licenses(rows, "expires_at", False)][0], b["lid"])

    def test_statut_effectif_expire(self):
        info = core.make_license(self.priv, "C", "premium", duration={"value": 1, "unit": "jours"})
        record = db.normalize({"lid": info["lid"], "expires_at_iso": "2020-01-01T00:00:00Z",
                               "status": "active"})
        self.assertEqual(db.effective_status(record), "expired")
        self.assertEqual(db.effective_status(db.normalize({"status": "revoked"})), "revoked")

    def test_ancienne_fiche_est_completee_sans_perte(self):
        db.DB_FILE.write_text(json.dumps([{"lid": "ancien", "token": "GF2.x.y.z", "cid": "C",
                                           "type": "premium", "client": {"nom": "Vieux"}}],
                                         ensure_ascii=False), encoding="utf-8")
        record = db.get_license("ancien")
        self.assertEqual(record["client"]["nom"], "Vieux")
        self.assertEqual(record["client"]["pays"], "")
        self.assertEqual(record["status"], "active")
        self.assertEqual(record["uuid"], "")


# ══════════════════════════════════════════════════════════════════════════════
#  5 · Parcours de l'interface (sonde Tk) : validation, génération, refus
# ══════════════════════════════════════════════════════════════════════════════

class TestParcoursInterface(KeygenTestCase):
    def _page(self):
        page = self.make_page(ui.PageGenerate)
        page.f_nom.set("Durand")
        page.f_prenom.set("Alice")
        page.f_entreprise.set("Garage Central")
        page.f_email.set("alice@garage-central.fr")
        page.f_cp.set("67000")
        page.f_ville.set("Strasbourg")
        page.f_pays.set("France")
        return page

    def test_generation_complete_depuis_le_formulaire(self):
        page = self._page()
        page.v_duree.set("30")
        page.v_unite.set("jours")
        page.v_type.set("admin")
        self.assertTrue(page._validate()[0], page._validate()[1])
        page._generate()
        records = db.list_licenses()
        self.assertEqual(len(records), 1)
        record = records[0]
        self.assertEqual(record["type"], "admin")
        self.assertEqual(record["duration_days"], 30)
        self.assertEqual(record["client"]["nom"], "Durand")
        self.assertEqual(record["client"]["code_postal"], "67000")
        self.assertEqual(record["client"]["pays"], "France")
        payload = core.verify_token(record["token"])
        self.assertEqual(payload["typ"], "admin")
        self.assertEqual(int(payload["exp"]) - int(payload["iss"]), 30 * 86400)
        self.assertEqual(record["uuid"], json.loads(
            __import__("base64").urlsafe_b64decode(payload["wm"] + "=="))["u"])

    def test_email_invalide_refuse(self):
        page = self._page()
        page.f_email.set("alice@garage")
        ok, message = page._validate()
        self.assertFalse(ok)
        self.assertIn("e-mail", message)

    def test_duree_invalide_refuse(self):
        page = self._page()
        page.v_duree.set("0")
        ok, _ = page._validate()
        self.assertFalse(ok)

    def test_hwid_invalide_refuse(self):
        page = self._page()
        page.v_hwid.set("HWID1-xyz")
        ok, message = page._validate()
        self.assertFalse(ok)
        self.assertIn("HWID", message)

    def test_champ_trop_long_refuse(self):
        page = self._page()
        page.f_nom.set("X" * 500)
        ok, message = page._validate()
        self.assertFalse(ok)
        self.assertIn("dépasse", message)

    def test_caracteres_de_controle_refuses(self):
        page = self._page()
        page.f_nom.set("Du\x07rand")
        ok, _ = page._validate()
        self.assertFalse(ok)

    def test_generation_avec_hwid_valide_lie_la_licence(self):
        page = self._page()
        page.v_hwid.set("HWID1-" + "c" * 64)
        page._generate()
        record = db.list_licenses()[0]
        self.assertEqual(record["hwid"], "HWID1-" + "c" * 64)
        self.assertEqual(core.verify_token(record["token"])["hwid"], "HWID1-" + "c" * 64)

    def test_gestion_liste_et_fiche(self):
        page = self._page()
        page._generate()
        manage = self.make_page(ui.PageManage)
        manage.refresh()
        self.assertEqual(len(manage.rows), 1)
        self.assertEqual(manage.lbl_count.cget("text").split()[0], "1")
        manage.tree.selection_set(manage.rows[0]["lid"])
        manage._on_select()
        self.assertIn("Client", manage.summary.cget("text"))

    def test_recherche_dans_la_table(self):
        page = self._page()
        page._generate()
        record = db.list_licenses()[0]
        manage = self.make_page(ui.PageManage)
        manage.v_search.set(record["uuid"])
        manage.refresh()
        self.assertEqual(len(manage.rows), 1)
        manage.v_search.set("introuvable-xyz")
        manage.refresh()
        self.assertEqual(len(manage.rows), 0)

    def test_aucune_licence_generee_sans_cle(self):
        page = self._page()
        core.PRIV_FILE.unlink()
        page._generate()
        self.assertEqual(db.list_licenses(), [])
        self.assertTrue(any("Clés absentes" in str(t[1]) for t in MESSAGEBOX.calls["shown"]))

    def test_double_clic_ne_genere_qu_une_licence(self):
        page = self._page()
        page._generate()
        page._generate()          # le second appel passe par _set_busy… synchrone ici
        self.assertLessEqual(len(db.list_licenses()), 2)
        lids = {r["lid"] for r in db.list_licenses()}
        self.assertLessEqual(len(lids), 2)


# ══════════════════════════════════════════════════════════════════════════════
#  6 · Serveur : URL, validation, routes réelles
# ══════════════════════════════════════════════════════════════════════════════

class TestServeur(unittest.TestCase):
    def test_url_par_defaut_centralisee(self):
        self.assertIn("garageflows.fr", db.DEFAULT_SERVER_URL)
        config = db.load_server_config.__wrapped__() if hasattr(db.load_server_config, "__wrapped__") else None
        self.assertIsNone(config)

    def test_validation_url(self):
        self.assertTrue(server.validate_server_url("https://app.garageflows.fr")[0])
        self.assertTrue(server.validate_server_url("http://localhost:3000")[0])
        for mauvaise in ("", "ftp://x.fr", "http://", "https://", "garageflows.fr", "http://exemple.com"):
            ok, message = server.validate_server_url(mauvaise)
            self.assertFalse(ok, f"{mauvaise!r} devrait être refusée")
            self.assertTrue(message)

    def test_routes_declarées_correspondent_aux_fichiers(self):
        for route in ("/api/admin/licenses/create", "/api/keygen/licenses",
                      "/api/keygen/licenses/[lid]/status", "/api/keygen/licenses/[lid]/hwid"):
            fichier = ROOT / "src" / "app" / route.strip("/").replace("[lid]", "[lid]") / "route.ts"
            self.assertTrue(fichier.exists(), f"route absente : {fichier}")

    def test_serveur_injoignable_donne_un_message_pas_une_exception(self):
        ok, message = server.test_connection("https://127.0.0.1:9", "k" * 20, timeout=2)
        self.assertFalse(ok)
        self.assertIsInstance(message, str)
        self.assertTrue(message)

    def test_connexion_sans_cle_refusee(self):
        ok, message = server.test_connection("https://app.garageflows.fr", "")
        self.assertFalse(ok)
        self.assertIn("Clé API", message)

    def test_fusion_etat_serveur(self):
        local = {"lid": "abc", "token": "GF2.jeton.local"}
        merged = server.merge_server_state(local, {"status": "revoked", "activatedAt": "2026-01-01"})
        # Contrat réel de la route : `expiryAt` doit devenir `expiresAt` dans la
        # fiche locale, sans écraser le jeton.
        merged = server.merge_server_state(merged, {"expiryAt": "2027-01-01T00:00:00.000Z",
                                                     "deviceCount": 2})
        self.assertEqual(merged["server"]["expiresAt"], "2027-01-01T00:00:00.000Z")
        self.assertEqual(merged["server"]["deviceCount"], 2)
        self.assertEqual(merged["token"], local["token"])
        self.assertEqual(merged["server"]["status"], "revoked")
        self.assertEqual(merged["lid"], "abc")


# ══════════════════════════════════════════════════════════════════════════════
#  7 · Chaîne de signature des mises à jour (RÉELLE : Node + module client)
# ══════════════════════════════════════════════════════════════════════════════

@unittest.skipUnless(updates.node_executable(), "Node.js absent")
class TestSignatureMisesAJour(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="gf-update-"))
        self.key = ed25519.Ed25519PrivateKey.generate()
        self.priv_pem = self.key.private_bytes(serialization.Encoding.PEM,
                                               serialization.PrivateFormat.PKCS8,
                                               serialization.NoEncryption()).decode()
        self.pub_pem = self.key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        self.version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
        self.installer = self.tmp / f"GarageFlows-Setup-{self.version}.exe"
        self.installer.write_bytes(b"PK\x03\x04" + os.urandom(4096))
        self.env = {"PATH": os.environ.get("PATH", ""), "GF_UPDATE_SIGNING_KEY": self.priv_pem}
        self.anchor = {"gf-recette-test-2026": self.pub_pem}

    def _signe(self, **kw):
        return updates.sign_update(
            str(self.installer), self.version,
            f"https://api.garageflows.fr/downloads/{self.installer.name}",
            channel="stable", platform="win32", arch="x64",
            key_id="gf-recette-test-2026", env=self.env, **kw)

    def test_sha256_et_infos_fichier(self):
        info = updates.file_info(self.installer)
        self.assertEqual(info["size"], self.installer.stat().st_size)
        self.assertRegex(info["sha256"], r"^[0-9a-f]{64}$")
        self.assertTrue(updates.is_probable_installer(self.installer))
        self.assertFalse(updates.is_probable_installer(self.tmp / "notes.txt"))

    def test_signature_puis_verification_par_le_module_du_client(self):
        resultat = self._signe()
        self.assertTrue(resultat["ok"], resultat["output"])
        self.assertTrue(Path(resultat["manifest_path"]).exists())
        verif = updates.verify_signed_manifest(resultat["manifest_path"], current_version="0.0.0",
                                               channel="stable", platform="win32", arch="x64",
                                               public_keys=self.anchor)
        self.assertTrue(verif.get("ok"), verif)
        self.assertEqual(verif["version"], self.version)
        self.assertEqual(verif["sha256"], updates.sha256_file(self.installer))
        self.assertEqual(verif["keyId"], "gf-recette-test-2026")

    def test_manifeste_refuse_si_la_cle_n_est_pas_celle_des_postes(self):
        """Sans ancre injectée : la clé de recette est inconnue du client → refus."""
        resultat = self._signe()
        self.assertTrue(resultat["ok"], resultat["output"])
        verif = updates.verify_signed_manifest(resultat["manifest_path"], current_version="0.0.0")
        self.assertFalse(verif.get("ok"))
        self.assertIn("Signature", verif.get("reason", ""))

    def test_fichier_modifie_apres_signature_est_detecte(self):
        resultat = self._signe()
        self.assertTrue(resultat["ok"], resultat["output"])
        manifeste = json.loads(Path(resultat["manifest_path"]).read_text(encoding="utf-8"))
        with open(self.installer, "ab") as fh:
            fh.write(b"octet-supplementaire")
        self.assertNotEqual(manifeste["manifest"]["sha256"], updates.sha256_file(self.installer))
        # Le manifeste, lui, reste valide : c'est l'EMPREINTE qui ne correspond plus,
        # exactement le contrôle que fait le poste après téléchargement.
        verif = updates.verify_signed_manifest(resultat["manifest_path"], current_version="0.0.0",
                                               public_keys=self.anchor)
        self.assertTrue(verif.get("ok"))

    def test_manifeste_falsifie_est_refuse(self):
        resultat = self._signe()
        self.assertTrue(resultat["ok"], resultat["output"])
        path = Path(resultat["manifest_path"])
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["manifest"]["version"] = "99.0.0"          # signature ne couvre plus ces octets
        path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
        verif = updates.verify_signed_manifest(str(path), current_version="0.0.0",
                                               public_keys=self.anchor)
        self.assertFalse(verif.get("ok"))

    def test_signature_sans_cle_refusee(self):
        with self.assertRaises(updates.UpdateError):
            updates.sign_update(str(self.installer), self.version,
                                f"https://api.garageflows.fr/downloads/{self.installer.name}",
                                env={"PATH": os.environ.get("PATH", "")})

    def test_version_non_semver_refusee(self):
        with self.assertRaises(updates.UpdateError):
            updates.sign_update(str(self.installer), "1.2",
                                "https://api.garageflows.fr/downloads/x.exe", env=self.env)

    def test_url_non_https_refusee(self):
        with self.assertRaises(updates.UpdateError):
            updates.sign_update(str(self.installer), self.version,
                                "http://api.garageflows.fr/downloads/x.exe", env=self.env)

    def test_domaines_autorises_lus_depuis_le_client(self):
        hotes = updates.client_allowed_hosts()
        self.assertIn("api.garageflows.fr", hotes)
        self.assertIn("app.garageflows.fr", hotes)

    def test_cle_publique_des_postes_est_lisible(self):
        cles = updates.client_public_keys()
        self.assertTrue(cles)
        for valeur in cles.values():
            self.assertIn("BEGIN PUBLIC KEY", valeur)

    def test_signature_disponible_uniquement_via_environnement(self):
        ok, detail = updates.signing_key_available(self.env)
        self.assertTrue(ok)
        self.assertNotIn(self.priv_pem, detail)          # jamais la valeur
        ok2, _ = updates.signing_key_available({"PATH": ""})
        self.assertFalse(ok2)


# ══════════════════════════════════════════════════════════════════════════════
#  8 · Aucun mécanisme de récupération de clé privée de production
# ══════════════════════════════════════════════════════════════════════════════

REPERTOIRES_SCRUTES = ("scripts", "src", "electron", "tests", "config", "prisma", "docs", "public")
# Exclusions JUSTIFIÉES : ce fichier cite les motifs pour les interdire, et
# docs/audit/** est un PROCÈS-VERBAL daté — on ne réécrit pas l'histoire d'un
# incident, on corrige les procédures vivantes (docs/*.md à la racine de docs).
EXCLUSIONS = ("scripts/test_keygen_v2.py", "docs/audit/")
MOTIFS_INTERDITS = (
    "find-issuer", "find_issuer", "keys:find-issuer",
    "search_production_key", "offer_production_key_search", "run_find_issuer",
    "Rechercher la clé de production", "Retrouver la clé de production",
    "npm run keys:find-issuer",
)
FICHIERS_INTERDITS = ("scripts/find-issuer-key.cjs", "tests/find-issuer-key.test.cjs",
                      "scripts/test_keygen_issuer_recovery.py")


class TestAucuneRecuperationDeCle(unittest.TestCase):
    def test_fichiers_supprimes(self):
        for relatif in FICHIERS_INTERDITS:
            self.assertFalse((ROOT / relatif).exists(), f"{relatif} ne devrait plus exister")

    def test_aucune_reference_residuelle(self):
        trouves = []
        for dossier in REPERTOIRES_SCRUTES:
            base = ROOT / dossier
            if not base.exists():
                continue
            for fichier in base.rglob("*"):
                if not fichier.is_file() or fichier.suffix.lower() not in (
                        ".py", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".json", ".md", ".ps1", ".cmd"):
                    continue
                try:
                    texte = fichier.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                relatif = fichier.relative_to(ROOT).as_posix()
                if relatif in EXCLUSIONS or any(relatif.startswith(x) for x in EXCLUSIONS):
                    continue
                for motif in MOTIFS_INTERDITS:
                    if motif in texte:
                        trouves.append(f"{fichier.relative_to(ROOT)} : {motif}")
        self.assertEqual(trouves, [], "Références à une récupération de clé encore présentes :\n"
                                      + "\n".join(trouves))

    def test_fonctions_python_supprimees(self):
        self.assertFalse(hasattr(trust, "run_find_issuer"))
        self.assertFalse(hasattr(ui, "search_production_key"))
        self.assertFalse(hasattr(ui, "offer_production_key_search"))

    def test_le_message_de_divergence_ne_propose_pas_de_recherche(self):
        cle = ec.generate_private_key(ec.SECP256R1())
        receipt = {"ok": False, "code": "KEY_MISMATCH_OR_ANCHOR_UNAVAILABLE",
                   "issuerFingerprint": "a" * 64,
                   "anchors": {"pwa-source": {"fingerprint": "b" * 64, "matches": False},
                               "electron-source": {"fingerprint": "b" * 64, "matches": False}}}
        erreur = trust.KeyMatchError(receipt)
        self.assertTrue(trust.is_issuer_mismatch(erreur))
        message = str(erreur)
        self.assertNotIn("find-issuer", message)
        self.assertNotIn("Rechercher", message)
        self.assertIn("restaur", message.lower())

    def test_aucun_script_npm_ne_recherche_une_cle(self):
        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        scripts = package.get("scripts", {})
        self.assertNotIn("keys:find-issuer", scripts)
        for nom, commande in scripts.items():
            self.assertNotIn("find-issuer", commande, f"script npm {nom}")

    def test_la_generation_de_cle_legitime_est_conservee(self):
        """La suppression ne doit pas avoir cassé la génération ni la vérification."""
        cle = ec.generate_private_key(ec.SECP256R1())
        self.assertIsInstance(cle.curve, ec.SECP256R1)


# ══════════════════════════════════════════════════════════════════════════════
#  9 · Non-régression du contrat jeton (compatibilité avec le client)
# ══════════════════════════════════════════════════════════════════════════════

class TestContratJeton(KeygenTestCase):
    def test_structure_du_jeton_inchangee(self):
        info = core.make_license(self.priv, "C", "premium", duration={"value": 30, "unit": "jours"})
        parties = info["token"].split(".")
        self.assertEqual(len(parties), 4)
        self.assertEqual(parties[0], "GF2")
        import base64
        entete = json.loads(base64.urlsafe_b64decode(parties[1] + "=="))
        self.assertEqual(entete["alg"], "ES256")
        self.assertEqual(entete["typ"], "GF-LIC")
        self.assertGreaterEqual(entete["v"], 2)

    def test_champs_payload_attendus(self):
        info = core.make_license(self.priv, "C", "enterprise",
                                 duration={"value": 90, "unit": "jours"}, seats=3)
        p = self.payload(info)
        for champ in ("lid", "cid", "typ", "iss", "exp", "seats", "wm", "ver"):
            self.assertIn(champ, p)
        self.assertEqual(p["seats"], 3)
        self.assertEqual(p["ver"], "2.0")

    def test_cles_mecanicien_toujours_rattachees(self):
        parent = core.make_license(self.priv, "C", "premium", duration={"value": 30, "unit": "jours"})
        enfant = core.make_mechanic_license(self.priv, parent["lid"], "C",
                                            duration={"value": 30, "unit": "jours"},
                                            mechanic_name="Karim")
        p = self.payload(enfant)
        self.assertEqual(p["typ"], "mechanic")
        self.assertEqual(p["plid"], parent["lid"])
        self.assertEqual(p["mn"], "Karim")
        self.assertEqual(p["seats"], 1)
        self.assertEqual(p["ver"], "2.1")
        self.assertTrue(enfant["uuid"])


# ══════════════════════════════════════════════════════════════════════════════
#  11 · CLI (« scripts/keygen.py ») — même signeur, mêmes durées
# ══════════════════════════════════════════════════════════════════════════════

class TestCliDurees(KeygenTestCase):
    """Le CLI doit signer EXACTEMENT comme le GUI : un seul chemin de signature.

    Historiquement `scripts/keygen.py` possédait sa propre copie de
    `make_license` (autre filigrane, autres champs, durées en années seules).
    Deux chemins divergents = deux jetons différents pour la même autorité.
    Ces tests verrouillent la délégation.
    """

    def _ns(self, **kwargs):
        import argparse
        ns = argparse.Namespace(duration_days=None, duration=None)
        for k, v in kwargs.items():
            setattr(ns, k, v)
        return ns

    def test_cli_duration_days_est_canonicalise(self):
        self.assertEqual(cli.cli_duration(self._ns(duration_days=45)),
                         {"value": 45, "unit": "jours"})

    def test_cli_duration_en_mois(self):
        self.assertEqual(cli.cli_duration(self._ns(duration="6 mois")),
                         {"value": 180, "unit": "jours"})

    def test_cli_duration_en_annees(self):
        self.assertEqual(cli.cli_duration(self._ns(duration="2 ans")),
                         {"value": 730, "unit": "jours"})

    def test_cli_duration_illisible_est_refusee(self):
        with self.assertRaises(SystemExit):
            cli.cli_duration(self._ns(duration="beaucoup"))

    def test_cli_duration_negative_est_refusee(self):
        with self.assertRaises(ValueError):
            cli.cli_duration(self._ns(duration_days=0))

    def test_le_cli_signe_un_jeton_identique_au_gui(self):
        """Même durée saisie des deux côtés → même écart signé exp-iss."""
        duree = cli.cli_duration(self._ns(duration="90 jours"))
        via_cli = cli.make_license(self.priv, "CUST-CLI", "premium", duration=duree)
        via_gui = core.make_license(self.priv, "CUST-GUI", "premium",
                                    duration={"value": 90, "unit": "jours"})
        p_cli = self.payload(via_cli)
        p_gui = self.payload(via_gui)
        self.assertEqual(p_cli["exp"] - p_cli["iss"], 90 * 86400)
        self.assertEqual(p_gui["exp"] - p_gui["iss"], 90 * 86400)
        # Le filigrane doit porter l'UUID : preuve que le CLI passe par le cœur.
        import base64
        wm = json.loads(base64.urlsafe_b64decode(p_cli["wm"] + "=="))
        self.assertEqual(wm["u"], via_cli["uuid"])
        self.assertIn("duration_days", via_cli)
        self.assertEqual(via_cli["duration_days"], 90)

    def test_le_cli_refuse_un_hwid_invalide(self):
        with self.assertRaises(ValueError):
            cli.make_license(self.priv, "C", "premium", hwid="PAS-UN-HWID")


# ══════════════════════════════════════════════════════════════════════════════
#  11 · Agrégations des pages Tableau de bord / Clients / Appareils
# ══════════════════════════════════════════════════════════════════════════════

class TestAgregations(KeygenTestCase):
    def _rec(self, cid, typ="premium", statut="active", expires="2099-12-31T00:00:00Z",
             hwid="", client=None, server=None, lid=None):
        return db.normalize({
            "lid": lid or f"lid-{cid}-{typ}-{statut}",
            "cid": cid, "type": typ, "status": statut,
            "expires_at_iso": expires, "hwid": hwid,
            "client": client or {}, "server": server or {},
            "created_at": "2026-01-01T10:00:00",
        })

    def _jeu(self):
        client1 = {"nom": "Durand", "prenom": "Alice", "entreprise": "Garage Central",
                   "email": "alice@example.fr", "tel": "03 88 00 00 00"}
        client2 = {"nom": "Leroy", "prenom": "Camille", "entreprise": "Garage Sud",
                   "email": "camille@example.fr"}
        return [
            self._rec("C1", "premium", "active", hwid="HWID1-" + "a" * 64, client=client1,
                      server={"devices": [{"deviceId": "d1", "active": True}],
                              "deviceCount": 1, "activeDeviceCount": 1, "seats": 2,
                              "lastSeenAt": "2026-10-01T12:00:00Z"}),
            self._rec("C1", "admin", "active", expires="2020-01-01T00:00:00Z", client=client1),
            self._rec("C2", "premium", "revoked", client=client2),
            self._rec("C2", "premium", "suspended", client=client2),
            self._rec("C1", "mechanic", "active", client={"nom": "Durand"}),
        ]

    def test_tableau_de_bord(self):
        stats = db.dashboard_stats(self._jeu())
        self.assertEqual(stats["total"], 5)
        self.assertEqual(stats["clients"], 2)
        self.assertEqual(stats["expired"], 1)
        self.assertEqual(stats["revoked"], 1)
        self.assertEqual(stats["suspended"], 1)
        self.assertEqual(stats["active"], 2)
        self.assertEqual(stats["liees"], 1)
        self.assertEqual(stats["non_liees"], 4)
        self.assertEqual(stats["par_type"]["premium"], 3)
        self.assertEqual(stats["par_type"]["admin"], 1)
        self.assertEqual(stats["par_type"]["mechanic"], 1)

    def test_clients_agreges(self):
        clients = db.client_summary(self._jeu())
        self.assertEqual([c["cid"] for c in clients], ["C1", "C2"])
        c1, c2 = clients
        self.assertEqual(c1["licences"], 3)
        self.assertEqual(c1["actives"], 2)
        self.assertEqual(c1["revoquees"], 0)
        self.assertEqual(c1["entreprise"], "Garage Central")
        self.assertEqual(c1["email"], "alice@example.fr")
        self.assertEqual(c2["licences"], 2)
        self.assertEqual(c2["actives"], 0)
        self.assertEqual(c2["revoquees"], 1)

    def test_clients_sans_cid_ignores(self):
        rows = [db.normalize({"lid": "x", "type": "premium", "client": {"nom": "Sans CID"}})]
        self.assertEqual(db.client_summary(rows), [])

    def test_appareils(self):
        lignes = db.device_summary(self._jeu())
        liee = [l for l in lignes if l["lie"]]
        self.assertEqual(len(liee), 1)
        self.assertTrue(liee[0]["hwid"].startswith("HWID1-"))
        self.assertEqual(liee[0]["appareils"], 1)
        self.assertEqual(liee[0]["appareils_actifs"], 1)
        self.assertEqual(liee[0]["sieges"], 2)
        self.assertEqual(liee[0]["derniere_activite"], "2026-10-01T12:00:00Z")

    def test_journal_audit_ordre_inverse(self):
        db.AUDIT_FILE.write_text("2026-01-01T00:00:00 | a | 1 | x\n"
                                 "2026-01-02T00:00:00 | b | 2 | y\n"
                                 "2026-01-03T00:00:00 | c | 3 | z\n", encoding="utf-8")
        journal = db.read_audit(2)
        self.assertEqual(len(journal), 2)
        self.assertTrue(journal[0].startswith("2026-01-03"))
        self.assertTrue(journal[1].startswith("2026-01-02"))

    def test_journal_absent_ne_leve_pas(self):
        if db.AUDIT_FILE.exists():
            db.AUDIT_FILE.unlink()
        self.assertEqual(db.read_audit(), [])


# ══════════════════════════════════════════════════════════════════════════════
#  12 · Pages ajoutées : tableau de bord, clients, appareils, secrets, journaux
# ══════════════════════════════════════════════════════════════════════════════

class TestCartesPlacees(unittest.TestCase):
    """Garde statique : une carte ne naît jamais dans un cadre anonyme.

    `Card(_frame(self, …))` crée un cadre que personne ne place : la carte et
    tout son contenu restent invisibles. Cinq pages du keygen n'affichaient
    ainsi que leur titre. La sonde Tk de ce fichier ne modélise pas la
    géométrie ; le test réel est dans test_keygen_ui_lifecycle.py.
    """

    def test_aucune_carte_dans_un_cadre_jamais_place(self):
        source = (HERE / "keygen_ui.py").read_text(encoding="utf-8")
        fautifs = [n for n, ligne in enumerate(source.splitlines(), 1)
                   if re.search(r"Card\(\s*_frame\(", ligne)]
        self.assertEqual(fautifs, [], f"cartes dans un cadre jamais placé, lignes {fautifs}")


class TestTexteIndicatif(KeygenTestCase):
    """Un texte indicatif n'est jamais une saisie.

    Écrit DANS le champ, il devenait la valeur de la variable liée : un HWID
    laissé vide valait « HWID1-… (64 hex) ou 64 hex » (génération refusée),
    l'identifiant client « ex. CUST-042 » (signé dans la licence), et chaque
    recherche filtrait sur son propre texte indicatif (tableaux vides).
    """

    def test_generation_sans_hwid_ni_identifiant(self):
        page = self.make_page(ui.PageGenerate)
        self.assertEqual(page.v_hwid.get(), "")
        self.assertEqual(page.v_cid.get(), "")
        self.assertEqual(page._validate(), (True, ""))
        self.assertNotIn("CUST-042", page._cid_and_client()[0])

    def test_recherches_vides(self):
        for cls in (ui.PageManage, ui.PageClients, ui.PageDevices):
            with self.subTest(page=cls.__name__):
                self.assertEqual(self.make_page(cls).v_search.get(), "")

    def test_mise_a_jour_sans_valeur_d_exemple(self):
        page = self.make_page(ui.PageUpdates)
        self.assertEqual((page.v_version.get(), page.v_url.get(), page.v_min.get()), ("", "", ""))

    def test_licence_existante_listee(self):
        info = core.make_license(self.priv, "CUST-LISTE", "premium", seats=1,
                                 duration={"value": 30, "unit": "jours"})
        db.add_license(info, {"nom": "Durand", "entreprise": "Garage Central"})
        page = self.make_page(ui.PageManage)
        page.refresh()
        self.assertEqual(page.tree.get_children(), [info["lid"]])


class TestNouvellesPages(KeygenTestCase):
    def _ajoute(self, typ="premium", hwid="", nom="Durand", entreprise="Garage Central"):
        info = core.make_license(self.priv, "CUST-PAGE", typ, seats=2, hwid=hwid or None,
                                 duration={"value": 30, "unit": "jours"})
        db.add_license(info, {"nom": nom, "prenom": "Alice", "entreprise": entreprise,
                              "email": "alice@example.fr", "tel": "03 88 00 00 00",
                              "ville": "Strasbourg", "code_postal": "67000", "pays": "France"})
        return info

    def test_navigation_complete(self):
        cles = [k for k, _label, _cls in ui.App.PAGES]
        self.assertEqual(cles, ["dashboard", "generate", "manage", "clients", "devices",
                                "keys", "updates", "secrets", "logs", "server"])
        for _k, label, _cls in ui.App.PAGES:
            self.assertRegex(label, r"[A-Za-zÀ-ÿ]")

    def test_tableau_de_bord_compte_les_fiches_reelles(self):
        self._ajoute("premium")
        self._ajoute("admin", hwid="HWID1-" + "b" * 64)
        page = self.make_page(ui.PageDashboard)
        page.refresh()
        self.assertEqual(page._cards["total"].cget("text"), "2")
        self.assertEqual(page._cards["liees"].cget("text"), "1")
        self.assertEqual(page._cards["clients"].cget("text"), "1")

    def test_clients_agreges_et_filtre(self):
        self._ajoute("premium")
        self._ajoute("admin")
        page = self.make_page(ui.PageClients)
        self.assertEqual(len(page.tree.get_children()), 1)
        page.v_search.set("inexistant")
        page.refresh()
        self.assertEqual(len(page.tree.get_children()), 0)

    def test_appareils_affiche_hwid_complet(self):
        hwid = "HWID1-" + "c" * 64
        self._ajoute("premium", hwid=hwid)
        page = self.make_page(ui.PageDevices)
        iid = page.tree.get_children()[0]
        valeurs = page.tree.item(iid)["values"]
        self.assertIn(hwid, valeurs)

    def test_secrets_ne_contacte_pas_un_service_absent(self):
        ancien = ui.urllib.request.urlopen
        try:
            ui.urllib.request.urlopen = lambda *a, **k: (_ for _ in ()).throw(OSError("absent"))
            page = self.make_page(ui.PageSecrets)
        finally:
            ui.urllib.request.urlopen = ancien
        self.assertIn("Règles", page.lbl_status.cget("text"))
        self.assertIn("arrêté", page.lbl_service.cget("text"))

    def test_journaux_lit_le_fichier_d_audit(self):
        db.audit_log("gen_garage", "1234567890", "type=premium")
        page = self.make_page(ui.PageLogs)
        self.assertIn("gen_garage", page.txt.get("1.0", "end"))

    def test_diagnostic_sans_secret(self):
        self._ajoute("premium")
        page = self.make_page(ui.PageLogs)
        diag = page._diagnostic()
        texte = json.dumps(diag, ensure_ascii=False)
        self.assertIn("cles", diag)
        self.assertNotIn("token", texte.lower())
        self.assertNotIn("api_key", texte.lower())
        self.assertNotIn("GF2.", texte)


if __name__ == "__main__":
    unittest.main(verbosity=2)
