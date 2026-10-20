"""
keygen_ui.py — GarageFlows Licence Manager — interface graphique (tkinter)

Une application de métier, pas une succession de champs :
  · navigation latérale, une seule vue active à la fois ;
  · cartes, hiérarchie typographique, états visuels (chargement, succès, erreur) ;
  · tables à défilement horizontal ET vertical, identifiants jamais tronqués ;
  · notifications non bloquantes, confirmations explicites sur tout acte irréversible.

SÉCURITÉ — CE QUE CETTE INTERFACE NE FAIT PAS
  Aucune fonction n'affiche, n'exporte, ne recherche ni ne reconstruit une clé
  privée. La clé privée de licence est lue dans keys/private.pem (éventuellement
  chiffrée par passphrase) et la clé de signature des mises à jour dans
  l'environnement de l'opérateur. Une clé perdue se RESTAURE depuis une
  sauvegarde, elle ne se recalcule pas.

Diagnostic sans interface :
    python scripts/keygen_ui.py --verify-key-match [--ask-passphrase]
"""

import sys
import os
# Dispatch du mode diagnostic AVANT tout import Tk ou ouverture de base.
if __name__ == "__main__" and "--verify-key-match" in sys.argv[1:]:
    from keygen_trust import main as _key_match_main
    sys.exit(_key_match_main(sys.argv[1:]))

import json as _json
import re
import subprocess
import threading
import time
import tkinter as tk
import urllib.error
import urllib.request
from pathlib import Path
from tkinter import ttk, messagebox, filedialog

import keygen_core as core
import keygen_db   as db
import keygen_server as server
import keygen_updates as updates
from keygen_trust import is_issuer_mismatch

HERE = Path(__file__).resolve().parent


def _max_mechanic() -> int:
    """Limite de clés mécanicien par génération (env GF_KEYGEN_MAX_MECHANIC, défaut 20)."""
    try:
        val = int(os.environ.get("GF_KEYGEN_MAX_MECHANIC", ""))
        return val if val >= 1 else 20
    except (TypeError, ValueError):
        return 20


# ── Thème ────────────────────────────────────────────────────────────────────
BG        = "#0b1120"     # fond de l'application
SURFACE   = "#111a2e"     # cartes
SURFACE_2 = "#16203a"     # champs, sous-blocs
BORDER    = "#23304d"     # séparateurs
TEXT      = "#f1f5f9"
MUTED     = "#8494ad"
ACCENT    = "#4f8cff"
ACCENT_D  = "#2f6ae0"
GREEN     = "#34d399"
RED       = "#f87171"
AMBER     = "#fbbf24"
VIOLET    = "#a78bfa"

FONT_UI   = ("Segoe UI", 10)
FONT_SM   = ("Segoe UI", 9)
FONT_XS   = ("Segoe UI", 8)
FONT_B    = ("Segoe UI", 10, "bold")
FONT_H1   = ("Segoe UI", 18, "bold")
FONT_H2   = ("Segoe UI", 13, "bold")
FONT_H3   = ("Segoe UI", 10, "bold")
MONO      = ("Cascadia Mono", "Consolas", "DejaVu Sans Mono", "monospace")

STATUS_LABEL = {
    "active":    "Active",
    "revoked":   "Révoquée",
    "suspended": "Suspendue",
    "expired":   "Expirée",
}
STATUS_COLOR = {
    "active":    GREEN,
    "revoked":   RED,
    "suspended": AMBER,
    "expired":   AMBER,
}
TYPE_LABEL = {
    "premium":    "PREMIUM",
    "enterprise": "ENTREPRISE",
    "mechanic":   "MÉCANICIEN",
    "trial":      "STANDARD",
    "admin":      "ADMIN",
}


# ── Cycle de vie des widgets (anti-TclError) ─────────────────────────────────
#
# Les appels réseau tournent dans des threads afin de ne pas geler l'interface,
# et reviennent vers Tk via `.after(0, …)`. Entre la PLANIFICATION du retour et
# son EXÉCUTION, l'utilisateur peut avoir fermé la fenêtre concernée : le widget
# n'existe alors plus côté Tcl et toute référence à son chemin lève
#     _tkinter.TclError: bad window path name
# Règles appliquées partout ci-dessous :
#   · aucune opération Tk depuis un thread secondaire : on repasse par `.after` ;
#   · le widget est revérifié AU MOMENT de l'exécution, pas à la planification ;
#   · un parent détruit n'est jamais transmis à une boîte de dialogue ;
#   · le callback d'un composant fermé est ignoré — MAIS l'erreur réseau
#     sous-jacente, elle, n'est jamais avalée : elle est journalisée sur stderr.

def _widget_alive(widget) -> bool:
    """Le widget existe-t-il encore côté Tcl ?

    À n'appeler QUE depuis le thread de la boucle Tk : `winfo_exists` lève
    « main thread is not in main loop » depuis un thread secondaire.
    """
    if widget is None:
        return False
    try:
        return bool(widget.winfo_exists())
    except (tk.TclError, RuntimeError):
        return False


def _live_parent(*candidates):
    """Premier widget encore vivant parmi `candidates`, sinon None."""
    for w in candidates:
        if _widget_alive(w):
            return w
    return None


def _dialog(kind: str, title: str, message: str, *parents):
    """Boîte de dialogue dont le `parent` est garanti vivant (ou omis)."""
    show = getattr(messagebox, kind)
    parent = _live_parent(*parents)
    if parent is not None:
        return show(title, message, parent=parent)
    return show(title, message)


def _info(title, message, *parents):
    return _dialog("showinfo", title, message, *parents)


def _error(title, message, *parents):
    return _dialog("showerror", title, message, *parents)


def _warn(title, message, *parents):
    return _dialog("showwarning", title, message, *parents)


def _ui(widget, fn):
    """Planifie `fn` sur la boucle Tk de `widget`, en l'ignorant s'il a disparu."""
    def _run():
        if not _widget_alive(widget):
            return
        try:
            fn()
        except tk.TclError as exc:
            print(f"[keygen] callback UI ignoré (widget fermé) : {exc}", file=sys.stderr)

    try:
        widget.after(0, _run)
    except tk.TclError:
        pass
    except RuntimeError as exc:
        print(f"[keygen] retour UI non délivré (boucle Tk arrêtée) : {exc}", file=sys.stderr)


def _background(widget, work, on_done=None, on_error=None):
    """Exécute `work()` dans un thread ; `on_done(résultat)` / `on_error(message)` sur Tk."""
    def _run():
        try:
            result = work()
        except Exception as exc:                      # noqa: BLE001 — remonté à l'utilisateur
            _ui(widget, lambda msg=str(exc): (on_error(msg) if on_error
                                              else _error("Erreur", msg, widget)))
            return
        if on_done is not None:
            _ui(widget, lambda: on_done(result))
    threading.Thread(target=_run, daemon=True).start()


# ── Composants ───────────────────────────────────────────────────────────────

def _frame(parent, bg=None, padx=0, pady=0):
    return tk.Frame(parent, bg=bg if bg is not None else parent.cget("bg"), padx=padx, pady=pady)


def _lbl(parent, text, fg=TEXT, font=FONT_UI, bg=None, **kw):
    return tk.Label(parent, text=text, fg=fg, bg=bg if bg is not None else parent.cget("bg"),
                    font=font, **kw)


class Card(tk.Frame):
    """Carte : fond légèrement plus clair, bordure fine, padding régulier."""

    def __init__(self, master, padx=18, pady=16, bg=SURFACE):
        super().__init__(master, bg=bg, padx=padx, pady=pady,
                         highlightthickness=1, highlightbackground=BORDER,
                         highlightcolor=BORDER)


class Button(tk.Button):
    """Bouton plat, cohérent, avec état actif identique (pas de clignotement)."""

    def __init__(self, master, text, command=None, style="ghost", width=None, **kw):
        styles = {
            "primary": dict(bg=ACCENT,   fg="#ffffff", activebackground=ACCENT_D, activeforeground="#ffffff"),
            "danger":  dict(bg="#3b1220", fg=RED,      activebackground="#4d1729", activeforeground=RED),
            "success": dict(bg="#0d2f26", fg=GREEN,    activebackground="#11402f", activeforeground=GREEN),
            "warn":    dict(bg="#33260a", fg=AMBER,    activebackground="#453210", activeforeground=AMBER),
            "ghost":   dict(bg=SURFACE_2, fg=TEXT,     activebackground="#1d2b4a", activeforeground=TEXT),
        }
        conf = styles.get(style, styles["ghost"])
        super().__init__(master, text=text, command=command, font=FONT_B, relief="flat",
                         bd=0, cursor="hand2", padx=14, pady=7,
                         highlightthickness=1, highlightbackground=BORDER, **conf, **kw)
        if width:
            self.config(width=width)
        self._style = style


class Entry(tk.Entry):
    """Champ de saisie sombre avec placeholder optionnel."""

    def __init__(self, master, textvariable=None, placeholder="", show=None, font=FONT_UI):
        super().__init__(master, textvariable=textvariable, bg=SURFACE_2, fg=TEXT,
                         insertbackground=TEXT, relief="flat", bd=0, font=font,
                         highlightthickness=1, highlightbackground=BORDER,
                         highlightcolor=ACCENT, show=show or "")
        self._placeholder = placeholder
        self._var = textvariable
        if placeholder:
            if not (textvariable and textvariable.get()):
                self.insert(0, placeholder)
                self.config(fg=MUTED)
            self.bind("<FocusIn>", self._in)
            self.bind("<FocusOut>", self._out)

    def _in(self, _e):
        if self.get() == self._placeholder:
            self.delete(0, "end")
            self.config(fg=TEXT)

    def _out(self, _e):
        if not self.get():
            self.insert(0, self._placeholder)
            self.config(fg=MUTED)

    def value(self) -> str:
        """Valeur saisie, placeholder jamais compté comme une saisie."""
        raw = self.get()
        return "" if raw == self._placeholder else raw


class ScrollFrame(tk.Frame):
    """Zone défilante verticale (molette + barre), largeur suivie."""

    def __init__(self, master, bg=BG):
        super().__init__(master, bg=bg)
        self.canvas = tk.Canvas(self, bg=bg, highlightthickness=0, bd=0)
        bar = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=bar.set)
        bar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.body = _frame(self.canvas, bg=bg)
        win = self.canvas.create_window((0, 0), window=self.body, anchor="nw")
        self.body.bind("<Configure>",
                       lambda _e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", lambda e: self.canvas.itemconfigure(win, width=e.width))
        self._bind_wheel()

    def _bind_wheel(self):
        def _wheel(e):
            if not _widget_alive(self.canvas):
                return
            node = self.winfo_containing(e.x_root, e.y_root)
            while node is not None:
                if node is self.canvas or node is self.body:
                    break
                node = getattr(node, "master", None)
            if node is None:
                return
            step = -1 if (getattr(e, "delta", 0) > 0 or getattr(e, "num", 0) == 4) else 1
            self.canvas.yview_scroll(step, "units")
        for target in (self.canvas, self.body):
            target.bind("<MouseWheel>", _wheel)
            target.bind("<Button-4>", _wheel)
            target.bind("<Button-5>", _wheel)
        # Les enfants créés plus tard héritent du binding par propagation Tk.


class TokenView(tk.Frame):
    """Bloc « identifiant long » : défilement X et Y, sélection, bouton copier.

    Jamais de troncature silencieuse : un LID, un UUID, un HWID ou un token est
    affiché en entier, copiable d'un clic, et lisible en entier en défilant.
    """

    def __init__(self, master, label, value="", height=3, copy_label="Copier"):
        super().__init__(master, bg=SURFACE)
        head = _frame(self, bg=SURFACE)
        head.pack(fill="x")
        _lbl(head, label, fg=MUTED, font=FONT_SM, bg=SURFACE).pack(side="left")
        self._tip = _lbl(head, "", fg=GREEN, font=FONT_XS, bg=SURFACE)
        self._tip.pack(side="left", padx=(8, 0))
        Button(head, f"⧉ {copy_label}", self._copy, style="ghost", width=max(10, len(copy_label) + 3)
               ).pack(side="right")
        box = _frame(self, bg=SURFACE)
        box.pack(fill="x", pady=(6, 0))
        self.text = tk.Text(box, height=height, wrap="none", bg=SURFACE_2, fg=TEXT,
                            font=(MONO[0], 9), relief="flat", bd=0,
                            highlightthickness=1, highlightbackground=BORDER,
                            insertbackground=TEXT, padx=8, pady=6)
        sx = ttk.Scrollbar(box, orient="horizontal", command=self.text.xview)
        sy = ttk.Scrollbar(box, orient="vertical", command=self.text.yview)
        self.text.configure(xscrollcommand=sx.set, yscrollcommand=sy.set)
        self.text.grid(row=0, column=0, sticky="nsew")
        sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        box.rowconfigure(0, weight=1)
        box.columnconfigure(0, weight=1)
        self.set(value)

    def set(self, value):
        self.text.config(state="normal")
        self.text.delete("1.0", "end")
        self.text.insert("1.0", value or "")
        self.text.config(state="disabled")

    def get(self):
        return self.text.get("1.0", "end").strip()

    def _copy(self):
        value = self.get()
        if not value:
            _warn("Copie", "Aucune valeur à copier.", self)
            return
        self.clipboard_clear()
        self.clipboard_append(value)
        self._tip.config(text="✓ copié")
        self.after(2200, lambda: self._tip.config(text="") if _widget_alive(self._tip) else None)


class Toast:
    """Notification non bloquante, en bas à droite, à disparition automatique."""

    def __init__(self, root):
        self.root = root

    def show(self, message: str, kind: str = "info", ms: int = 4000):
        colors = {"info": ACCENT, "ok": GREEN, "error": RED, "warn": AMBER}
        try:
            win = tk.Toplevel(self.root)
        except tk.TclError:
            return
        win.overrideredirect(True)
        win.configure(bg=SURFACE, highlightthickness=1,
                      highlightbackground=colors.get(kind, ACCENT))
        _lbl(win, message, fg=TEXT, font=FONT_SM, bg=SURFACE, wraplength=340,
             justify="left").pack(padx=14, pady=10)
        self.root.update_idletasks()
        try:
            x = self.root.winfo_rootx() + self.root.winfo_width() - 380
            y = self.root.winfo_rooty() + self.root.winfo_height() - 110
            win.geometry(f"+{max(x, 0)}+{max(y, 0)}")
        except tk.TclError:
            return
        win.after(ms, win.destroy)


# ── Utilitaires métier ───────────────────────────────────────────────────────

def _validated_email(value: str) -> tuple[bool, str]:
    v = (value or "").strip()
    if not v:
        return True, ""
    if len(v) > 254 or not re.match(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$", v):
        return False, f"Adresse e-mail invalide : « {v} »"
    return True, ""


def _validated_text(value: str, field: str, max_len: int = 500) -> tuple[bool, str]:
    if len(value or "") > max_len:
        return False, f"« {field} » dépasse {max_len} caractères ({len(value)})."
    if value and re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", value):
        return False, f"« {field} » contient un caractère de contrôle interdit."
    return True, ""


def _section_title(parent, text, subtitle=""):
    _lbl(parent, text, font=FONT_H2).pack(anchor="w")
    if subtitle:
        _lbl(parent, subtitle, fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(2, 0))
    _frame(parent, bg=BORDER).pack(fill="x", pady=(10, 14), ipady=0)


# ── Page 1 — Générer une licence ─────────────────────────────────────────────

class PageGenerate(tk.Frame):
    """Création d'une licence garage (et éventuellement de ses clés mécanicien)."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._busy = False
        self._build()
        self._on_mode_change()

    # ── Construction ─────────────────────────────────────────────────────────
    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Générer une licence", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Renseignez le bénéficiaire, choisissez l'offre et la durée, puis signez.",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        scroll = ScrollFrame(self)
        scroll.pack(fill="both", expand=True)
        body = _frame(scroll.body, bg=BG, padx=26, pady=6)
        body.pack(fill="both", expand=True)
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)

        # ── Mode de génération ───────────────────────────────────────────────
        mode_card = Card(body)
        mode_card.grid(row=0, column=0, columnspan=2, sticky="ew", pady=(0, 16))
        _lbl(mode_card, "Nature de la génération", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(mode_card, "Une clé mécanicien est toujours rattachée à une licence garage.",
             fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(2, 8))
        self.v_mode = tk.StringVar(value="garage")
        row = _frame(mode_card, bg=SURFACE)
        row.pack(fill="x")
        for value, text in (("garage", "Licence garage seule"),
                            ("garage_meca", "Licence garage + clés mécanicien"),
                            ("meca_only", "Clés mécanicien pour un garage existant")):
            tk.Radiobutton(row, text=text, value=value, variable=self.v_mode,
                           command=self._on_mode_change, bg=SURFACE, fg=TEXT,
                           selectcolor=SURFACE_2, activebackground=SURFACE,
                           activeforeground=TEXT, font=FONT_SM, anchor="w",
                           highlightthickness=0, bd=0, pady=3).pack(side="left", padx=(0, 18))

        # ── Bénéficiaire ─────────────────────────────────────────────────────
        left = _frame(body, bg=BG)
        left.grid(row=1, column=0, sticky="nsew", padx=(0, 10))
        client_card = Card(left)
        client_card.pack(fill="x")
        _lbl(client_card, "Bénéficiaire", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(client_card, "Les champs facultatifs peuvent rester vides ; rien n'est inventé.",
             fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(2, 12))

        self.f_prenom = tk.StringVar()
        self.f_nom = tk.StringVar()
        self.f_entreprise = tk.StringVar()
        self.f_email = tk.StringVar()
        self.f_tel = tk.StringVar()
        self.f_adresse = tk.StringVar()
        self.f_cp = tk.StringVar()
        self.f_ville = tk.StringVar()
        self.f_pays = tk.StringVar(value="France")

        self._field(client_card, "Prénom", self.f_prenom)
        self._field(client_card, "Nom", self.f_nom)
        self._field(client_card, "Entreprise", self.f_entreprise)
        self._two(client_card, "Adresse e-mail", self.f_email, "Téléphone", self.f_tel)
        self._field(client_card, "Adresse", self.f_adresse)
        self._three(client_card, "Code postal", self.f_cp, "Ville", self.f_ville, "Pays", self.f_pays)
        _lbl(client_card, "Informations complémentaires", fg=MUTED, font=FONT_SM,
             bg=SURFACE).pack(anchor="w", pady=(8, 4))
        self.txt_infos = tk.Text(client_card, height=3, bg=SURFACE_2, fg=TEXT,
                                 insertbackground=TEXT, relief="flat", bd=0, font=FONT_SM,
                                 highlightthickness=1, highlightbackground=BORDER,
                                 highlightcolor=ACCENT, padx=6, pady=4)
        self.txt_infos.pack(fill="x")

        # ── Licence ──────────────────────────────────────────────────────────
        right = _frame(body, bg=BG)
        right.grid(row=1, column=1, sticky="nsew", padx=(10, 0))
        lic_card = Card(right)
        lic_card.pack(fill="x")
        _lbl(lic_card, "Offre et durée", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(lic_card, "Deux offres commerciales : PREMIUM et ADMIN.",
             fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(2, 12))

        _lbl(lic_card, "Type de licence", fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w")
        self.v_type = tk.StringVar(value="premium")
        type_row = _frame(lic_card, bg=SURFACE)
        type_row.pack(fill="x", pady=(4, 12))
        for value, label in (("premium", "PREMIUM"), ("admin", "ADMIN")):
            tk.Radiobutton(type_row, text=label, value=value, variable=self.v_type,
                           bg=SURFACE, fg=TEXT, selectcolor=SURFACE_2,
                           activebackground=SURFACE, activeforeground=TEXT,
                           font=FONT_B, anchor="w", highlightthickness=0, bd=0,
                           pady=3).pack(side="left", padx=(0, 16))

        _lbl(lic_card, "Durée", fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w")
        dur_row = _frame(lic_card, bg=SURFACE)
        dur_row.pack(fill="x", pady=(4, 4))
        self.v_duree = tk.StringVar(value="365")
        self.v_unite = tk.StringVar(value="jours")
        ttk.Spinbox(dur_row, from_=1, to=36500, textvariable=self.v_duree, width=8,
                    font=FONT_UI).pack(side="left", ipady=4)
        ttk.Combobox(dur_row, textvariable=self.v_unite, state="readonly", width=10,
                     values=["jours", "mois", "annees"], font=FONT_UI).pack(side="left", padx=(8, 0), ipady=4)
        self.lbl_echeance = _lbl(dur_row, "", fg=ACCENT, font=FONT_XS, bg=SURFACE)
        self.lbl_echeance.pack(side="left", padx=(12, 0))
        for var in (self.v_duree, self.v_unite):
            var.trace_add("write", lambda *_: self._refresh_expiry())

        _lbl(lic_card, "Raccourcis", fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(8, 4))
        quick = _frame(lic_card, bg=SURFACE)
        quick.pack(fill="x")
        for value, unit, text in ((1, "jours", "1 j"), (7, "jours", "7 j"), (30, "jours", "30 j"),
                                  (90, "jours", "90 j"), (180, "jours", "180 j"),
                                  (365, "jours", "1 an"), (730, "jours", "2 ans")):
            Button(quick, text, lambda v=value, u=unit: (self.v_duree.set(str(v)), self.v_unite.set(u)),
                   style="ghost").pack(side="left", padx=(0, 6), pady=2)

        self._two(lic_card, "Postes (sièges)", self._var("1"), "Étiquette interne", self._var(""))
        self.v_seats, self.v_label = self._last_two
        self._field(lic_card, "Identifiant client (auto si vide)", self._var(""),
                    placeholder="ex. CUST-042")
        self.v_cid = self._last_var

        # ── Liaison matérielle ───────────────────────────────────────────────
        hw_card = Card(right, bg=SURFACE)
        hw_card.pack(fill="x", pady=(14, 0))
        _lbl(hw_card, "Liaison matérielle (HWID)", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(hw_card,
             "Facultatif. L'empreinte doit être produite par le POSTE À ACTIVER : elle lie "
             "ensuite la licence à cette machine. Le keygen ne la calcule jamais — son "
             "empreinte locale diffère de celle de l'application et serait refusée.",
             fg=MUTED, font=FONT_XS, bg=SURFACE, wraplength=460, justify="left").pack(
                 anchor="w", pady=(4, 10))
        self.v_hwid = tk.StringVar()
        hw_row = _frame(hw_card, bg=SURFACE)
        hw_row.pack(fill="x")
        Entry(hw_row, textvariable=self.v_hwid, placeholder="HWID1-… (64 hex) ou 64 hex",
              font=(MONO[0], 9)).pack(side="left", fill="x", expand=True, ipady=5)
        Button(hw_row, "Coller", self._paste_hwid, style="ghost").pack(side="left", padx=(6, 0))
        Button(hw_row, "Fichier…", self._import_hwid_file, style="ghost").pack(side="left", padx=(6, 0))
        self.lbl_hwid = _lbl(hw_card, "", fg=MUTED, font=FONT_XS, bg=SURFACE)
        self.lbl_hwid.pack(anchor="w", pady=(8, 0))
        self.v_hwid.trace_add("write", lambda *_: self._refresh_hwid_state())

        # ── Bloc mécanicien ──────────────────────────────────────────────────
        self.meca_card = Card(right)
        _lbl(self.meca_card, "Clés mécanicien", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        self.parent_row = _frame(self.meca_card, bg=SURFACE)
        _lbl(self.parent_row, "Licence garage parente", fg=MUTED, font=FONT_SM,
             bg=SURFACE).pack(anchor="w")
        self.v_parent = tk.StringVar()
        self.parent_map = {}
        self.parent_cb = ttk.Combobox(self.parent_row, textvariable=self.v_parent,
                                      state="readonly", font=FONT_SM)
        self.parent_cb.pack(fill="x", ipady=4, pady=(4, 10))
        _lbl(self.meca_card, f"Nombre de clés (1 à {_max_mechanic()})", fg=MUTED,
             font=FONT_SM, bg=SURFACE).pack(anchor="w")
        self.v_count = tk.StringVar(value="1")
        ttk.Spinbox(self.meca_card, from_=1, to=_max_mechanic(), textvariable=self.v_count,
                    width=6, font=FONT_UI).pack(fill="x", pady=(4, 8), ipady=4)
        _lbl(self.meca_card, "Noms des mécaniciens (un par ligne, facultatif)", fg=MUTED,
             font=FONT_SM, bg=SURFACE).pack(anchor="w")
        self.txt_names = tk.Text(self.meca_card, height=4, bg=SURFACE_2, fg=TEXT,
                                 insertbackground=TEXT, relief="flat", bd=0, font=FONT_SM,
                                 highlightthickness=1, highlightbackground=BORDER,
                                 highlightcolor=ACCENT, padx=6, pady=4)
        self.txt_names.pack(fill="x")

        # ── Barre d'action ───────────────────────────────────────────────────
        action = Card(body)
        action.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(18, 26))
        bar = _frame(action, bg=SURFACE)
        bar.pack(fill="x")
        self.btn_generate = Button(bar, "⚡  Générer et signer", self._generate, style="primary")
        self.btn_generate.pack(side="left")
        self.btn_clear = Button(bar, "Réinitialiser le formulaire", self._reset, style="ghost")
        self.btn_clear.pack(side="left", padx=(10, 0))
        self.lbl_status = _lbl(bar, "", fg=MUTED, font=FONT_SM, bg=SURFACE)
        self.lbl_status.pack(side="right")
        self.result = TokenView(action, "Jeton signé (GF2…)", "", height=4, copy_label="Copier le jeton")
        self.result.pack(fill="x", pady=(12, 0))
        self.result.set("— aucun jeton généré pour l'instant —")
        self._refresh_expiry()
        self._refresh_hwid_state()

    # ── Petits helpers de construction ───────────────────────────────────────
    _last_var = None
    _last_two = (None, None)

    def _var(self, value=""):
        var = tk.StringVar(value=value)
        self._last_var = var
        return var

    def _field(self, parent, label, var, placeholder=""):
        _lbl(parent, label, fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w", pady=(8, 4))
        Entry(parent, textvariable=var, placeholder=placeholder).pack(fill="x", ipady=5)
        self._last_var = var
        return var

    def _two(self, parent, label_a, var_a, label_b, var_b):
        row = _frame(parent, bg=SURFACE)
        row.pack(fill="x", pady=(8, 0))
        cell_a = _frame(row, bg=SURFACE)
        cell_a.pack(side="left", fill="x", expand=True, padx=(0, 8))
        cell_b = _frame(row, bg=SURFACE)
        cell_b.pack(side="left", fill="x", expand=True)
        _lbl(cell_a, label_a, fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w")
        Entry(cell_a, textvariable=var_a).pack(fill="x", ipady=5, pady=(4, 0))
        _lbl(cell_b, label_b, fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w")
        Entry(cell_b, textvariable=var_b).pack(fill="x", ipady=5, pady=(4, 0))
        self._last_two = (var_a, var_b)

    def _three(self, parent, la, va, lb, vb, lc, vc):
        row = _frame(parent, bg=SURFACE)
        row.pack(fill="x", pady=(8, 0))
        for label, var, pad in ((la, va, (0, 6)), (lb, vb, (0, 6)), (lc, vc, (0, 0))):
            cell = _frame(row, bg=SURFACE)
            cell.pack(side="left", fill="x", expand=True, padx=pad)
            _lbl(cell, label, fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w")
            Entry(cell, textvariable=var).pack(fill="x", ipady=5, pady=(4, 0))

    # ── Dynamique ────────────────────────────────────────────────────────────
    def _refresh_expiry(self):
        try:
            days = core.duration_days(self.v_duree.get(), self.v_unite.get())
        except Exception:
            self.lbl_echeance.config(text="", fg=MUTED)
            return
        echeance = time.strftime("%d/%m/%Y", time.localtime(time.time() + days * 86400))
        self.lbl_echeance.config(text=f"→ expire le {echeance} ({core.duration_label(days)})")

    def _refresh_hwid_state(self):
        raw = (self.v_hwid.get() or "").strip()
        if not raw:
            self.lbl_hwid.config(text="Aucune liaison : la licence s'activera sur n'importe quel poste.",
                                 fg=MUTED)
            return
        if core.is_valid_license_hwid(raw):
            self.lbl_hwid.config(text="✓ Format valide — la licence sera liée à ce matériel.", fg=GREEN)
        else:
            self.lbl_hwid.config(text="✗ Format invalide : 64 caractères hexadécimaux, ou HWID1- suivi de 64 hex.",
                                 fg=RED)

    def _on_mode_change(self):
        mode = self.v_mode.get()
        if mode == "garage":
            self.meca_card.pack_forget()
        else:
            self.meca_card.pack(fill="x", pady=(14, 0))
            if mode == "meca_only":
                self._refresh_parents()
                self.parent_row.pack(fill="x", pady=(8, 0), before=self.parent_cb)
            else:
                self.parent_row.pack_forget()
                self.parent_cb.pack_forget()
        self._refresh_expiry()

    def _refresh_parents(self):
        garages = db.garage_licenses()
        self.parent_map = {}
        values = []
        for g in garages:
            c = g.get("client") or {}
            nom = " ".join(x for x in (c.get("nom", ""), c.get("prenom", "")) if x).strip()
            label = g.get("label") or nom or g.get("cid") or g["lid"][:8]
            display = f"{label} · {g['lid'][:8]}… · {TYPE_LABEL.get(g['type'], g['type'])}"
            self.parent_map[display] = g["lid"]
            values.append(display)
        self.parent_cb.config(values=values)
        if values and not self.v_parent.get():
            self.v_parent.set(values[0])

    def _set_hwid_from_text(self, raw: str) -> bool:
        normalized = core.normalize_license_hwid(raw)
        if not core.is_valid_license_hwid(normalized):
            _error("HWID invalide",
                   "Format attendu : 64 caractères hexadécimaux (v0), ou « HWID1- » suivi de "
                   "64 caractères hexadécimaux (v1).\n\nCette valeur doit être produite par le "
                   "poste à activer : une empreinte calculée ici serait refusée à l'activation.",
                   self)
            return False
        self.v_hwid.set(normalized)
        return True

    def _paste_hwid(self):
        try:
            raw = self.clipboard_get()
        except tk.TclError:
            _info("Presse-papiers vide", "Copiez d'abord l'empreinte affichée par le poste client.", self)
            return
        if self._set_hwid_from_text(raw):
            self.app.toast.show("Empreinte du poste client importée.", "ok")

    def _import_hwid_file(self):
        path = filedialog.askopenfilename(parent=self, title="Empreinte du poste client",
                                          filetypes=[("Texte", "*.txt"), ("Tous les fichiers", "*.*")])
        if not path:
            return
        try:
            with open(path, "r", encoding="utf-8") as fh:
                raw = fh.readline()
        except Exception as exc:
            _error("Lecture impossible", str(exc), self)
            return
        if self._set_hwid_from_text(raw):
            self.app.toast.show("Empreinte du poste client importée.", "ok")

    def _reset(self):
        for var in (self.f_prenom, self.f_nom, self.f_entreprise, self.f_email, self.f_tel,
                    self.f_adresse, self.f_cp, self.f_ville, self.v_label, self.v_cid, self.v_hwid):
            var.set("")
        self.f_pays.set("France")
        self.v_duree.set("365")
        self.v_unite.set("jours")
        self.v_seats.set("1")
        self.v_type.set("premium")
        self.v_mode.set("garage")
        self.txt_infos.delete("1.0", "end")
        self.txt_names.delete("1.0", "end")
        self.result.set("— aucun jeton généré pour l'instant —")
        self._on_mode_change()

    # ── Validation et génération ─────────────────────────────────────────────
    def _collect_client(self):
        return {
            "prenom": self.f_prenom.get().strip(),
            "nom": self.f_nom.get().strip(),
            "entreprise": self.f_entreprise.get().strip(),
            "email": self.f_email.get().strip(),
            "tel": self.f_tel.get().strip(),
            "adresse": self.f_adresse.get().strip(),
            "code_postal": self.f_cp.get().strip(),
            "ville": self.f_ville.get().strip(),
            "pays": self.f_pays.get().strip(),
            "infos": self.txt_infos.get("1.0", "end").strip(),
        }

    def _validate(self) -> tuple[bool, str]:
        c = self._collect_client()
        ok, err = _validated_email(c["email"])
        if not ok:
            return False, err
        for field, value in (("Nom", c["nom"]), ("Prénom", c["prenom"]), ("Entreprise", c["entreprise"]),
                             ("Adresse", c["adresse"]), ("Ville", c["ville"]), ("Pays", c["pays"])):
            ok, err = _validated_text(value, field, 200)
            if not ok:
                return False, err
        ok, err = _validated_text(c["infos"], "Informations complémentaires", 2000)
        if not ok:
            return False, err
        try:
            core.duration_days(self.v_duree.get(), self.v_unite.get())
        except ValueError as exc:
            return False, str(exc)
        try:
            seats = int(self.v_seats.get() or 1)
        except ValueError:
            return False, "Le nombre de postes doit être un entier."
        if seats < 1 or seats > 500:
            return False, "Le nombre de postes doit être compris entre 1 et 500."
        hwid = (self.v_hwid.get() or "").strip()
        if hwid and not core.is_valid_license_hwid(hwid):
            return False, ("HWID invalide : 64 caractères hexadécimaux, ou « HWID1- » suivi de 64 "
                           "caractères hexadécimaux. Utilisez « Coller » ou « Fichier… » avec la "
                           "valeur affichée par le poste à activer.")
        return True, ""

    def _set_busy(self, busy: bool):
        self._busy = busy
        try:
            state = "disabled" if busy else "normal"
            self.btn_generate.config(state=state)
            self.btn_clear.config(state=state)
            self.lbl_status.config(text="⏳ Signature en cours…" if busy else "")
        except tk.TclError:
            pass

    def _generate(self):
        if self._busy:
            return                      # anti double-clic / double génération
        if not core.HAS_CRYPTO:
            _error("Dépendance manquante",
                   "Le module Python 'cryptography' est requis.\n\nInstallez-le avec :\n"
                   "    pip install cryptography\n\npuis relancez le programme.", self)
            return
        if not core.keys_exist():
            _error("Clés absentes",
                   "Aucune paire ECC trouvée dans keys/.\n\nRestaurez la clé privée de l'autorité "
                   "depuis sa sauvegarde (coffre, clé USB) via le canal approuvé. Une clé privée "
                   "ne se reconstruit pas depuis sa clé publique : créer une nouvelle autorité "
                   "invaliderait toutes les licences déjà vendues.", self)
            return
        ok, err = self._validate()
        if not ok:
            _error("Validation impossible", err, self)
            return

        mode = self.v_mode.get()
        count, names = 0, []
        if mode in ("garage_meca", "meca_only"):
            try:
                count = int(self.v_count.get() or "1")
            except ValueError:
                _error("Nombre invalide", "Le nombre de clés mécanicien doit être un entier.", self)
                return
            if count < 1 or count > _max_mechanic():
                _error("Nombre invalide",
                       f"Le nombre de clés mécanicien doit être compris entre 1 et {_max_mechanic()}.", self)
                return
            names = [n.strip() for n in self.txt_names.get("1.0", "end").splitlines() if n.strip()]
            if len(names) > count:
                _error("Trop de noms", f"{len(names)} noms fournis pour {count} clés.", self)
                return

        self._set_busy(True)

        def _work():
            passphrase = self.app.passphrase
            key = core.load_checked_private_key(passphrase)   # refuse si les ancres divergent
            duration = {"value": self.v_duree.get(), "unit": self.v_unite.get()}
            cid, client = self._cid_and_client()
            seats = int(self.v_seats.get() or 1)
            hwid = core.normalize_license_hwid(self.v_hwid.get()) or None
            label = self.v_label.get().strip()
            generated = []

            if mode in ("garage", "garage_meca"):
                info = core.make_license(key, cid, self.v_type.get(), seats=seats, hwid=hwid,
                                         label=label, duration=duration, enforce_offer=True)
                db.add_license(info, client)
                db.audit_log("gen_garage", info["lid"], f"type={self.v_type.get()}")
                generated.append(info)
                parent_lid = info["lid"]
            else:
                parent_lid = self.parent_map.get(self.v_parent.get())
                if not parent_lid:
                    raise ValueError("Sélectionnez la licence garage parente.")
                parent = db.get_license(parent_lid)
                if parent is None:
                    raise ValueError("Licence garage parente introuvable dans la base locale.")
                cid = parent.get("cid", cid)

            children = []
            for i in range(count):
                name = names[i] if i < len(names) else None
                minfo = core.make_mechanic_license(key, parent_lid, cid, duration=duration,
                                                   mechanic_name=name,
                                                   label=name or f"Mécanicien {i+1}")
                db.add_license(minfo, {})
                db.audit_log("gen_mechanic", minfo["lid"], f"parent={parent_lid[:8]}…")
                children.append(minfo)
            return generated, children

        def _done(result):
            self._set_busy(False)
            generated, children = result
            if generated:
                self.result.set(generated[0]["token"])
            elif children:
                self.result.set(children[0]["token"])
            self.app.toast.show(
                f"{len(generated) + len(children)} licence(s) signée(s) et enregistrée(s) localement.", "ok")
            self.app.page_manage.refresh()
            if children:
                self.app.show_recap(children, generated[0] if generated else None)

        def _failed(message):
            self._set_busy(False)
            self.lbl_status.config(text="")
            self._report_signature_error(message)

        _background(self, _work, on_done=_done, on_error=_failed)

    def _cid_and_client(self):
        client = self._collect_client()
        cid = (self.v_cid.get() or "").strip()
        if not cid:
            base = (client["entreprise"] or client["nom"] or "CLIENT").upper().replace(" ", "-")[:20]
            cid = f"{base}-{time.strftime('%y%m%d')}"
        if not self.v_label.get().strip():
            self.v_label.set(client["entreprise"]
                             or " ".join(x for x in (client["prenom"], client["nom"]) if x).strip()
                             or cid)
        return cid, client

    def _report_signature_error(self, message: str):
        """Erreur de signature : lisible, sans jamais proposer de retrouver une clé."""
        if "n'est PAS" in message or "KEY_MISMATCH" in message:
            _error("Signature refusée",
                   "La clé privée de ce poste n'est pas la clé de licence de production : "
                   "toute licence signée avec elle serait refusée par le logiciel.\n\n"
                   "Restaurez le fichier privé de l'autorité depuis sa sauvegarde, par le canal "
                   "approuvé, puis relancez.\n\n"
                   "Aucun outil ne recherche ni ne reconstruit une clé privée : une clé perdue "
                   "ne se recalcule pas depuis sa clé publique.\n\n"
                   + message.split("\n\nDétail")[0], self)
            return
        _error("Erreur de signature", message, self)


# ── Page 2 — Gérer les licences ──────────────────────────────────────────────

class PageManage(tk.Frame):
    """Liste, recherche, filtres, tri et fiche complète des licences émises."""

    COLUMNS = (
        ("client",  "Client / Entreprise", 190),
        ("type",    "Type",                110),
        ("statut",  "Statut",              100),
        ("duree",   "Durée",               110),
        ("expire",  "Expiration",          105),
        ("cree",    "Création",            105),
        ("parent",  "Garage parent",       100),
        ("lid",     "LID",                 300),
        ("uuid",    "UUID",                300),
        ("hwid",    "HWID",                320),
    )

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self.rows = []
        self._build()
        self.refresh()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Gérer les licences", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Recherche sur tous les champs, filtres, tri, et fiche complète sans troncature.",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        toolbar = Card(_frame(self, bg=BG, padx=26), pady=12)
        toolbar.pack(fill="x", pady=(0, 12))
        grid = _frame(toolbar, bg=SURFACE)
        grid.pack(fill="x")

        _lbl(grid, "Recherche", fg=MUTED, font=FONT_XS, bg=SURFACE).grid(row=0, column=0, sticky="w")
        self.v_search = tk.StringVar()
        Entry(grid, textvariable=self.v_search, placeholder="nom, e-mail, LID, UUID, HWID…").grid(
            row=1, column=0, sticky="ew", padx=(0, 12), ipady=5)
        self.v_search.trace_add("write", lambda *_: self.refresh())

        _lbl(grid, "Type", fg=MUTED, font=FONT_XS, bg=SURFACE).grid(row=0, column=1, sticky="w")
        self.v_type = tk.StringVar(value="Tous")
        ttk.Combobox(grid, textvariable=self.v_type, state="readonly", width=14,
                     values=["Tous", "PREMIUM", "ADMIN", "Mécaniciens",
                             "ENTREPRISE (parc historique)"],
                     font=FONT_SM).grid(row=1, column=1, sticky="ew", padx=(0, 12), ipady=4)
        self.v_type.trace_add("write", lambda *_: self.refresh())

        _lbl(grid, "Statut", fg=MUTED, font=FONT_XS, bg=SURFACE).grid(row=0, column=2, sticky="w")
        self.v_status = tk.StringVar(value="Tous")
        ttk.Combobox(grid, textvariable=self.v_status, state="readonly", width=14,
                     values=["Tous", "Active", "Non activée", "Expirée", "Révoquée", "Suspendue"],
                     font=FONT_SM).grid(row=1, column=2, sticky="ew", padx=(0, 12), ipady=4)
        self.v_status.trace_add("write", lambda *_: self.refresh())

        _lbl(grid, "Tri", fg=MUTED, font=FONT_XS, bg=SURFACE).grid(row=0, column=3, sticky="w")
        self.v_sort = tk.StringVar(value="Création ↓")
        ttk.Combobox(grid, textvariable=self.v_sort, state="readonly", width=16,
                     values=["Création ↓", "Création ↑", "Expiration ↓", "Expiration ↑", "Client A→Z"],
                     font=FONT_SM).grid(row=1, column=3, sticky="ew", ipady=4)
        self.v_sort.trace_add("write", lambda *_: self.refresh())

        grid.columnconfigure(0, weight=3)
        for col in (1, 2, 3):
            grid.columnconfigure(col, weight=1)

        actions = _frame(toolbar, bg=SURFACE)
        actions.pack(fill="x", pady=(12, 0))
        Button(actions, "↻ Actualiser", self.refresh, style="ghost").pack(side="left")
        Button(actions, "⇄ Synchroniser le serveur", self._sync_server, style="ghost").pack(side="left", padx=(8, 0))
        Button(actions, "⤓ Exporter la sélection", self._export, style="ghost").pack(side="left", padx=(8, 0))
        self.lbl_count = _lbl(actions, "", fg=MUTED, font=FONT_SM, bg=SURFACE)
        self.lbl_count.pack(side="right")

        table = Card(_frame(self, bg=BG, padx=26), padx=1, pady=1)
        table.pack(fill="both", expand=True, pady=(0, 12))
        wrap = _frame(table, bg=SURFACE)
        wrap.pack(fill="both", expand=True)
        cols = [c[0] for c in self.COLUMNS]
        self.tree = ttk.Treeview(wrap, columns=cols, show="headings", selectmode="browse", height=14)
        for name, title, width in self.COLUMNS:
            self.tree.heading(name, text=title)
            self.tree.column(name, width=width, anchor="w", stretch=False)
        sx = ttk.Scrollbar(wrap, orient="horizontal", command=self.tree.xview)
        sy = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        self.tree.configure(xscrollcommand=sx.set, yscrollcommand=sy.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        wrap.rowconfigure(0, weight=1)
        wrap.columnconfigure(0, weight=1)
        self.tree.tag_configure("active", foreground=GREEN)
        self.tree.tag_configure("revoked", foreground=RED)
        self.tree.tag_configure("suspended", foreground=AMBER)
        self.tree.tag_configure("expired", foreground=AMBER)
        self.tree.bind("<<TreeviewSelect>>", lambda _e: self._on_select())
        self.tree.bind("<Double-1>", lambda _e: self._open_detail())

        panel = Card(_frame(self, bg=BG, padx=26), pady=12)
        panel.pack(fill="x", pady=(0, 22))
        bar = _frame(panel, bg=SURFACE)
        bar.pack(fill="x")
        Button(bar, "Fiche complète", self._open_detail, style="primary").pack(side="left")
        Button(bar, "Activer", lambda: self._apply_status("active"), style="success").pack(side="left", padx=(8, 0))
        Button(bar, "Suspendre", lambda: self._apply_status("suspended"), style="warn").pack(side="left", padx=(8, 0))
        Button(bar, "Révoquer", lambda: self._apply_status("revoked"), style="danger").pack(side="left", padx=(8, 0))
        Button(bar, "Réinitialiser le matériel", self._reset_hwid, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Supprimer la fiche", self._delete, style="ghost").pack(side="left", padx=(8, 0))

        self.summary = _lbl(panel, "Sélectionnez une licence pour afficher sa fiche.",
                            fg=MUTED, font=FONT_SM, bg=SURFACE, justify="left", anchor="w")
        self.summary.pack(fill="x", pady=(12, 0))

    # ── Données ──────────────────────────────────────────────────────────────
    def _selected_row(self):
        sel = self.tree.selection()
        if not sel:
            return None
        iid = sel[0]
        for row in self.rows:
            if row["lid"] == iid:
                return row
        return None

    def refresh(self, *_):
        rows = db.search_licenses(self.v_search.get())
        rows = db.filter_licenses(rows, self.v_type.get(), "Tous")
        status_filter = self.v_status.get()
        if status_filter == "Non activée":
            rows = [r for r in rows if not (r.get("activated_at") or (r.get("server") or {}).get("activatedAt"))
                    and db.effective_status(r) == "active"]
        elif status_filter != "Tous":
            mapping = {"Active": "active", "Expirée": "expired", "Révoquée": "revoked", "Suspendue": "suspended"}
            rows = [r for r in rows if db.effective_status(r) == mapping[status_filter]]
        sort = self.v_sort.get()
        rows = db.sort_licenses(rows,
                                "expires_at" if "Expiration" in sort else "client" if "Client" in sort else "created_at",
                                descending=sort.endswith("↓"))
        self.rows = rows
        self.tree.delete(*self.tree.get_children())
        for r in rows:
            c = r.get("client") or {}
            srv = r.get("server") or {}
            nom = " ".join(x for x in (c.get("nom", ""), c.get("prenom", "")) if x).strip()
            display = c.get("entreprise") or nom or r.get("label") or r.get("cid") or "—"
            status = db.effective_status(r)
            self.tree.insert(
                "", "end", iid=r["lid"],
                values=(display, TYPE_LABEL.get(r.get("type"), r.get("type", "")),
                        STATUS_LABEL.get(status, status),
                        r.get("duration_label") or "—",
                        r.get("expires_at") or "—",
                        (r.get("created_at") or "")[:10] or "—",
                        (r.get("parent_lid") or "")[:8] + "…" if r.get("parent_lid") else "—",
                        r.get("lid") or "—", r.get("uuid") or "—", r.get("hwid") or "—"),
                tags=(status,))
        self.lbl_count.config(text=f"{len(rows)} licence(s) affichée(s) sur {len(db.list_licenses())}")

    def _on_select(self):
        row = self._selected_row()
        if not row:
            self.summary.config(text="Sélectionnez une licence pour afficher sa fiche.")
            return
        c = row.get("client") or {}
        srv = row.get("server") or {}
        status = db.effective_status(row)
        parts = [
            f"Client : {c.get('entreprise') or ' '.join(x for x in (c.get('nom',''), c.get('prenom','')) if x).strip() or '—'}",
            f"Type : {TYPE_LABEL.get(row.get('type'), row.get('type',''))} · "
            f"Durée : {row.get('duration_label') or '—'} · Échéance : {row.get('expires_at') or '—'}",
            f"Statut local : {STATUS_LABEL.get(row.get('status'), row.get('status',''))}"
            + (f" · Serveur : {STATUS_LABEL.get(srv.get('status'), srv.get('status','inconnu'))}"
               if srv.get("status") else " · Serveur : non synchronisé"),
            f"Matériel : {'lié — ' + (row.get('hwid') or '')[:24] + '…' if row.get('hwid') else 'non lié'}",
        ]
        if srv.get("activatedAt"):
            parts.append(f"Première activation : {srv['activatedAt'][:19].replace('T', ' ')}")
        if srv.get("lastSeenAt"):
            parts.append(f"Dernière vérification : {srv['lastSeenAt'][:19].replace('T', ' ')}")
        self.summary.config(text="\n".join(parts))

    # ── Actions ──────────────────────────────────────────────────────────────
    def _open_detail(self):
        row = self._selected_row()
        if not row:
            _info("Fiche licence", "Sélectionnez d'abord une licence dans le tableau.", self)
            return
        Sheet(self.app, row, self)

    def _apply_status(self, status: str):
        row = self._selected_row()
        if not row:
            return
        if status == "revoked" and not messagebox.askyesno(
                "Révoquer", "Révoquer cette licence ? Les postes licenciés seront bloqués.\n"
                            "Cette action est réversible, mais exige un motif.", parent=self):
            return
        reason = ""
        if row.get("status") == "revoked" and status == "active":
            reason = self._ask_reason()
            if reason is None:
                return
        db.set_status(row["lid"], status)
        db.audit_log(f"status_{status}", row["lid"], reason[:40])
        self.refresh()
        url, key = self.app.server_config()
        if url and key:
            def _work():
                return server.set_status(url, key, row["lid"], status,
                                         confirm_reactivation=bool(reason), reason=reason)
            def _done(result):
                ok, message = result
                (self.app.toast.show(message, "ok") if ok
                 else self.app.toast.show(message, "error", 7000))
                if ok:
                    self._sync_server()
            def _failed(message):
                self.app.toast.show(f"Statut local modifié, mais le serveur n'a pas répondu : {message}",
                                    "warn", 8000)
            _background(self, _work, on_done=_done, on_error=_failed)
        else:
            self.app.toast.show("Statut modifié localement (serveur non configuré).", "warn")

    def _ask_reason(self):
        win = tk.Toplevel(self)
        win.title("Motif de réactivation")
        win.configure(bg=BG)
        win.geometry("520x260")
        win.transient(self)
        _lbl(win, "Réactiver une licence révoquée exige un motif (5 caractères minimum).",
             font=FONT_SM).pack(anchor="w", padx=20, pady=(18, 8))
        box = tk.Text(win, height=5, bg=SURFACE_2, fg=TEXT, insertbackground=TEXT, relief="flat",
                      bd=0, font=FONT_SM, highlightthickness=1, highlightbackground=BORDER, padx=8, pady=6)
        box.pack(fill="both", expand=True, padx=20)
        result = {"value": None}

        def _ok():
            text = box.get("1.0", "end").strip()
            if len(text) < 5:
                _warn("Motif trop court", "Le motif doit comporter au moins 5 caractères.", win)
                return
            result["value"] = text
            win.destroy()

        def _cancel():
            win.destroy()

        bar = _frame(win, bg=BG)
        bar.pack(fill="x", padx=20, pady=14)
        Button(bar, "Réactiver", _ok, style="success").pack(side="left")
        Button(bar, "Annuler", _cancel, style="ghost").pack(side="left", padx=(8, 0))
        win.grab_set()
        self.wait_window(win)
        return result["value"]

    def _reset_hwid(self):
        row = self._selected_row()
        if not row:
            return
        url, key = self.app.server_config()
        if not (url and key):
            _warn("Serveur requis",
                  "La réinitialisation matérielle se fait côté serveur : configurez l'URL et la "
                  "clé API dans « Serveur GarageFlows ».", self)
            return
        if not messagebox.askyesno(
                "Réinitialiser le matériel",
                "Libérer les appareils enregistrés pour cette licence ?\n\n"
                "Les sièges sont libérés et la machine peut se réactiver. Si le jeton signé porte "
                "lui-même un HWID, il restera lié à son matériel d'origine : il faudra alors émettre "
                "une nouvelle licence.", parent=self):
            return

        def _work():
            return server.reset_hwid(url, key, row["lid"], action="reset", reason="keygen:reset")

        def _done(result):
            ok, message = result
            self.app.toast.show(message, "ok" if ok else "error", 8000)
            if ok:
                self._sync_server()

        _background(self, _work, on_done=_done,
                    on_error=lambda m: self.app.toast.show(m, "error", 8000))

    def _delete(self):
        row = self._selected_row()
        if not row:
            return
        if not messagebox.askyesno(
                "Supprimer la fiche",
                "Supprimer cette entrée de la BASE LOCALE ?\n\n"
                "Le jeton reste valide cryptographiquement et la licence reste connue du serveur : "
                "c'est une opération de classement, pas une révocation.", parent=self):
            return
        db.delete_license(row["lid"])
        db.audit_log("delete_local", row["lid"])
        self.refresh()
        self.app.toast.show("Fiche supprimée de la base locale.", "ok")

    def _export(self):
        rows = self.rows
        if not rows:
            _info("Export", "Aucune licence à exporter.", self)
            return
        path = filedialog.asksaveasfilename(parent=self, defaultextension=".json",
                                            filetypes=[("JSON", "*.json")],
                                            initialfile="licences-garageflows.json")
        if not path:
            return
        try:
            with open(path, "w", encoding="utf-8") as fh:
                _json.dump(rows, fh, indent=2, ensure_ascii=False)
        except Exception as exc:
            _error("Export impossible", str(exc), self)
            return
        db.audit_log("export", "", f"n={len(rows)}")
        self.app.toast.show(f"{len(rows)} fiche(s) exportée(s).", "ok")

    def _sync_server(self):
        url, key = self.app.server_config()
        if not (url and key):
            self.app.toast.show("Configurez d'abord le serveur (URL + clé API).", "warn")
            return

        def _work():
            return server.fetch_licenses(url, key)

        def _done(result):
            ok, licenses, message = result
            if not ok:
                self.app.toast.show(f"Synchronisation impossible : {message}", "error", 8000)
                return
            index = {str(l.get("licenseId")): l for l in licenses}
            updated = 0
            for record in db.list_licenses():
                srv = index.get(record.get("lid"))
                if srv:
                    db.update_license(record["lid"], {
                        "server": {
                            "status": srv.get("status"),
                            "hwid": srv.get("hwid") or "",
                            "bound": bool(srv.get("bound")),
                            "activatedAt": srv.get("activatedAt") or "",
                            "lastSeenAt": srv.get("lastSeenAt") or "",
                            "expiresAt": srv.get("expiryAt") or "",
                            "seats": srv.get("seats"),
                            "deviceCount": srv.get("deviceCount"),
                            "activeDeviceCount": srv.get("activeDeviceCount"),
                            "devices": srv.get("devices") or [],
                        },
                        "server_synced_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                    })
                    updated += 1
            self.refresh()
            self.app.toast.show(f"Synchronisation terminée : {updated} licence(s) rapprochée(s).", "ok")

        _background(self, _work, on_done=_done,
                    on_error=lambda m: self.app.toast.show(f"Synchronisation impossible : {m}", "error", 8000))


class Sheet(tk.Toplevel):
    """Fiche complète d'une licence : identifiants entiers, copiables, jamais tronqués."""

    def __init__(self, app, record, parent):
        super().__init__(parent)
        self.app = app
        self.record = record
        self.title("Fiche licence")
        self.configure(bg=BG)
        self.geometry("900x720")
        self.minsize(760, 520)
        self.transient(parent)
        self._build()

    def _build(self):
        r = db.normalize(self.record)
        c = r.get("client") or {}
        srv = r.get("server") or {}
        status = db.effective_status(r)

        head = _frame(self, bg=BG, padx=22, pady=18)
        head.pack(fill="x")
        _lbl(head, c.get("entreprise") or " ".join(x for x in (c.get("nom", ""), c.get("prenom", "")) if x).strip()
             or r.get("cid") or "Licence", font=FONT_H1).pack(anchor="w")
        line = _frame(head, bg=BG)
        line.pack(anchor="w", pady=(6, 0))
        _lbl(line, TYPE_LABEL.get(r.get("type"), r.get("type", "")), fg=ACCENT, font=FONT_B,
             bg=BG).pack(side="left")
        _lbl(line, "  ·  ", fg=MUTED, bg=BG).pack(side="left")
        _lbl(line, STATUS_LABEL.get(status, status), fg=STATUS_COLOR.get(status, TEXT),
             font=FONT_B, bg=BG).pack(side="left")
        _lbl(line, f"  ·  expire le {r.get('expires_at') or '—'}", fg=MUTED, font=FONT_SM,
             bg=BG).pack(side="left")

        scroll = ScrollFrame(self)
        scroll.pack(fill="both", expand=True)
        body = _frame(scroll.body, bg=BG, padx=22, pady=8)
        body.pack(fill="both", expand=True)

        # Identifiants
        card = Card(body)
        card.pack(fill="x", pady=(0, 14))
        _lbl(card, "Identifiants", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(card, "Valeurs complètes, sélectionnables et copiables — aucune troncature.",
             fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(2, 10))
        TokenView(card, "LID (identifiant de licence)", r.get("lid", ""), 2, "Copier le LID").pack(fill="x", pady=(0, 8))
        TokenView(card, "UUID", r.get("uuid", "") or "— (licence créée avant l'ajout de l'UUID)", 2, "Copier l'UUID").pack(fill="x", pady=(0, 8))
        TokenView(card, "Jeton signé (GF2…)", r.get("token", ""), 5, "Copier le jeton").pack(fill="x")

        # Licence
        card2 = Card(body)
        card2.pack(fill="x", pady=(0, 14))
        _lbl(card2, "Licence", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 10))
        self._grid(card2, [
            ("Type", TYPE_LABEL.get(r.get("type"), r.get("type", ""))),
            ("Offre / durée", f"{r.get('duration_label') or '—'}"),
            ("Créée le", (r.get("created_at") or r.get("issued_at") or "—")),
            ("Émise le", r.get("issued_at") or "—"),
            ("Expire le", r.get("expires_at") or "—"),
            ("Postes (sièges)", str(r.get("seats") or 1)),
            ("ID client", r.get("cid") or "—"),
            ("Étiquette", r.get("label") or "—"),
            ("Garage parent", r.get("parent_lid") or "—"),
            ("Mécanicien", r.get("mechanic_name") or "—"),
        ])

        # Matériel
        card3 = Card(body)
        card3.pack(fill="x", pady=(0, 14))
        _lbl(card3, "Liaison matérielle", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 10))
        TokenView(card3, "HWID (empreinte du poste)", r.get("hwid") or "Aucune liaison matérielle.", 2,
                  "Copier le HWID").pack(fill="x", pady=(0, 10))
        self._grid(card3, [
            ("État de la liaison", "Liée au matériel" if r.get("hwid") else "Non liée"),
            ("Première activation", (srv.get("activatedAt") or "—").replace("T", " ")[:19]),
            ("Dernière vérification", (srv.get("lastSeenAt") or "—").replace("T", " ")[:19]),
            ("Appareils actifs", f"{srv.get('activeDeviceCount', '—')} / {srv.get('seats', '—')} siège(s)"
                if srv else "— (serveur non synchronisé)"),
        ])

        # Client
        card4 = Card(body)
        card4.pack(fill="x", pady=(0, 14))
        _lbl(card4, "Bénéficiaire", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 10))
        self._grid(card4, [
            ("Prénom", c.get("prenom") or "—"), ("Nom", c.get("nom") or "—"),
            ("Entreprise", c.get("entreprise") or "—"), ("E-mail", c.get("email") or "—"),
            ("Téléphone", c.get("tel") or "—"), ("Adresse", c.get("adresse") or "—"),
            ("Code postal", c.get("code_postal") or "—"), ("Ville", c.get("ville") or "—"),
            ("Pays", c.get("pays") or "—"),
        ])
        if c.get("infos"):
            _lbl(card4, "Informations complémentaires", fg=MUTED, font=FONT_SM, bg=SURFACE).pack(
                anchor="w", pady=(10, 4))
            txt = tk.Text(card4, height=3, bg=SURFACE_2, fg=TEXT, font=FONT_SM, relief="flat", bd=0,
                          highlightthickness=1, highlightbackground=BORDER, padx=8, pady=6, wrap="word")
            txt.insert("1.0", c["infos"])
            txt.config(state="disabled")
            txt.pack(fill="x")

        # Serveur
        card5 = Card(body)
        card5.pack(fill="x", pady=(0, 22))
        _lbl(card5, "État serveur", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 10))
        if srv:
            self._grid(card5, [
                ("Statut serveur", STATUS_LABEL.get(srv.get("status"), srv.get("status", "—"))),
                ("Synchronisé le", r.get("server_synced_at") or "—"),
                ("Sièges / actifs", f"{srv.get('seats', '—')} / {srv.get('activeDeviceCount', '—')}"),
                ("Appareils", str(srv.get("deviceCount", "—"))),
            ])
            for device in (srv.get("devices") or [])[:10]:
                _lbl(card5, f"· {device.get('deviceId', '?')} · {device.get('platform') or '?'}"
                            f" · {device.get('appVersion') or '?'}"
                            f" · vu le {(device.get('lastSeenAt') or '—')[:19].replace('T', ' ')}",
                     fg=MUTED, font=FONT_XS, bg=SURFACE, anchor="w").pack(anchor="w")
        else:
            _lbl(card5, "Aucune donnée serveur : utilisez « Synchroniser le serveur ».",
                 fg=MUTED, font=FONT_SM, bg=SURFACE).pack(anchor="w")

    def _grid(self, parent, pairs):
        row = None
        for i, (label, value) in enumerate(pairs):
            if i % 2 == 0:
                row = _frame(parent, bg=SURFACE)
                row.pack(fill="x", pady=(0, 6))
            cell = _frame(row, bg=SURFACE)
            cell.pack(side="left", fill="x", expand=True, padx=(0, 12))
            _lbl(cell, label, fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w")
            _lbl(cell, str(value) or "—", fg=TEXT, font=FONT_SM, bg=SURFACE, anchor="w",
                 justify="left", wraplength=380).pack(anchor="w")


# ── Page 3 — Clés ECC ────────────────────────────────────────────────────────

class PageKeys(tk.Frame):
    """État de l'autorité de signature, passphrase, clé publique, contrôle d'ancres."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._build()
        self.refresh()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Clés ECC P-256", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Autorité de signature des licences. Une clé privée ne s'affiche ni ne se "
                   "reconstruit : elle se restaure.", fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        scroll = ScrollFrame(self)
        scroll.pack(fill="both", expand=True)
        body = _frame(scroll.body, bg=BG, padx=26, pady=6)
        body.pack(fill="both", expand=True)

        # État
        card = Card(body)
        card.pack(fill="x", pady=(0, 14))
        _lbl(card, "État de l'autorité", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        self.lbl_state = _lbl(card, "", font=FONT_B, bg=SURFACE)
        self.lbl_state.pack(anchor="w", pady=(6, 2))
        self.lbl_paths = _lbl(card, "", fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left")
        self.lbl_paths.pack(anchor="w")
        self.lbl_fp = _lbl(card, "", fg=ACCENT, font=(MONO[0], 9), bg=SURFACE)
        self.lbl_fp.pack(anchor="w", pady=(6, 0))
        bar = _frame(card, bg=SURFACE)
        bar.pack(fill="x", pady=(12, 0))
        Button(bar, "Vérifier la correspondance des clés", self._check, style="primary").pack(side="left")
        Button(bar, "↻ Actualiser", self.refresh, style="ghost").pack(side="left", padx=(8, 0))

        # Passphrase
        card_pp = Card(body)
        card_pp.pack(fill="x", pady=(0, 14))
        _lbl(card_pp, "Passphrase de la clé privée", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(card_pp, "Laissez vide si le fichier n'est pas chiffré. Rien n'est écrit sur le disque.",
             fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(2, 10))
        self.v_pp = tk.StringVar()
        row = _frame(card_pp, bg=SURFACE)
        row.pack(fill="x")
        Entry(row, textvariable=self.v_pp, show="•").pack(side="left", fill="x", expand=True, ipady=5)
        Button(row, "Appliquer", self._apply_passphrase, style="primary").pack(side="left", padx=(10, 0))
        self.lbl_pp = _lbl(card_pp, "", fg=MUTED, font=FONT_XS, bg=SURFACE)
        self.lbl_pp.pack(anchor="w", pady=(8, 0))

        # Nouvelle autorité
        card_init = Card(body)
        card_init.pack(fill="x", pady=(0, 14))
        _lbl(card_init, "Créer une nouvelle autorité", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(card_init,
             "⚠ Ceci crée une NOUVELLE paire de clés. Elle ne signera aucune licence acceptée par "
             "le logiciel tant qu'une rotation complète n'a pas été faite (keys:sync, reconstruction, "
             "serveur, redistribution), et cette rotation invalide toutes les licences existantes. "
             "Une clé perdue se restaure depuis une sauvegarde — elle ne se régénère pas.",
             fg=AMBER, font=FONT_XS, bg=SURFACE, justify="left", wraplength=760).pack(anchor="w", pady=(6, 12))
        Button(card_init, "🔑  Initialiser les clés", self._init_keys, style="warn").pack(anchor="w")

        # Clé publique
        card_pub = Card(body)
        card_pub.pack(fill="x", pady=(0, 22))
        _lbl(card_pub, "Clé publique", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(card_pub, "Diffusable sans risque : elle ne permet que de VÉRIFIER une signature.",
             fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(2, 10))
        self.pem_view = TokenView(card_pub, "Clé publique — PEM brut", "", 6,
                                  "COPIER LA CLÉ PUBLIQUE PEM")
        self.pem_view.pack(fill="x", pady=(0, 10))
        _lbl(card_pub, "Représentation pour le code client (tableau TS/JS)", fg=MUTED,
             font=FONT_SM, bg=SURFACE).pack(anchor="w")
        self.code_view = TokenView(card_pub, "Aperçu du tableau généré", "", 5, "Copier le tableau")
        self.code_view.pack(fill="x", pady=(4, 0))
        _lbl(card_pub, "Après un changement approuvé : npm run keys:sync, puis npm run keys:check, "
                       "puis reconstruction et redistribution.", fg=MUTED, font=FONT_XS,
             bg=SURFACE).pack(anchor="w", pady=(8, 0))

    # ── Données ──────────────────────────────────────────────────────────────
    def refresh(self):
        exists = core.keys_exist()
        if exists:
            self.lbl_state.config(text="● Paire présente — correspondance vérifiée avant chaque signature",
                                  fg=GREEN)
        elif core.PRIV_FILE.exists() or core.PUB_FILE.exists():
            self.lbl_state.config(text="● Paire incomplète — restaurez le fichier manquant", fg=AMBER)
        else:
            self.lbl_state.config(text="● Aucune paire — restaurez la clé de l'autorité", fg=RED)
        self.lbl_paths.config(text=f"Privée : {core.PRIV_FILE}\nPublique : {core.PUB_FILE}")
        if core.PUB_FILE.exists():
            try:
                from keygen_trust import fingerprint
                pub = core.load_public_key()
                self.lbl_fp.config(text=f"Empreinte publique (SHA-256 du SPKI) : {fingerprint(pub)}")
            except Exception:
                self.lbl_fp.config(text="Empreinte indisponible (clé publique illisible).")
            try:
                self.pem_view.set(core.PUB_FILE.read_text(encoding="utf-8").strip())
                self.code_view.set(self._pem_to_code())
            except Exception as exc:
                self.pem_view.set(f"Lecture impossible : {exc}")
        else:
            self.lbl_fp.config(text="")
            self.pem_view.set("(aucune clé publique)")
            self.code_view.set("(aucune clé publique)")

    def _pem_to_code(self) -> str:
        if not core.PUB_FILE.exists():
            return "(aucune clé publique)"
        lines = [ln for ln in core.PUB_FILE.read_text(encoding="utf-8").strip().splitlines() if ln.strip()]
        items = ",\n  ".join(f"'{ln}'" for ln in lines)
        return ("// Généré par le Keygen — ne pas éditer à la main.\n"
                "// Ancré dans electron/main.js (_PK) et src/lib/license/public-key.ts (_LINES).\n"
                f"[\n  {items},\n]")

    def _apply_passphrase(self):
        pp = self.v_pp.get()
        self.app.passphrase = pp
        if not core.keys_exist():
            self.lbl_pp.config(text="Aucune paire à tester.", fg=MUTED)
            return
        def _work():
            from keygen_trust import check_key_match
            return check_key_match(core.load_private_key(pp), core.ROOT_DIR)

        def _done(receipt):
            self.lbl_pp.config(text="✓ Clé chargée et conforme aux ancres locales.", fg=GREEN)
            _info("Correspondance des clés",
                  "La clé privée chargée correspond aux trois ancres locales.\n\n"
                  + _json.dumps(receipt, indent=2, ensure_ascii=False), self)

        def _failed(message):
            self.lbl_pp.config(text="✗ Clé non chargée ou non conforme.", fg=RED)
            if "n'est PAS" in message or "KEY_MISMATCH" in message:
                _error("Clé non conforme",
                       "La clé privée chargée n'est pas la clé de production : la signature reste "
                       "bloquée.\n\nRestaurez le fichier privé de l'autorité depuis sa sauvegarde, "
                       "par le canal approuvé.\n\n" + message.split("\n\nDétail")[0], self)
            else:
                _error("Clé illisible", message, self)

        _background(self, _work, on_done=_done, on_error=_failed)

    def _check(self):
        def _work():
            from keygen_trust import check_key_match
            return check_key_match(core.load_checked_private_key(self.app.passphrase), core.ROOT_DIR)

        def _done(receipt):
            _info("Correspondance des clés",
                  "Clé privée, PEM public et deux ancres source concordent.\n\n"
                  + _json.dumps(receipt, indent=2, ensure_ascii=False), self)
            self.app.toast.show("Clés conformes.", "ok")

        _background(self, _work, on_done=_done,
                    on_error=lambda m: _error("Correspondance des clés", m.split("\n\nDétail")[0], self))

    def _init_keys(self):
        existing = [p for p in (core.PRIV_FILE, core.PUB_FILE) if p.exists()]
        if existing:
            if not messagebox.askyesno(
                    "Régénérer ?",
                    "Des clés existent déjà :\n" + "\n".join(f"  · {p}" for p in existing) +
                    "\n\nRégénérer INVALIDE toutes les licences déjà signées avec l'autorité actuelle.\n\n"
                    "Continuer ?", parent=self):
                return
        else:
            if not messagebox.askyesno(
                    "Nouvelle autorité",
                    "Vous allez créer une NOUVELLE paire de clés.\n\n"
                    "Elle ne pourra signer aucune licence acceptée par le logiciel actuel tant "
                    "qu'une rotation complète n'est pas faite (keys:sync, reconstruction, serveur, "
                    "redistribution), et cette rotation invalide toutes les licences existantes.\n\n"
                    "Continuer ?", parent=self):
                return
        try:
            core.generate_keys(self.v_pp.get())
        except Exception as exc:
            _error("Initialisation impossible", str(exc), self)
            return
        db.audit_log("keygen_init")
        self.refresh()
        _info("Clés générées",
              "Nouvelle paire ECC P-256 créée.\n\n"
              "Ne recopiez pas les tableaux à la main. Après approbation :\n"
              "  npm run keys:sync puis npm run keys:check\n"
              "puis reconstruction et redistribution des postes.", self)


# ── Page 4 — Signature des mises à jour ──────────────────────────────────────

class PageUpdates(tk.Frame):
    """Sélection, signature et vérification d'un installeur."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self.file_path = ""
        self._busy = False
        self._build()
        self._refresh_key_state()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Signature des mises à jour", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Signer un installeur produit un manifeste Ed25519 accepté par les postes. "
                   "La signature est vérifiée avec le module du client, pas avec une copie.",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        scroll = ScrollFrame(self)
        scroll.pack(fill="both", expand=True)
        body = _frame(scroll.body, bg=BG, padx=26, pady=6)
        body.pack(fill="both", expand=True)

        # Dépôt
        card = Card(body)
        card.pack(fill="x", pady=(0, 14))
        _lbl(card, "1 · Fichier à signer", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        drop = tk.Frame(card, bg=SURFACE_2, highlightthickness=1, highlightbackground=ACCENT,
                        height=110)
        drop.pack(fill="x", pady=(10, 4))
        drop.pack_propagate(False)
        self.drop_label = _lbl(drop, "Déposez un fichier ici\nou utilisez « Sélectionner un fichier » "
                                     "(Ctrl+V pour coller un chemin)", fg=MUTED, font=FONT_SM,
                               bg=SURFACE_2, justify="center")
        self.drop_label.pack(expand=True)
        for widget in (drop, self.drop_label):
            widget.bind("<Button-1>", lambda _e: self._pick_file())
            widget.bind("<Control-v>", lambda _e: self._paste_path())
        row = _frame(card, bg=SURFACE)
        row.pack(fill="x", pady=(8, 0))
        Button(row, "Sélectionner un fichier", self._pick_file, style="primary").pack(side="left")
        Button(row, "Coller un chemin", self._paste_path, style="ghost").pack(side="left", padx=(8, 0))
        self.lbl_file = _lbl(card, "Aucun fichier sélectionné.", fg=MUTED, font=FONT_XS,
                             bg=SURFACE, justify="left", anchor="w")
        self.lbl_file.pack(fill="x", pady=(10, 0))
        self._enable_dnd(drop)

        # Paramètres
        card2 = Card(body)
        card2.pack(fill="x", pady=(0, 14))
        _lbl(card2, "2 · Paramètres de la mise à jour", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(card2, "La version doit être celle de CETTE release ; l'URL doit être en HTTPS, sur un "
                    "domaine accepté par les postes.", fg=MUTED, font=FONT_XS, bg=SURFACE).pack(
            anchor="w", pady=(2, 10))
        self.v_version = tk.StringVar()
        self.v_url = tk.StringVar()
        self.v_channel = tk.StringVar(value="stable")
        self.v_platform = tk.StringVar(value="win32")
        self.v_arch = tk.StringVar(value="x64")
        self.v_keyid = tk.StringVar()
        self.v_min = tk.StringVar()

        self._row_field(card2, "Version (SemVer)", self.v_version, "ex. 1.2.0")
        self._row_field(card2, "URL de téléchargement (HTTPS)", self.v_url,
                        "https://api.garageflows.fr/downloads/…")
        triplet = _frame(card2, bg=SURFACE)
        triplet.pack(fill="x", pady=(8, 0))
        for label, var, values, width in (("Canal", self.v_channel, ["stable", "beta"], 10),
                                          ("Plateforme", self.v_platform, ["win32", "darwin", "linux"], 10),
                                          ("Architecture", self.v_arch, ["x64", "arm64"], 8)):
            cell = _frame(triplet, bg=SURFACE)
            cell.pack(side="left", fill="x", expand=True, padx=(0, 8))
            _lbl(cell, label, fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w")
            ttk.Combobox(cell, textvariable=var, values=values, width=width,
                         font=FONT_SM).pack(fill="x", ipady=4, pady=(4, 0))
        duo = _frame(card2, bg=SURFACE)
        duo.pack(fill="x", pady=(8, 0))
        for label, var, placeholder in (("keyId (clé connue des postes)", self.v_keyid, ""),
                                        ("Version minimale requise", self.v_min, "facultatif")):
            cell = _frame(duo, bg=SURFACE)
            cell.pack(side="left", fill="x", expand=True, padx=(0, 8))
            _lbl(cell, label, fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w")
            Entry(cell, textvariable=var, placeholder=placeholder).pack(fill="x", ipady=5, pady=(4, 0))
        self.lbl_hosts = _lbl(card2, "", fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left")
        self.lbl_hosts.pack(anchor="w", pady=(10, 0))

        # Clé
        card3 = Card(body)
        card3.pack(fill="x", pady=(0, 14))
        _lbl(card3, "3 · Clé de signature (Ed25519)", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        _lbl(card3, "La clé privée reste dans votre environnement : elle n'est ni lue depuis le "
                    "dépôt, ni affichée, ni journalisée.", fg=MUTED, font=FONT_XS, bg=SURFACE).pack(
            anchor="w", pady=(2, 10))
        self.lbl_key = _lbl(card3, "", fg=MUTED, font=FONT_SM, bg=SURFACE, justify="left")
        self.lbl_key.pack(anchor="w")
        bar = _frame(card3, bg=SURFACE)
        bar.pack(fill="x", pady=(10, 0))
        Button(bar, "Choisir le fichier de clé…", self._pick_key, style="ghost").pack(side="left")
        self.key_file = ""

        # Résultat
        card4 = Card(body)
        card4.pack(fill="x", pady=(0, 22))
        _lbl(card4, "4 · Signature et vérification", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        bar2 = _frame(card4, bg=SURFACE)
        bar2.pack(fill="x", pady=(10, 0))
        self.btn_sign = Button(bar2, "✍  Signer la mise à jour", self._sign, style="primary")
        self.btn_sign.pack(side="left")
        self.btn_verify = Button(bar2, "✓ Vérifier le manifeste", self._verify, style="ghost")
        self.btn_verify.pack(side="left", padx=(8, 0))
        self.lbl_status = _lbl(bar2, "", fg=MUTED, font=FONT_SM, bg=SURFACE)
        self.lbl_status.pack(side="right")
        self.result = TokenView(card4, "Rapport", "", 8, "Copier le rapport")
        self.result.pack(fill="x", pady=(12, 0))
        self.manifest_path = ""

    def _row_field(self, parent, label, var, placeholder=""):
        _lbl(parent, label, fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w", pady=(8, 4))
        Entry(parent, textvariable=var, placeholder=placeholder).pack(fill="x", ipady=5)

    def _enable_dnd(self, drop):
        """Glisser-déposer natif si `tkinterdnd2` est installé, sinon mention claire."""
        try:
            from tkinterdnd2 import DND_FILE  # type: ignore
            drop.drop_target_register(DND_FILE)
            drop.dnd_bind("<<Drop>>", lambda e: self._load_path(e.data.strip().strip("{}")))
            self.drop_label.config(text="Déposez un fichier ici\nou utilisez « Sélectionner un fichier »")
        except Exception:
            self.drop_label.config(
                text="Glisser-déposer : module tkinterdnd2 absent —\nutilisez « Sélectionner un fichier » "
                     "ou « Coller un chemin »")

    # ── Fichier ──────────────────────────────────────────────────────────────
    def _pick_file(self):
        path = filedialog.askopenfilename(parent=self, title="Installeur à signer")
        if path:
            self._load_path(path)

    def _paste_path(self):
        try:
            raw = self.clipboard_get()
        except tk.TclError:
            _info("Presse-papiers vide", "Copiez d'abord un chemin de fichier.", self)
            return
        self._load_path(raw.strip().strip('"').strip("'"))

    def _load_path(self, path):
        try:
            info = updates.file_info(path)
        except updates.UpdateError as exc:
            _error("Fichier invalide", str(exc), self)
            return
        self.file_path = info["path"]
        self.lbl_file.config(
            text=f"Nom : {info['name']}\nChemin : {info['path']}\n"
                 f"Taille : {info['size_human']} ({info['size']} octets) · Extension : {info['ext'] or '—'}\n"
                 f"SHA-256 : {info['sha256']}"
                 + ("" if updates.is_probable_installer(path)
                    else f"\n⚠ Extension inhabituelle pour un installeur GarageFlows."),
            fg=TEXT)
        if not self.v_version.get():
            found = re.search(r"(\d+\.\d+\.\d+)", info["name"])
            if found:
                self.v_version.set(found.group(1))
        if not self.v_url.get():
            hosts = updates.client_allowed_hosts()
            host = "api.garageflows.fr" if "api.garageflows.fr" in hosts else (hosts[0] if hosts else "")
            if host:
                self.v_url.set(f"https://{host}/downloads/{info['name']}")
        self.lbl_hosts.config(text="Domaines acceptés par les postes : "
                                   + ", ".join(updates.client_allowed_hosts()))

    # ── Clé ──────────────────────────────────────────────────────────────────
    def _pick_key(self):
        path = filedialog.askopenfilename(parent=self, title="Clé privée Ed25519 (PEM PKCS#8)",
                                          filetypes=[("PEM", "*.pem *.key"), ("Tous les fichiers", "*.*")])
        if path:
            self.key_file = path
            self._refresh_key_state()

    def _refresh_key_state(self):
        env = dict(os.environ)
        if self.key_file:
            env["GF_UPDATE_SIGNING_KEY_FILE"] = self.key_file
        ok, detail = updates.signing_key_available(env)
        keys = updates.client_public_keys()
        known = ", ".join(keys) if keys else "aucune clé lue"
        if ok:
            self.lbl_key.config(text=f"● Clé disponible : {detail}\n  keyId connus des postes : {known}",
                                fg=GREEN)
        else:
            self.lbl_key.config(
                text=f"● {detail}\n  keyId connus des postes : {known}\n"
                     "  Renseignez GF_UPDATE_SIGNING_KEY, ou choisissez le fichier de clé.",
                fg=AMBER)
        if keys and not self.v_keyid.get():
            self.v_keyid.set(sorted(keys)[-1])
        if not self.lbl_hosts.cget("text"):
            self.lbl_hosts.config(text="Domaines acceptés par les postes : "
                                       + ", ".join(updates.client_allowed_hosts()))

    # ── Signature / vérification ─────────────────────────────────────────────
    def _set_busy(self, busy: bool):
        self._busy = busy
        try:
            state = "disabled" if busy else "normal"
            self.btn_sign.config(state=state)
            self.btn_verify.config(state=state)
        except tk.TclError:
            pass

    def _sign(self):
        if self._busy:
            return
        if not self.file_path:
            _error("Fichier requis", "Sélectionnez d'abord l'installeur à signer.", self)
            return
        if not self.v_version.get().strip() or not self.v_url.get().strip():
            _error("Paramètres requis", "La version et l'URL de téléchargement sont obligatoires.", self)
            return
        self._set_busy(True)
        self.lbl_status.config(text="⏳ Signature en cours…")

        env = dict(os.environ)
        if self.key_file:
            env["GF_UPDATE_SIGNING_KEY_FILE"] = self.key_file

        def _work():
            return updates.sign_update(
                self.file_path, self.v_version.get().strip(), self.v_url.get().strip(),
                channel=self.v_channel.get(), platform=self.v_platform.get(), arch=self.v_arch.get(),
                key_id=self.v_keyid.get().strip() or None,
                min_version=self.v_min.get().strip() or None,
                key_file=self.key_file or None, env=env)

        def _done(res):
            self._set_busy(False)
            status = "✓ Manifeste signé." if res["ok"] else "✗ Échec de la signature."
            self.lbl_status.config(text=status, fg=GREEN if res["ok"] else RED)
            self.result.set(res["output"])
            if res["ok"]:
                self.manifest_path = res["manifest_path"]
                db.audit_log("update_signed", "", f"version={self.v_version.get().strip()}")
                self.app.toast.show("Manifeste signé. Vérifiez-le avant publication.", "ok")
                self._verify(auto=True)
            else:
                self.app.toast.show("Signature refusée — voir le rapport.", "error", 8000)

        def _failed(message):
            self._set_busy(False)
            self.lbl_status.config(text="✗ Signature impossible", fg=RED)
            self.result.set(message)
            self.app.toast.show("Signature impossible.", "error", 8000)

        _background(self, _work, on_done=_done, on_error=_failed)

    def _verify(self, auto=False):
        path = self.manifest_path
        if not path or not Path(path).exists():
            chosen = filedialog.askopenfilename(parent=self, title="Manifeste signé",
                                                filetypes=[("JSON", "*.json")])
            if not chosen:
                return
            path = chosen
        self.manifest_path = path

        def _work():
            return updates.verify_signed_manifest(
                path, current_version="0.0.0",
                channel=self.v_channel.get() or None,
                platform=self.v_platform.get() or None,
                arch=self.v_arch.get() or None)

        def _done(res):
            lines = [f"Vérificateur utilisé : electron/update-verify.js (module du poste client)"]
            if res.get("ok"):
                lines += [
                    "✓ ACCEPTÉ par le vérificateur du client.",
                    f"  version      : {res.get('version')}",
                    f"  keyId        : {res.get('keyId')}",
                    f"  sha256       : {res.get('sha256')}",
                    f"  taille       : {res.get('size')} octets",
                    f"  fichier      : {res.get('fileName')}",
                    f"  canal        : {res.get('channel')} · {res.get('platform')}/{res.get('architecture')}",
                    f"  contrôles    : {res.get('checks')}",
                ]
                self.lbl_status.config(text="✓ Manifeste vérifié", fg=GREEN)
                if not auto:
                    self.app.toast.show("Manifeste accepté par le vérificateur du client.", "ok")
            else:
                lines += [f"✗ REFUSÉ : {res.get('reason')} (code {res.get('code')})"]
                self.lbl_status.config(text="✗ Manifeste refusé", fg=RED)
            self.result.set("\n".join(lines))

        _background(self, _work, on_done=_done,
                    on_error=lambda m: self.result.set(f"Vérification impossible : {m}"))


# ── Page 5 — Serveur ─────────────────────────────────────────────────────────

class PageDashboard(tk.Frame):
    """Vue d'ensemble : uniquement des chiffres réels, aucun indicateur inventé."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._cards = {}
        self._build()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Tableau de bord", font=FONT_H1).pack(anchor="w")
        _lbl(head, "État réel de la base locale, de l'autorité de signature et du serveur.",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))
        Button(head, "↻ Actualiser", self.refresh, style="ghost").pack(side="right")

        scroll = ScrollFrame(self)
        scroll.pack(fill="both", expand=True)
        body = _frame(scroll.body, bg=BG, padx=26, pady=4)
        body.pack(fill="both", expand=True)

        cards = _frame(body, bg=BG)
        cards.pack(fill="x", pady=(0, 14))
        for key, label in (("total", "Licences"), ("active", "Actives"), ("expired", "Expirées"),
                           ("revoked", "Révoquées"), ("clients", "Clients"), ("liees", "Matériel lié")):
            card = Card(cards, pady=12)
            card.pack(side="left", fill="x", expand=True, padx=(0, 8))
            value = _lbl(card, "—", fg=ACCENT, font=("Segoe UI", 22, "bold"), bg=SURFACE)
            value.pack(anchor="w")
            _lbl(card, label, fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w")
            self._cards[key] = value

        grid = _frame(body, bg=BG)
        grid.pack(fill="x", pady=(0, 14))
        grid.columnconfigure(0, weight=1)
        grid.columnconfigure(1, weight=1)

        keys = Card(grid)
        keys.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        _lbl(keys, "Autorité de signature", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 8))
        self.lbl_keys = _lbl(keys, "", fg=TEXT, font=FONT_SM, bg=SURFACE, justify="left", anchor="w")
        self.lbl_keys.pack(fill="x")
        self.lbl_paths = _lbl(keys, "", fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left", anchor="w")
        self.lbl_paths.pack(fill="x", pady=(8, 0))

        srv = Card(grid)
        srv.grid(row=0, column=1, sticky="nsew", padx=(8, 0))
        _lbl(srv, "Serveur central", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 8))
        self.lbl_srv = _lbl(srv, "", fg=TEXT, font=FONT_SM, bg=SURFACE, justify="left", anchor="w")
        self.lbl_srv.pack(fill="x")
        self.lbl_srv_cfg = _lbl(srv, "", fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left", anchor="w")
        self.lbl_srv_cfg.pack(fill="x", pady=(8, 0))

        audit = Card(body)
        audit.pack(fill="both", expand=True)
        _lbl(audit, "Journal récent", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 8))
        self.txt = tk.Text(audit, height=10, bg=SURFACE_2, fg=TEXT, font=(MONO[0], 9), relief="flat",
                           bd=0, highlightthickness=1, highlightbackground=BORDER, padx=8, pady=6,
                           wrap="none")
        self.txt.pack(fill="both", expand=True)
        self._set_journal("Aucun événement enregistré.")

    def _set_journal(self, contenu):
        if not _widget_alive(self.txt):
            return
        try:
            self.txt.config(state="normal")
            self.txt.delete("1.0", "end")
            self.txt.insert("1.0", contenu)
            self.txt.config(state="disabled")
        except tk.TclError:
            pass

    def refresh(self, *_):
        if not _widget_alive(self):
            return
        stats = db.dashboard_stats()
        for key, label in self._cards.items():
            valeur = stats.get(key, "—")
            if _widget_alive(label):
                label.config(text=str(valeur))
        types = ", ".join(f"{k}: {v}" for k, v in sorted(stats.get("par_type", {}).items()))
        if _widget_alive(self.lbl_keys):
            if core.keys_exist():
                etat = "Paire présente — signature opérationnelle."
                couleur = GREEN
            elif core.PRIV_FILE.exists() or core.PUB_FILE.exists():
                etat = "Paire INCOMPLÈTE — signature impossible."
                couleur = AMBER
            else:
                etat = "Aucune clé — restaurez l'autorité depuis sa sauvegarde."
                couleur = RED
            self.lbl_keys.config(text=etat + (f"\nRépartition : {types}" if types else ""), fg=couleur)
            self.lbl_paths.config(text=f"Privée : {core.PRIV_FILE}\nPublique : {core.PUB_FILE}")
        cfg = db.load_server_config()
        if _widget_alive(self.lbl_srv):
            if cfg.get("url") and cfg.get("api_key"):
                self.lbl_srv.config(text=f"Connecté à {cfg.get('url')}", fg=GREEN)
            elif cfg.get("url"):
                self.lbl_srv.config(text=f"URL enregistrée ({cfg.get('url')}) — clé API manquante.", fg=AMBER)
            else:
                self.lbl_srv.config(text="Non configuré : la gestion reste locale.", fg=AMBER)
            self.lbl_srv_cfg.config(
                text=f"Base locale : {db.DB_FILE}\nDernière synchronisation : "
                     f"{max((r.get('server_synced_at') or '' for r in db.list_licenses()), default='') or '—'}")
        journal = db.read_audit(12)
        self._set_journal("\n".join(journal) if journal else "Aucun événement enregistré.")


class PageClients(tk.Frame):
    """Clients agrégés depuis les licences : aucune fiche inventée."""

    COLUMNS = (
        ("cid", "ID client", 130), ("nom", "Nom", 170), ("entreprise", "Entreprise", 190),
        ("email", "E-mail", 210), ("tel", "Téléphone", 130), ("ville", "Ville", 130),
        ("licences", "Licences", 80), ("actives", "Actives", 70), ("emission", "Dernière émission", 160),
    )

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self.rows = []
        self._build()
        self.refresh()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Clients", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Agrégation par identifiant client, calculée depuis les licences de la base locale.",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        toolbar = Card(_frame(self, bg=BG, padx=26), pady=12)
        toolbar.pack(fill="x", pady=(0, 12))
        bar = _frame(toolbar, bg=SURFACE)
        bar.pack(fill="x")
        _lbl(bar, "Recherche", fg=MUTED, font=FONT_XS, bg=SURFACE).pack(side="left", padx=(0, 8))
        self.v_search = tk.StringVar()
        Entry(bar, textvariable=self.v_search, placeholder="nom, entreprise, e-mail, identifiant…").pack(
            side="left", fill="x", expand=True, ipady=5)
        self.v_search.trace_add("write", lambda *_: self.refresh())
        Button(bar, "↻ Actualiser", self.refresh, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Voir les licences", self._open_licences, style="primary").pack(side="left", padx=(8, 0))
        self.lbl_count = _lbl(bar, "", fg=MUTED, font=FONT_SM, bg=SURFACE)
        self.lbl_count.pack(side="right")

        table = Card(_frame(self, bg=BG, padx=26), padx=1, pady=1)
        table.pack(fill="both", expand=True, pady=(0, 22))
        wrap = _frame(table, bg=SURFACE)
        wrap.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(wrap, columns=[c[0] for c in self.COLUMNS], show="headings",
                                 selectmode="browse", height=16)
        for name, title, width in self.COLUMNS:
            self.tree.heading(name, text=title)
            self.tree.column(name, width=width, anchor="w", stretch=False)
        sy = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        sx = ttk.Scrollbar(wrap, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=sy.set, xscrollcommand=sx.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        wrap.rowconfigure(0, weight=1)
        wrap.columnconfigure(0, weight=1)
        self.tree.bind("<Double-1>", lambda _e: self._open_licences())

    def refresh(self, *_):
        if not _widget_alive(self):
            return
        tous = db.client_summary()
        requete = self.v_search.get().strip().lower() if hasattr(self, "v_search") else ""
        if requete:
            self.rows = [c for c in tous if requete in " ".join(
                str(c.get(k) or "") for k in ("cid", "nom", "entreprise", "email", "tel", "ville")).lower()]
        else:
            self.rows = tous
        for iid in self.tree.get_children():
            self.tree.delete(iid)
        for client in self.rows:
            self.tree.insert("", "end", iid=client["cid"], values=(
                client.get("cid") or "—", client.get("nom") or "—",
                client.get("entreprise") or "—", client.get("email") or "—",
                client.get("tel") or "—", client.get("ville") or "—",
                client.get("licences"), client.get("actives"),
                (client.get("derniere_emission") or "—")[:19].replace("T", " "),
            ))
        if _widget_alive(self.lbl_count):
            self.lbl_count.config(text=f"{len(self.rows)} client(s)")

    def _open_licences(self):
        selection = self.tree.selection()
        if not selection:
            return
        cid = selection[0]
        page = getattr(self.app, "page_manage", None)
        if page is None or not hasattr(page, "v_search"):
            return
        page.v_search.set(cid)
        page.refresh()
        if hasattr(self.app, "_show"):
            self.app._show("manage")


class PageDevices(tk.Frame):
    """Appareils et HWID : liaison matérielle et sièges, sans jamais exposer un jeton."""

    COLUMNS = (
        ("lid", "LID", 250), ("client", "Client", 190), ("type", "Type", 100),
        ("statut", "Statut", 100), ("hwid", "HWID", 420), ("sieges", "Sièges", 70),
        ("actifs", "Appareils actifs", 110), ("activite", "Dernière activité", 170),
    )

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self.rows = []
        self._build()
        self.refresh()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Appareils et HWID", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Le HWID officiel est calculé par le poste (Electron). Le keygen le reçoit, "
                   "ne le recalcule jamais.", fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        toolbar = Card(_frame(self, bg=BG, padx=26), pady=12)
        toolbar.pack(fill="x", pady=(0, 12))
        bar = _frame(toolbar, bg=SURFACE)
        bar.pack(fill="x")
        self.v_search = tk.StringVar()
        Entry(bar, textvariable=self.v_search, placeholder="LID, client, HWID…").pack(
            side="left", fill="x", expand=True, ipady=5)
        self.v_search.trace_add("write", lambda *_: self.refresh())
        Button(bar, "↻ Actualiser", self.refresh, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "⇄ Synchroniser le serveur", self._sync, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Réinitialiser le matériel", self._reset, style="warn").pack(side="left", padx=(8, 0))
        self.lbl_count = _lbl(bar, "", fg=MUTED, font=FONT_SM, bg=SURFACE)
        self.lbl_count.pack(side="right")

        table = Card(_frame(self, bg=BG, padx=26), padx=1, pady=1)
        table.pack(fill="both", expand=True, pady=(0, 12))
        wrap = _frame(table, bg=SURFACE)
        wrap.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(wrap, columns=[c[0] for c in self.COLUMNS], show="headings",
                                 selectmode="browse", height=15)
        for name, title, width in self.COLUMNS:
            self.tree.heading(name, text=title)
            self.tree.column(name, width=width, anchor="w", stretch=False)
        sy = ttk.Scrollbar(wrap, orient="vertical", command=self.tree.yview)
        sx = ttk.Scrollbar(wrap, orient="horizontal", command=self.tree.xview)
        self.tree.configure(yscrollcommand=sy.set, xscrollcommand=sx.set)
        self.tree.grid(row=0, column=0, sticky="nsew")
        sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        wrap.rowconfigure(0, weight=1)
        wrap.columnconfigure(0, weight=1)

        self.lbl_hint = _lbl(_frame(self, bg=BG, padx=26), "Sélectionnez une licence pour agir sur son matériel.",
                             fg=MUTED, font=FONT_SM)
        self.lbl_hint.pack(fill="x", pady=(0, 20), anchor="w")

    def refresh(self, *_):
        if not _widget_alive(self):
            return
        tous = db.device_summary()
        requete = self.v_search.get().strip().lower() if hasattr(self, "v_search") else ""
        if requete:
            self.rows = [r for r in tous if requete in " ".join(
                str(r.get(k) or "") for k in ("lid", "client", "cid", "hwid")).lower()]
        else:
            self.rows = tous
        for iid in self.tree.get_children():
            self.tree.delete(iid)
        for row in self.rows:
            self.tree.insert("", "end", iid=row["lid"], values=(
                row["lid"], row["client"], TYPE_LABEL.get(row["type"], row["type"] or "—"),
                STATUS_LABEL.get(row["statut"], row["statut"]),
                row["hwid"] or "— (non liée)", row["sieges"], row["appareils_actifs"],
                (row["derniere_activite"] or "—")[:19].replace("T", " "),
            ))
        if _widget_alive(self.lbl_count):
            liees = sum(1 for r in self.rows if r["lie"])
            self.lbl_count.config(text=f"{len(self.rows)} licence(s) · {liees} liée(s) au matériel")

    def _selected(self):
        selection = self.tree.selection()
        if not selection:
            _info("Appareils", "Sélectionnez d'abord une licence.", self)
            return None
        return db.get_license(selection[0])

    def _sync(self):
        page = getattr(self.app, "page_manage", None)
        if page is not None and hasattr(page, "_sync_server"):
            page._sync_server()
        else:
            _info("Synchronisation", "Ouvrez « Gérer les licences » pour synchroniser.", self)

    def _reset(self):
        row = self._selected()
        if not row:
            return
        url, key = self.app.server_config()
        if not (url and key):
            _warn("Serveur requis", "La réinitialisation matérielle se fait côté serveur : "
                                    "renseignez l'URL et la clé API dans « Paramètres et serveur ».", self)
            return
        if not messagebox.askyesno(
                "Réinitialiser le matériel",
                "Libérer les appareils enregistrés pour cette licence ?\n\n"
                "Un jeton signé portant lui-même un HWID restera lié à son matériel d'origine : "
                "il faudra alors émettre une nouvelle licence.", parent=self):
            return

        def _work():
            return server.reset_hwid(url, key, row["lid"], action="reset", reason="keygen:devices")

        def _done(result):
            ok, message = result
            self.app.toast.show(message, "ok" if ok else "error", 8000)
            if ok:
                page = getattr(self.app, "page_manage", None)
                if page is not None and hasattr(page, "_sync_server"):
                    page._sync_server()

        _background(self, _work, on_done=_done,
                    on_error=lambda m: self.app.toast.show(m, "error", 8000))


class PageSecrets(tk.Frame):
    """Détection de secrets dans une capture — réutilise scripts/secret_scan.py."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._last = None
        self._service = None
        self._patterns = None
        self._build()
        self.refresh()

    def _module(self, silencieux: bool = False):
        try:
            import secret_scan
            return secret_scan
        except Exception as exc:                     # noqa: BLE001
            if not silencieux and not getattr(self, "_module_error_shown", False):
                self._module_error_shown = True
                _error("Module indisponible",
                       "scripts/secret_scan.py n'a pas pu être chargé.\n\n"
                       f"{exc.__class__.__name__}", self)
            return None

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Détection des secrets", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Analyse locale d'une capture avant partage. Les valeurs ne sont jamais affichées "
                   "en clair et aucune image n'est conservée.", fg=MUTED, font=FONT_SM).pack(
            anchor="w", pady=(4, 0))

        status = Card(_frame(self, bg=BG, padx=26), pady=12)
        status.pack(fill="x", pady=(0, 12))
        self.lbl_status = _lbl(status, "", fg=TEXT, font=FONT_SM, bg=SURFACE, justify="left", anchor="w")
        self.lbl_status.pack(fill="x")
        self.lbl_service = _lbl(status, "", fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left", anchor="w")
        self.lbl_service.pack(fill="x", pady=(6, 0))

        bar = _frame(status, bg=SURFACE)
        bar.pack(fill="x", pady=(10, 0))
        Button(bar, "Choisir une capture…", self._choose, style="primary").pack(side="left")
        Button(bar, "Vérifier le service", self._health, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Démarrer le service local", self._start_service, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Arrêter", self._stop_service, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Exporter le rapport", self._export, style="ghost").pack(side="left", padx=(8, 0))

        verdict = Card(_frame(self, bg=BG, padx=26), pady=12)
        verdict.pack(fill="x", pady=(0, 12))
        self.lbl_verdict = _lbl(verdict, "Aucune analyse effectuée.", fg=MUTED, font=FONT_B, bg=SURFACE)
        self.lbl_verdict.pack(anchor="w")

        table = Card(_frame(self, bg=BG, padx=26), padx=1, pady=1)
        table.pack(fill="both", expand=True, pady=(0, 20))
        wrap = _frame(table, bg=SURFACE)
        wrap.pack(fill="both", expand=True)
        self.COLUMNS = (("type", "Type", 240), ("family", "Famille", 120), ("score", "Score", 70),
                        ("valeur", "Valeur masquée", 170), ("position", "Position", 120))
        self.tree = ttk.Treeview(wrap, columns=[c[0] for c in self.COLUMNS], show="headings",
                                 height=10)
        for name, title, width in self.COLUMNS:
            self.tree.heading(name, text=title)
            self.tree.column(name, width=width, anchor="w", stretch=False)
        self.tree.pack(fill="both", expand=True)

    def refresh(self, *_):
        if not _widget_alive(self.lbl_status):
            return
        module = self._module(silencieux=True)
        if module is None:
            self.lbl_status.config(text="Module de scan indisponible.", fg=RED)
            return
        try:
            self._patterns = self._patterns or module.load_patterns()
            ocr = module.ocr_available()
            self.lbl_status.config(
                text=f"Règles : {len(self._patterns)} (version {self._patterns.version}) · "
                     f"OCR : {'disponible' if ocr else 'indisponible (les scans image seront refusés)'} · "
                     f"Persistance : aucune", fg=TEXT if ocr else AMBER)
        except Exception as exc:                     # noqa: BLE001
            self.lbl_status.config(text=f"Configuration de scan invalide : {exc}", fg=RED)
        self._health(silencieux=True)

    def _choose(self):
        chemin = filedialog.askopenfilename(
            parent=self, title="Capture à analyser",
            filetypes=[("Images", "*.png *.jpg *.jpeg *.gif *.bmp"), ("Tous les fichiers", "*.*")])
        if not chemin:
            return
        module = self._module()
        if module is None:
            return
        self.lbl_verdict.config(text="Analyse en cours…", fg=MUTED)

        def _work():
            data = Path(chemin).read_bytes()
            return module.scan_image(data, self._patterns or module.load_patterns())

        def _done(resultat):
            self._last = resultat
            for iid in self.tree.get_children():
                self.tree.delete(iid)
            for secret in resultat.get("secrets", []):
                self.tree.insert("", "end", values=(
                    secret["type"], secret["family"], f"{secret['score']:.2f}",
                    secret["value_redacted"], f"{secret['start']}..{secret['end']}"))
            if resultat.get("blocked"):
                self.lbl_verdict.config(
                    text=f"PARTAGE BLOQUÉ — {resultat['count']} secret(s) détecté(s). "
                         "Masquez la zone ou retirez le secret avant diffusion.", fg=RED)
            else:
                self.lbl_verdict.config(text="Aucun secret détecté dans cette capture.", fg=GREEN)
            db.audit_log("secret_scan", "", f"n={resultat.get('count', 0)}")

        def _failed(message):
            self.lbl_verdict.config(text=message, fg=AMBER)

        _background(self, _work, on_done=_done, on_error=_failed)

    def _service_url(self) -> str:
        # URL explicite si elle est sûre : boucle locale, ou HTTPS pour un
        # service distant. Une URL HTTP distante enverrait la capture en clair.
        explicite = (os.environ.get("GF_SCREENSHOT_SCAN_SERVER_URL") or "").strip().rstrip("/")
        if explicite:
            if explicite.startswith("https://") or explicite.startswith(
                    ("http://127.0.0.1", "http://localhost", "http://[::1]")):
                return explicite
            return f"http://127.0.0.1:{int(os.environ.get('GF_SCREENSHOT_SCAN_PORT', '7070'))}"
        return f"http://127.0.0.1:{int(os.environ.get('GF_SCREENSHOT_SCAN_PORT', '7070'))}"

    def _health(self, silencieux: bool = False):
        def _work():
            try:
                with urllib.request.urlopen(self._service_url() + "/health", timeout=0.6) as r:
                    return True, _json.loads(r.read().decode("utf-8"))
            except Exception:                        # noqa: BLE001
                return False, None

        def _done(result):
            ok, payload = result
            if not _widget_alive(self.lbl_service):
                return
            if ok and payload:
                self.lbl_service.config(
                    text=f"Service local actif sur {self._service_url()} · OCR "
                         f"{'disponible' if payload.get('ocrAvailable') else 'indisponible'} · "
                         f"persistance {payload.get('persist')}", fg=GREEN)
            else:
                self.lbl_service.config(
                    text=f"Service local arrêté ({self._service_url()}). Le scan direct reste possible "
                         "dans cette fenêtre.", fg=MUTED)

        _background(self, _work, on_done=_done,
                    on_error=(lambda m: None) if silencieux else
                    (lambda m: self.lbl_service.config(text=m, fg=AMBER)))

    def _start_service(self):
        if self._service is not None and self._service.poll() is None:
            self.app.toast.show("Le service local est déjà démarré.", "info")
            return
        script = HERE / "secret_scan.py"
        if not script.exists():
            _error("Fichier absent", f"{script} est introuvable.", self)
            return
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self._service = subprocess.Popen(
                [sys.executable, str(script), "--serve",
                 "--port", str(int(os.environ.get("GF_SCREENSHOT_SCAN_PORT", "7070")))],
                cwd=str(HERE.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
        except OSError as exc:
            _error("Démarrage impossible", exc.__class__.__name__, self)
            return
        self.after(400, lambda: self._health(silencieux=False))

    def _stop_service(self):
        if self._service is None or self._service.poll() is not None:
            self.app.toast.show("Aucun service local démarré par le Keygen.", "info")
            return
        self._service.terminate()
        try:
            self._service.wait(timeout=3)
        except Exception:                            # noqa: BLE001
            self._service.kill()
        self._service = None
        self.app.toast.show("Service local arrêté.", "ok")
        self._health(silencieux=True)

    def _export(self):
        if not self._last:
            _info("Export", "Aucune analyse à exporter.", self)
            return
        chemin = filedialog.asksaveasfilename(parent=self, defaultextension=".json",
                                              filetypes=[("JSON", "*.json")],
                                              initialfile="rapport-secrets.json")
        if not chemin:
            return
        try:
            with open(chemin, "w", encoding="utf-8") as fh:
                _json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                            "report": self._last}, fh, indent=2, ensure_ascii=False)
        except OSError as exc:
            _error("Export impossible", exc.__class__.__name__, self)
            return
        db.audit_log("secret_scan_export", "", "rapport masqué")
        self.app.toast.show("Rapport exporté (valeurs masquées uniquement).", "ok")


class PageLogs(tk.Frame):
    """Journaux et diagnostic — aucun secret, aucun jeton de licence."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        self._build()
        self.refresh()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Journaux et diagnostics", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Journal d'audit local et état des composants. Aucun secret n'y figure.",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))
        bar = _frame(head, bg=BG)
        bar.pack(fill="x", pady=(10, 0))
        Button(bar, "↻ Actualiser", self.refresh, style="ghost").pack(side="left")
        Button(bar, "Exporter le diagnostic", self._export, style="ghost").pack(side="left", padx=(8, 0))
        Button(bar, "Effacer le journal", self._clear, style="danger").pack(side="left", padx=(8, 0))

        card = Card(_frame(self, bg=BG, padx=26), pady=12)
        card.pack(fill="both", expand=True, pady=(0, 22))
        self.txt = tk.Text(card, bg=SURFACE_2, fg=TEXT, font=(MONO[0], 9), relief="flat", bd=0,
                           highlightthickness=1, highlightbackground=BORDER, wrap="none",
                           padx=8, pady=6)
        self.txt.pack(fill="both", expand=True)

    def refresh(self, *_):
        if not _widget_alive(self.txt):
            return
        lignes = db.read_audit(400)
        contenu = "\n".join(lignes) if lignes else "Aucun événement enregistré."
        try:
            self.txt.config(state="normal")
            self.txt.delete("1.0", "end")
            self.txt.insert("1.0", contenu)
            self.txt.config(state="disabled")
        except tk.TclError:
            pass

    def _diagnostic(self) -> dict:
        cfg = db.load_server_config()
        empreinte_pub = ""
        try:
            import hashlib
            empreinte_pub = hashlib.sha256(core.PUB_FILE.read_bytes()).hexdigest()[:16]
        except OSError:
            pass
        scan_etat = {}
        try:
            import secret_scan
            scan_etat = {"patterns": len(secret_scan.load_patterns()),
                         "ocrAvailable": secret_scan.ocr_available()}
        except Exception as exc:                     # noqa: BLE001
            scan_etat = {"error": exc.__class__.__name__}
        return {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "keygen": {"licences_locales": len(db.list_licenses())},
            "cles": {
                "privee": str(core.PRIV_FILE), "privee_presente": core.PRIV_FILE.exists(),
                "publique": str(core.PUB_FILE), "publique_presente": core.PUB_FILE.exists(),
                "empreinte_publique": empreinte_pub,
            },
            "base": {"fichier": str(db.DB_FILE), "existe": db.DB_FILE.exists()},
            "serveur": {"url": cfg.get("url", ""), "cle_configuree": bool(cfg.get("api_key"))},
            "scan": scan_etat,
            "journal": db.read_audit(100),
        }

    def _export(self):
        chemin = filedialog.asksaveasfilename(parent=self, defaultextension=".json",
                                              filetypes=[("JSON", "*.json")],
                                              initialfile="diagnostic-garageflows.json")
        if not chemin:
            return
        try:
            with open(chemin, "w", encoding="utf-8") as fh:
                _json.dump(self._diagnostic(), fh, indent=2, ensure_ascii=False)
        except OSError as exc:
            _error("Export impossible", exc.__class__.__name__, self)
            return
        self.app.toast.show("Diagnostic exporté (sans secret).", "ok")

    def _clear(self):
        if not messagebox.askyesno("Effacer le journal",
                                   "Effacer TOUTES les lignes du journal d'audit local ?\n"
                                   "Cette action est irréversible.", parent=self):
            return
        try:
            db.AUDIT_FILE.write_text("", encoding="utf-8")
        except OSError as exc:
            _error("Effacement impossible", exc.__class__.__name__, self)
            return
        db.audit_log("journal_clear", "", "")
        self.refresh()
        self.app.toast.show("Journal effacé.", "ok")


class PageServer(tk.Frame):
    """Configuration de l'instance GarageFlows : URL, clé API, test de connexion."""

    def __init__(self, master, app):
        super().__init__(master, bg=BG)
        self.app = app
        cfg = db.load_server_config()
        self.v_url = tk.StringVar(value=cfg.get("url") or db.DEFAULT_SERVER_URL)
        self.v_key = tk.StringVar(value=cfg.get("api_key") or "")
        self._build()

    def _build(self):
        head = _frame(self, bg=BG, padx=26, pady=20)
        head.pack(fill="x")
        _lbl(head, "Paramètres et serveur", font=FONT_H1).pack(anchor="w")
        _lbl(head, "Adresse de l'instance et clé d'administration. Une seule source : "
                   "keys/server_config.json.", fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        scroll = ScrollFrame(self)
        scroll.pack(fill="both", expand=True)
        body = _frame(scroll.body, bg=BG, padx=26, pady=6)
        body.pack(fill="both", expand=True)

        card = Card(body)
        card.pack(fill="x", pady=(0, 14))
        _lbl(card, "Connexion", font=FONT_H3, bg=SURFACE).pack(anchor="w", pady=(0, 10))
        _lbl(card, "URL du serveur", fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w")
        Entry(card, textvariable=self.v_url).pack(fill="x", ipady=5, pady=(4, 10))
        _lbl(card, "Clé API (GARAGEFLOW_API_KEY du serveur)", fg=MUTED, font=FONT_XS,
             bg=SURFACE).pack(anchor="w")
        Entry(card, textvariable=self.v_key, show="•").pack(fill="x", ipady=5, pady=(4, 12))
        bar = _frame(card, bg=SURFACE)
        bar.pack(fill="x")
        Button(bar, "Enregistrer", self._save, style="primary").pack(side="left")
        Button(bar, "Tester la connexion", self._test, style="ghost").pack(side="left", padx=(10, 0))
        self.lbl_result = _lbl(card, "", fg=MUTED, font=FONT_SM, bg=SURFACE, justify="left", anchor="w")
        self.lbl_result.pack(fill="x", pady=(12, 0))

        info = Card(body)
        info.pack(fill="x", pady=(0, 22))
        _lbl(info, "Ce que le Keygen fait avec le serveur", font=FONT_H3, bg=SURFACE).pack(anchor="w")
        for line in (
                "· /api/admin/licenses/create — enregistre un jeton DÉJÀ SIGNÉ (le serveur vérifie la signature).",
                "· /api/keygen/licenses — lit l'état réel : statut, appareils, première activation, liaison matérielle.",
                "· /api/keygen/licenses/[lid]/status — applique un changement de statut (machine à états, journalisé).",
                "· /api/keygen/licenses/[lid]/hwid — libère les appareils (SAV, changement de poste).",
                "Aucune opération d'activation n'est faite par le Keygen : activer appartient au poste licencié."):
            _lbl(info, line, fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left", anchor="w").pack(
                anchor="w", pady=(4, 0))

    def _save(self):
        ok, err = server.validate_server_url(self.v_url.get())
        if not ok:
            self.lbl_result.config(text="⚠ " + err, fg=AMBER)
            return
        db.save_server_config(self.v_url.get(), self.v_key.get())
        self.lbl_result.config(text="✓ Configuration enregistrée dans keys/server_config.json.", fg=GREEN)
        self.app.toast.show("Configuration serveur enregistrée.", "ok")

    def _test(self):
        url = self.v_url.get().strip()
        key = self.v_key.get().strip()
        ok, err = server.validate_server_url(url)
        if not ok:
            self.lbl_result.config(text="⚠ " + err, fg=AMBER)
            return
        if not key:
            self.lbl_result.config(text="⚠ Clé API requise pour tester la connexion.", fg=AMBER)
            return
        self.lbl_result.config(text="⏳ Test en cours…", fg=MUTED)

        def _work():
            return server.test_connection(url, key)

        def _done(result):
            ok, message = result
            self.lbl_result.config(text=("✓ " if ok else "✗ ") + message, fg=GREEN if ok else RED)

        _background(self, _work, on_done=_done,
                    on_error=lambda m: self.lbl_result.config(text="✗ " + m, fg=RED))


# ── Coquille : barre latérale + pages ────────────────────────────────────────

class App(tk.Tk):
    PAGES = (
        ("dashboard", "▦  Tableau de bord",       PageDashboard),
        ("generate",  "⚡  Générer une licence",   PageGenerate),
        ("manage",    "📋  Gérer les licences",    PageManage),
        ("clients",   "👥  Clients",               PageClients),
        ("devices",   "🖥  Appareils et HWID",    PageDevices),
        ("keys",      "🔑  Clés ECC",              PageKeys),
        ("updates",   "🖋  Mises à jour",          PageUpdates),
        ("secrets",   "🛡  Détection des secrets", PageSecrets),
        ("logs",      "🧾  Journaux et diagnostics", PageLogs),
        ("server",    "⚙  Paramètres et serveur",  PageServer),
    )

    def __init__(self):
        super().__init__()
        self.title("GarageFlows — Gestionnaire de licences")
        self.geometry("1280x860")
        self.minsize(1024, 640)
        self.configure(bg=BG)
        self.passphrase = ""
        self.toast = Toast(self)
        self._pages = {}
        self._buttons = {}
        self._active = None
        self._build_style()
        self._build_shell()
        self._show("generate")
        self.after(300, self._startup_check)

    # ── Style ────────────────────────────────────────────────────────────────
    def _build_style(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure(".", background=BG, foreground=TEXT, fieldbackground=SURFACE_2)
        style.configure("Treeview", background=SURFACE, foreground=TEXT, fieldbackground=SURFACE,
                        borderwidth=0, rowheight=28, font=FONT_SM)
        style.configure("Treeview.Heading", background=SURFACE_2, foreground=MUTED,
                        font=("Segoe UI", 9, "bold"), relief="flat", borderwidth=0)
        style.map("Treeview", background=[("selected", ACCENT_D)], foreground=[("selected", "#ffffff")])
        style.configure("TScrollbar", background=SURFACE_2, troughcolor=SURFACE,
                        borderwidth=0, arrowcolor=MUTED)
        style.map("TScrollbar", background=[("active", ACCENT_D)])
        style.configure("TCombobox", fieldbackground=SURFACE_2, background=SURFACE_2,
                        foreground=TEXT, arrowcolor=MUTED, borderwidth=0, padding=4)
        style.configure("TSpinbox", fieldbackground=SURFACE_2, background=SURFACE_2,
                        foreground=TEXT, arrowcolor=MUTED, borderwidth=0, padding=4)
        style.configure("TRadiobutton", background=SURFACE, foreground=TEXT)
        style.configure("TSeparator", background=BORDER)

    # ── Structure ────────────────────────────────────────────────────────────
    def _build_shell(self):
        side = tk.Frame(self, bg=SURFACE, width=250)
        side.pack(side="left", fill="y")
        side.pack_propagate(False)

        brand = _frame(side, bg=SURFACE, padx=20, pady=22)
        brand.pack(fill="x")
        _lbl(brand, "GARAGEFLOWS", fg=TEXT, font=("Segoe UI", 15, "bold"), bg=SURFACE).pack(anchor="w")
        _lbl(brand, "Gestionnaire de licences", fg=MUTED, font=FONT_XS, bg=SURFACE).pack(anchor="w")

        _frame(side, bg=BORDER).pack(fill="x", padx=18)

        nav = _frame(side, bg=SURFACE, padx=12, pady=14)
        nav.pack(fill="both", expand=True)
        for key, label, _cls in self.PAGES:
            btn = tk.Button(nav, text=label, anchor="w", command=lambda k=key: self._show(k),
                            bg=SURFACE, fg=MUTED, font=FONT_B, relief="flat", bd=0, cursor="hand2",
                            padx=14, pady=11, activebackground=SURFACE_2, activeforeground=TEXT)
            btn.pack(fill="x", pady=3)
            self._buttons[key] = btn

        footer = _frame(side, bg=SURFACE, padx=20, pady=16)
        footer.pack(fill="x")
        _frame(side, bg=BORDER).pack(fill="x", padx=18)
        self.lbl_key_state = _lbl(footer, "", fg=MUTED, font=FONT_XS, bg=SURFACE, justify="left")
        self.lbl_key_state.pack(anchor="w")
        self.lbl_version = _lbl(footer, "Licences ECC P-256 · jetons GF2", fg=MUTED, font=FONT_XS,
                                bg=SURFACE)
        self.lbl_version.pack(anchor="w", pady=(4, 0))
        self._refresh_key_state()

        self.content = tk.Frame(self, bg=BG)
        self.content.pack(side="left", fill="both", expand=True)
        for key, _label, cls in self.PAGES:
            page = cls(self.content, self)
            self._pages[key] = page
        self.page_manage = self._pages["manage"]

    def _show(self, key: str):
        for name, page in self._pages.items():
            if name == key:
                page.pack(fill="both", expand=True)
            else:
                page.pack_forget()
        for name, btn in self._buttons.items():
            active = name == key
            btn.config(bg=SURFACE_2 if active else SURFACE,
                       fg=TEXT if active else MUTED,
                       relief="flat")
        self._active = key
        page = self._pages[key]
        if hasattr(page, "refresh"):
            page.refresh()
        if key == "updates":
            page._refresh_key_state()

    def _refresh_key_state(self):
        if not _widget_alive(self.lbl_key_state):
            return
        if core.keys_exist():
            self.lbl_key_state.config(text="● Autorité de signature présente", fg=GREEN)
        elif core.PRIV_FILE.exists() or core.PUB_FILE.exists():
            self.lbl_key_state.config(text="● Paire incomplète", fg=AMBER)
        else:
            self.lbl_key_state.config(text="● Aucune clé — restaurer l'autorité", fg=RED)

    # ── Configuration serveur partagée ───────────────────────────────────────
    def server_config(self) -> tuple[str, str]:
        cfg = db.load_server_config()
        url = self._pages["server"].v_url.get().strip() or cfg.get("url", "")
        key = self._pages["server"].v_key.get().strip() or cfg.get("api_key", "")
        return url, key

    # ── Contrôle au démarrage ────────────────────────────────────────────────
    def _startup_check(self):
        if not core.HAS_CRYPTO:
            _error("Dépendance manquante",
                   "Le module Python 'cryptography' est requis.\n\nInstallez-le avec :\n"
                   "    pip install cryptography\n\npuis relancez le programme.", self)
            return
        if not core.keys_exist():
            self.toast.show("Aucune clé ECC : restaurez l'autorité depuis sa sauvegarde.",
                            "error", 12000)
            return
        def _work():
            from keygen_trust import check_key_match
            try:
                return check_key_match(core.load_private_key(self.passphrase), core.ROOT_DIR)
            except Exception as exc:                     # noqa: BLE001
                return exc

        def _done(result):
            self._refresh_key_state()
            if isinstance(result, Exception):
                if is_issuer_mismatch(result):
                    self.toast.show(
                        "La clé privée n'est pas celle de production : la signature est bloquée.",
                        "error", 12000)
                # Autres cas (clé chiffrée sans passphrase) : signalés à l'usage,
                # avec leur message propre — rien n'est imposé au démarrage.

        _background(self, _work, on_done=_done)

    # ── Récapitulatif mécanicien ─────────────────────────────────────────────
    def show_recap(self, children, parent=None):
        win = tk.Toplevel(self)
        win.title("Clés mécanicien générées")
        win.configure(bg=BG)
        win.geometry("860x620")
        win.transient(self)
        head = _frame(win, bg=BG, padx=22, pady=18)
        head.pack(fill="x")
        _lbl(head, f"{len(children)} clé(s) mécanicien", font=FONT_H2).pack(anchor="w")
        _lbl(head, f"Garage parent : {(parent or {}).get('label') or (parent or {}).get('cid') or '—'}",
             fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))
        card = Card(_frame(win, bg=BG, padx=22), pady=14)
        card.pack(fill="both", expand=True, pady=(0, 12))
        text = tk.Text(card, bg=SURFACE_2, fg=TEXT, font=(MONO[0], 9), relief="flat", bd=0,
                       highlightthickness=1, highlightbackground=BORDER, wrap="none", padx=10, pady=8)
        sx = ttk.Scrollbar(card, orient="horizontal", command=text.xview)
        sy = ttk.Scrollbar(card, orient="vertical", command=text.yview)
        text.configure(xscrollcommand=sx.set, yscrollcommand=sy.set)
        text.grid(row=0, column=0, sticky="nsew")
        sy.grid(row=0, column=1, sticky="ns")
        sx.grid(row=1, column=0, sticky="ew")
        card.rowconfigure(0, weight=1)
        card.columnconfigure(0, weight=1)
        lines = []
        for c in children:
            lines.append(f"{c.get('mechanic_name') or c.get('label') or 'Mécanicien'}")
            lines.append(f"  jeton : {c['token']}")
            lines.append(f"  lid   : {c['lid']}")
            lines.append(f"  uuid  : {c.get('uuid', '')}")
            lines.append(f"  expire: {c['expires_at']}  ({c.get('duration_label', '')})")
            lines.append("")
        text.insert("1.0", "\n".join(lines))
        text.config(state="disabled")

        bar = _frame(win, bg=BG, padx=22, pady=12)
        bar.pack(fill="x")

        def _copy_all():
            self.clipboard_clear()
            self.clipboard_append("\n".join(c["token"] for c in children))
            self.toast.show("Tous les jetons ont été copiés.", "ok")

        def _export():
            path = filedialog.asksaveasfilename(parent=win, defaultextension=".json",
                                                filetypes=[("JSON", "*.json"), ("Texte", "*.txt")],
                                                initialfile="cles-mecanicien.json")
            if not path:
                return
            payload = [{"label": c.get("mechanic_name") or c.get("label"), "lid": c["lid"],
                        "uuid": c.get("uuid", ""), "token": c["token"],
                        "expires_at": c["expires_at"],
                        "parent_lid": (parent or {}).get("lid", "")} for c in children]
            try:
                if path.lower().endswith(".txt"):
                    with open(path, "w", encoding="utf-8") as fh:
                        fh.write("\n".join(f"{p['label']}\t{p['token']}" for p in payload))
                else:
                    with open(path, "w", encoding="utf-8") as fh:
                        _json.dump(payload, fh, indent=2, ensure_ascii=False)
            except Exception as exc:
                _error("Export impossible", str(exc), win)
                return
            db.audit_log("export_mechanic", (parent or {}).get("lid", ""), f"n={len(payload)}")
            self.toast.show("Clés exportées.", "ok")

        Button(bar, "⧉ Copier tous les jetons", _copy_all, style="primary").pack(side="left")
        Button(bar, "⤓ Exporter…", _export, style="ghost").pack(side="left", padx=(10, 0))

        url, key = self.server_config()
        if url and key:
            def _register():
                def _work():
                    ok_n, errors = 0, []
                    for c in children:
                        ok, msg = server.register_license(url, key, c["token"])
                        if ok:
                            ok_n += 1
                        elif msg not in errors:
                            errors.append(msg)
                    return ok_n, len(children) - ok_n, errors

                def _done(res):
                    ok_n, fails, errors = res
                    detail = (" — " + " · ".join(errors[:3])) if errors else ""
                    _info("Serveur GarageFlows",
                          f"Enregistrées : {ok_n} · Échecs : {fails}{detail}", win, self)

                _background(self, _work, on_done=_done,
                            on_error=lambda m: _error("Serveur GarageFlows", m, win, self))

            Button(bar, "⇡ Enregistrer sur le serveur", _register, style="success").pack(side="left", padx=(10, 0))


def main():
    try:
        App().mainloop()
    except tk.TclError as exc:
        print(f"Impossible de démarrer l'interface graphique (Tkinter indisponible ou pas "
              f"d'affichage) : {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
