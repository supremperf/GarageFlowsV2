"""
keygen_ui.py — GarageFlow Licence Manager — Interface graphique (tkinter)
Fenêtre principale : onglets Générer / Gérer / Clés.
"""

import sys
import os
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog, filedialog
import threading
import socket
import urllib.request
import urllib.error
import json as _json

import keygen_core as core
import keygen_db   as db

# Types de licence "garage" (le type mechanic se génère via les modes dédiés)
GARAGE_TYPES = [t for t in core.LICENSE_TYPES if t != "mechanic"]


def _max_mechanic() -> int:
    """Limite de clés mécanicien par génération (env GF_KEYGEN_MAX_MECHANIC, défaut 20)."""
    try:
        val = int(os.environ.get("GF_KEYGEN_MAX_MECHANIC", ""))
        return val if val >= 1 else 20
    except (TypeError, ValueError):
        return 20

# ── Palette sombre ────────────────────────────────────────────────────────────
BG      = "#070d1b"
CARD    = "#111827"
CARD2   = "#1a2235"
BORDER  = "#1e2d45"
TEXT    = "#f1f5f9"
MUTED   = "#64748b"
BLUE    = "#3b82f6"
RED     = "#ef4444"
GREEN   = "#10b981"
AMBER   = "#f59e0b"
MONO    = ("Cascadia Code", "Consolas", "monospace")
FONT    = ("Segoe UI", 10)
FONTB   = ("Segoe UI", 10, "bold")
FONTS   = ("Segoe UI", 9)

STATUS_COLOR = {
    "active":    GREEN,
    "revoked":   RED,
    "suspended": AMBER,
}
STATUS_LABEL = {
    "active":    "Active",
    "revoked":   "Révoquée",
    "suspended": "Suspendue",
}


# ── Widgets utilitaires ───────────────────────────────────────────────────────

def _lbl(parent, text, fg=TEXT, font=FONT, **kw):
    return tk.Label(parent, text=text, fg=fg, bg=parent.cget("bg"), font=font, **kw)

def _entry(parent, textvariable=None, width=30, show=None, font=FONT):
    e = tk.Entry(parent, textvariable=textvariable, width=width,
                 bg=CARD2, fg=TEXT, insertbackground=TEXT,
                 relief="flat", bd=0, font=font,
                 highlightthickness=1, highlightbackground=BORDER,
                 highlightcolor=BLUE, show=show or "")
    return e

def _btn(parent, text, command, bg=BLUE, fg=TEXT, font=FONTB, width=None, padx=12, pady=6, **kw):
    b = tk.Button(parent, text=text, command=command,
                  bg=bg, fg=fg, font=font,
                  relief="flat", bd=0, cursor="hand2",
                  activebackground=bg, activeforeground=fg,
                  padx=padx, pady=pady, **kw)
    if width:
        b.config(width=width)
    return b

def _sep(parent, orient="horizontal"):
    return ttk.Separator(parent, orient=orient)


def _frame(parent, bg=None, padx=0, pady=0):
    return tk.Frame(parent, bg=bg or parent.cget("bg"), padx=padx, pady=pady)


# ── Remote API helper ────────────────────────────────────────────────────────

def _validate_server_url(url: str) -> tuple[bool, str]:
    """Valide l'URL serveur. https:// requis en prod ; http:// toléré (LAN/local)."""
    u = (url or "").strip()
    if not u:
        return False, "URL du serveur vide — saisissez une adresse (https://…)."
    if not (u.startswith("http://") or u.startswith("https://")):
        return False, "URL invalide — elle doit commencer par http:// ou https://."
    # Doit contenir un hôte après le schéma.
    rest = u.split("://", 1)[1].strip()
    if not rest or rest.startswith("/"):
        return False, "URL invalide — hôte du serveur manquant."
    return True, ""


def _remote_set_status(server_url: str, api_key: str, license_id: str, status: str) -> tuple[bool, str]:
    """Call GarageFlow admin API to update license status. Returns (ok, message)."""
    if not server_url or not api_key:
        return False, "Serveur ou clé API non configuré."
    # Validation d'URL : http:// autorisé pour LAN/local, https:// requis en prod.
    ok_url, err_url = _validate_server_url(server_url)
    if not ok_url:
        return False, err_url
    url = server_url.rstrip("/") + "/api/admin/licenses/revoke-by-key"
    payload = _json.dumps({"licenseId": license_id, "status": status}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type":  "application/json",
            "x-gf-key":      api_key,
            "User-Agent":    "GarageFlow-KeygenGUI/2",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
            if data.get("ok"):
                return True, f"Statut mis à jour sur le serveur : {status}"
            return False, data.get("error", "Réponse inattendue")
    except urllib.error.HTTPError as e:
        # Discrimination des erreurs HTTP en messages opérateur clairs.
        code = e.code
        if code in (401, 403):
            return False, "Clé API invalide (GARAGEFLOW_API_KEY) — vérifiez la clé du serveur."
        if code == 429:
            retry = None
            try:
                retry = e.headers.get("Retry-After")
            except Exception:
                retry = None
            if retry:
                return False, f"Trop de requêtes (rate limit) — réessayez dans {retry} s."
            return False, "Trop de requêtes (rate limit) — réessayez dans quelques instants."
        if code in (500, 502, 503, 504):
            return False, f"Serveur indisponible (HTTP {code}) — réessayez plus tard."
        # Autres codes : on conserve le comportement existant (body.error ou HTTP {code}).
        try:
            body = _json.loads(e.read().decode("utf-8"))
            return False, body.get("error", f"HTTP {code}")
        except Exception:
            return False, f"Erreur HTTP {code}"
    except socket.timeout:
        return False, "Délai dépassé — le serveur ne répond pas."
    except urllib.error.URLError as exc:
        # Timeout signalé via URLError, connexion refusée, DNS injoignable, etc.
        if isinstance(exc.reason, socket.timeout):
            return False, "Délai dépassé — le serveur ne répond pas."
        return False, "Connexion impossible — vérifiez l'URL du serveur et le réseau."
    except Exception:
        return False, "Connexion impossible — vérifiez l'URL du serveur et le réseau."


def _remote_register(server_url: str, api_key: str, token: str) -> tuple[bool, str]:
    """Enregistre une licence sur le serveur GarageFlow (POST /api/admin/licenses/create).
    Retourne (ok, message). N'expose jamais le token dans le message."""
    if not server_url or not api_key:
        return False, "Serveur ou clé API non configuré."
    url = server_url.rstrip("/") + "/api/admin/licenses/create"
    payload = _json.dumps({"token": token}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "x-gf-key":     api_key,
            "User-Agent":   "GarageFlow-KeygenGUI/2",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            _json.loads(resp.read().decode("utf-8"))
            return True, "Licence enregistrée sur le serveur."
    except urllib.error.HTTPError as e:
        if e.code == 409:
            return True, "Licence déjà enregistrée sur le serveur."
        try:
            body = _json.loads(e.read().decode("utf-8"))
            return False, body.get("error", f"HTTP {e.code}")
        except Exception:
            return False, f"Erreur HTTP {e.code}"
    except Exception as exc:
        return False, f"Connexion impossible : {exc}"


# ── Onglet 1 — Générer ────────────────────────────────────────────────────────

class TabGenerate(tk.Frame):
    def __init__(self, master, on_generated=None, get_server_cfg=None):
        super().__init__(master, bg=BG)
        self.on_generated = on_generated
        self._get_server_cfg = get_server_cfg or (lambda: ("", ""))
        self._passphrase  = ""
        self._busy        = False   # anti double-clic / double-génération
        self._build()

    def _build(self):
        # ─ Titre ─
        _lbl(self, "  Nouvelle licence ECC P-256", font=("Segoe UI", 13, "bold")).pack(
            anchor="w", padx=20, pady=(18, 4))
        _lbl(self, "  Remplissez les informations client puis configurez la licence.",
             fg=MUTED, font=FONTS).pack(anchor="w", padx=20, pady=(0, 10))

        # ─ Sélecteur de mode de génération ─
        self.v_mode = tk.StringVar(value="garage")
        mode_row = _frame(self, bg=CARD, padx=14, pady=8)
        mode_row.pack(fill="x", padx=20, pady=(0, 10))
        _lbl(mode_row, "Type de génération", fg=MUTED, font=FONTS).pack(anchor="w")
        for val, text in [
            ("garage",       "Licence Garage seule"),
            ("garage_meca",  "Garage + clés mécanicien"),
            ("meca_only",    "Clés mécanicien pour un garage existant"),
        ]:
            tk.Radiobutton(
                mode_row, text=text, value=val, variable=self.v_mode,
                command=self._on_mode_change, bg=CARD, fg=TEXT,
                selectcolor=CARD2, activebackground=CARD, activeforeground=TEXT,
                font=FONTS, anchor="w", highlightthickness=0, bd=0,
            ).pack(anchor="w")

        # ─ Conteneur 2 colonnes ─
        body = _frame(self, bg=BG)
        body.pack(fill="both", expand=True, padx=20)

        left  = _frame(body, bg=BG)
        right = _frame(body, bg=BG)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        right.grid(row=0, column=1, sticky="nsew")
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)

        # ─── BLOC CLIENT ────────────────────────────────────────────────────
        self._card_title(left, "👤  Informations client")

        self.v_prenom     = tk.StringVar()
        self.v_nom        = tk.StringVar()
        self.v_entreprise = tk.StringVar()
        self.v_email      = tk.StringVar()
        self.v_tel        = tk.StringVar()
        self.v_adresse    = tk.StringVar()
        self.v_ville      = tk.StringVar()

        fields_client = [
            ("Prénom",     self.v_prenom),
            ("Nom",        self.v_nom),
            ("Entreprise", self.v_entreprise),
            ("Email",      self.v_email),
            ("Téléphone",  self.v_tel),
            ("Adresse",    self.v_adresse),
            ("Ville / CP", self.v_ville),
        ]
        for lbl_text, var in fields_client:
            self._field_row(left, lbl_text, var)

        # ─── BLOC LICENCE ────────────────────────────────────────────────────
        self._card_title(right, "🔐  Configuration licence")

        self.v_type    = tk.StringVar(value="premium")
        self.v_years   = tk.StringVar(value="1")
        self.v_seats   = tk.StringVar(value="1")
        self.v_label   = tk.StringVar()
        self.v_hwid    = tk.StringVar()
        self.v_cid     = tk.StringVar()

        # Type
        row_type = _frame(right, bg=BG)
        row_type.pack(fill="x", pady=(0, 6))
        _lbl(row_type, "Type de licence", fg=MUTED, font=FONTS).pack(anchor="w")
        # Le type mechanic ne se choisit PAS ici : il est produit par les modes
        # « Garage + clés mécanicien » / « Clés mécanicien pour un garage existant ».
        type_cb = ttk.Combobox(row_type, textvariable=self.v_type, state="readonly",
                               values=[f"{v}  —  {core.TYPE_LABELS[v]}" for v in GARAGE_TYPES],
                               font=FONT, width=28)
        type_cb.pack(fill="x", ipady=4)
        type_cb.bind("<<ComboboxSelected>>", self._on_type_selected)
        self._type_cb = type_cb

        # Durée + Postes (côte à côte)
        row_dp = _frame(right, bg=BG)
        row_dp.pack(fill="x", pady=(0, 6))
        fr_d = _frame(row_dp, bg=BG)
        fr_s = _frame(row_dp, bg=BG)
        fr_d.pack(side="left", fill="x", expand=True, padx=(0, 6))
        fr_s.pack(side="left", fill="x", expand=True)
        _lbl(fr_d, "Durée (ans)", fg=MUTED, font=FONTS).pack(anchor="w")
        ttk.Spinbox(fr_d, from_=1, to=10, textvariable=self.v_years,
                    width=5, font=FONT).pack(fill="x", ipady=4)
        _lbl(fr_s, "Postes max", fg=MUTED, font=FONTS).pack(anchor="w")
        ttk.Spinbox(fr_s, from_=1, to=100, textvariable=self.v_seats,
                    width=5, font=FONT).pack(fill="x", ipady=4)

        # Étiquette
        self._field_row(right, "Étiquette (affiché dans l'app)", self.v_label)

        # ID Client (auto)
        self._field_row(right, "ID Client (auto ou manuel)", self.v_cid,
                        placeholder="ex: CUST-042  — laisser vide = auto")

        # HWID
        row_hwid = _frame(right, bg=BG)
        row_hwid.pack(fill="x", pady=(0, 6))
        _lbl(row_hwid, "HWID (optionnel — lie au matériel)", fg=MUTED, font=FONTS).pack(anchor="w")
        fr_hwid = _frame(row_hwid, bg=BG)
        fr_hwid.pack(fill="x")
        _entry(fr_hwid, textvariable=self.v_hwid,
               font=(MONO[0], 9)).pack(side="left", fill="x", expand=True, ipady=4)
        _btn(fr_hwid, "Ce PC", self._fill_hwid, bg=CARD2, fg=MUTED,
             font=FONTS, padx=8, pady=4).pack(side="left", padx=(4, 0))

        # ─── BLOC MÉCANICIEN (visible seulement en mode garage_meca / meca_only) ──
        self.meca_frame = _frame(right, bg=BG)
        # (packé/oublié dynamiquement par _on_mode_change)
        self._card_title(self.meca_frame, "🔧  Clés mécanicien")

        # Garage existant (mode meca_only) : sélecteur de licence parente
        self.v_parent = tk.StringVar()
        self._parent_map = {}   # libellé affiché -> lid
        parent_row = _frame(self.meca_frame, bg=BG)
        parent_row.pack(fill="x", pady=(0, 6))
        _lbl(parent_row, "Licence garage parente", fg=MUTED, font=FONTS).pack(anchor="w")
        self.parent_cb = ttk.Combobox(parent_row, textvariable=self.v_parent,
                                      state="readonly", font=FONTS, width=34)
        self.parent_cb.pack(fill="x", ipady=4)
        self._parent_row = parent_row

        # Nombre de clés
        cnt_row = _frame(self.meca_frame, bg=BG)
        cnt_row.pack(fill="x", pady=(0, 6))
        self._cnt_row = cnt_row
        _lbl(cnt_row, f"Nombre de clés mécanicien (1..{_max_mechanic()})",
             fg=MUTED, font=FONTS).pack(anchor="w")
        self.v_count = tk.StringVar(value="1")
        ttk.Spinbox(cnt_row, from_=1, to=_max_mechanic(), textvariable=self.v_count,
                    width=6, font=FONT).pack(fill="x", ipady=4)

        # Noms (un par ligne, optionnel)
        names_row = _frame(self.meca_frame, bg=BG)
        names_row.pack(fill="x", pady=(0, 6))
        _lbl(names_row, "Noms des mécaniciens (un par ligne, optionnel)",
             fg=MUTED, font=FONTS).pack(anchor="w")
        self.txt_names = tk.Text(names_row, height=4, bg=CARD2, fg=TEXT,
                                 insertbackground=TEXT, relief="flat", bd=0,
                                 font=FONT, highlightthickness=1,
                                 highlightbackground=BORDER)
        self.txt_names.pack(fill="x", ipady=2)

        # ─ Bouton Générer ─
        btn_row = _frame(self, bg=BG)
        btn_row.pack(pady=14, padx=20, fill="x")
        self.btn_generate = _btn(btn_row, "  ⚡  Générer et signer la licence  ",
                                 self._generate, width=40)
        self.btn_generate.pack(side="left")

        self._on_mode_change()   # état initial cohérent

        # ─ Zone résultat ─
        res_frame = _frame(self, bg=CARD, padx=14, pady=10)
        res_frame.pack(fill="x", padx=20, pady=(0, 14))
        _lbl(res_frame, "Token généré", fg=MUTED, font=FONTS).pack(anchor="w")

        self.token_var = tk.StringVar(value="— en attente de génération —")
        token_entry = tk.Entry(
            res_frame, textvariable=self.token_var,
            state="readonly", readonlybackground=CARD2,
            fg=MUTED, font=(MONO[0], 8),
            relief="flat", bd=0,
            highlightthickness=1, highlightbackground=BORDER,
        )
        token_entry.pack(fill="x", ipady=5, pady=(4, 6))

        _btn(res_frame, "📋  Copier le token", self._copy_token,
             bg=CARD2, fg=TEXT, font=FONTS, padx=10, pady=4).pack(anchor="w")

    def _card_title(self, parent, text):
        _lbl(parent, text, font=("Segoe UI", 10, "bold")).pack(
            anchor="w", pady=(0, 8))
        _frame(parent, bg=BORDER).pack(fill="x", pady=(0, 8), ipady=0)

    def _field_row(self, parent, label, var, placeholder=""):
        row = _frame(parent, bg=BG)
        row.pack(fill="x", pady=(0, 6))
        _lbl(row, label, fg=MUTED, font=FONTS).pack(anchor="w")
        e = _entry(row, textvariable=var)
        e.pack(fill="x", ipady=4)
        if placeholder and not var.get():
            e.insert(0, placeholder)
            e.config(fg=MUTED)
            def on_focus_in(event, entry=e, ph=placeholder, v=var):
                if entry.get() == ph:
                    entry.delete(0, "end")
                    entry.config(fg=TEXT)
            def on_focus_out(event, entry=e, ph=placeholder, v=var):
                if not entry.get():
                    entry.insert(0, ph)
                    entry.config(fg=MUTED)
            e.bind("<FocusIn>",  on_focus_in)
            e.bind("<FocusOut>", on_focus_out)

    def _on_type_selected(self, _event):
        val = self.v_type.get()
        self.v_type.set(val.split("  —")[0].strip())

    def _fill_hwid(self):
        self.v_hwid.set(core.get_hwid())

    def set_passphrase(self, pp: str):
        self._passphrase = pp

    def _on_mode_change(self):
        """Affiche/masque le bloc mécanicien et rafraîchit la liste des garages."""
        mode = self.v_mode.get()
        if mode == "garage":
            self.meca_frame.pack_forget()
        else:
            self.meca_frame.pack(fill="x", pady=(4, 0))
            # Le sélecteur de parent n'est utile qu'en mode « garage existant ».
            if mode == "meca_only":
                self._refresh_parents()
                self._parent_row.pack(fill="x", pady=(0, 6), before=self._cnt_row)
            else:
                self._parent_row.pack_forget()

    def _refresh_parents(self):
        garages = db.garage_licenses()
        self._parent_map = {}
        values = []
        for g in garages:
            lbl = g.get("label") or g.get("cid") or g["lid"]
            display = f"{lbl}  ·  {g['lid'][:8]}…"
            self._parent_map[display] = g["lid"]
            values.append(display)
        self.parent_cb.config(values=values)
        if values and not self.v_parent.get():
            self.v_parent.set(values[0])

    def _names_list(self):
        raw = self.txt_names.get("1.0", "end").strip()
        return [n.strip() for n in raw.splitlines() if n.strip()]

    def _set_busy(self, busy: bool):
        self._busy = busy
        try:
            self.btn_generate.config(state="disabled" if busy else "normal")
        except Exception:
            pass

    def _generate(self):
        if self._busy:
            return   # anti double-clic / double-génération
        if not core.keys_exist():
            messagebox.showerror(
                "Clés manquantes",
                "Aucune clé ECC trouvée.\n\n"
                "Allez dans l'onglet  🔑 Clés  et initialisez la paire de clés."
            )
            return

        mode = self.v_mode.get()
        if mode in ("garage", "garage_meca"):
            self._generate_garage(mode)
        elif mode == "meca_only":
            self._generate_mechanics_existing()

    # ── Validation commune du nombre de clés mécanicien ────────────────────────
    def _validated_count(self):
        raw = self.v_count.get().strip()
        try:
            count = int(raw)
        except (TypeError, ValueError):
            messagebox.showerror("Nombre invalide",
                                 "Le nombre de clés mécanicien doit être un entier.")
            return None
        if count < 1:
            messagebox.showerror("Nombre invalide",
                                 "Le nombre de clés mécanicien doit être au moins 1.")
            return None
        maxc = _max_mechanic()
        if count > maxc:
            messagebox.showerror("Nombre trop élevé",
                                 f"Le nombre de clés mécanicien ne peut pas dépasser {maxc}.")
            return None
        names = self._names_list()
        if len(names) > count:
            messagebox.showerror("Trop de noms",
                                 f"{len(names)} noms fournis pour {count} clés.")
            return None
        return count, names

    def _build_client_and_cid(self):
        prenom = self.v_prenom.get().strip()
        nom    = self.v_nom.get().strip()
        entr   = self.v_entreprise.get().strip()
        cid    = self.v_cid.get().strip()
        if not cid:
            if entr:
                slug = entr.upper().replace(" ", "-")[:20]
            elif nom:
                slug = f"{nom.upper()}-{prenom[:1].upper()}"[:20]
            else:
                slug = "CLIENT"
            import time as _t
            cid = f"{slug}-{_t.strftime('%y%m%d')}"
        label = self.v_label.get().strip() or entr or f"{prenom} {nom}".strip() or cid
        client = {
            "prenom": prenom, "nom": nom, "entreprise": entr,
            "email": self.v_email.get().strip(), "tel": self.v_tel.get().strip(),
            "adresse": self.v_adresse.get().strip(), "ville": self.v_ville.get().strip(),
        }
        return cid, label, client

    def _generate_garage(self, mode):
        """Génère la licence garage, puis (mode garage_meca) N clés mécanicien."""
        raw_type = self.v_type.get().split("  —")[0].strip()
        years  = int(self.v_years.get() or 1)
        seats  = int(self.v_seats.get() or 1)
        hwid   = self.v_hwid.get().strip() or None
        cid, label, client = self._build_client_and_cid()

        meca = None
        if mode == "garage_meca":
            meca = self._validated_count()
            if meca is None:
                return
        count, names = (meca or (0, []))

        self._set_busy(True)

        def _do():
            try:
                pk   = core.load_private_key(self._passphrase)
                info = core.make_license(pk, cid, raw_type, years, seats, hwid, label)
                db.add_license(info, client)
                db.audit_log("gen_garage", info["lid"], f"type={raw_type}")

                children = []
                for i in range(count):
                    name  = names[i] if i < len(names) else None
                    mlabel = name or f"Mécanicien {i+1}"
                    minfo = core.make_mechanic_license(
                        pk, info["lid"], cid, years=years,
                        mechanic_name=name, label=mlabel,
                    )
                    db.add_license(minfo, {})
                    db.audit_log("gen_mechanic", minfo["lid"],
                                 f"parent={info['lid'][:8]}…")
                    children.append(minfo)

                self.after(0, lambda: self._on_garage_success(info, children))
            except Exception as exc:
                self.after(0, lambda: (self._set_busy(False),
                                       messagebox.showerror("Erreur de signature", str(exc))))

        threading.Thread(target=_do, daemon=True).start()

    def _generate_mechanics_existing(self):
        """Génère N clés mécanicien pour une licence garage déjà en base."""
        display = self.v_parent.get()
        parent_lid = self._parent_map.get(display)
        if not parent_lid:
            messagebox.showerror("Garage manquant",
                                 "Sélectionnez la licence garage parente.")
            return
        parent = db.get_license(parent_lid)
        if parent is None:
            messagebox.showerror("Garage introuvable",
                                 "Cette licence garage est introuvable dans la base locale.")
            return
        if parent.get("type") == "mechanic":
            messagebox.showerror("Parent invalide",
                                 "La licence parente doit être une licence garage.")
            return
        meca = self._validated_count()
        if meca is None:
            return
        count, names = meca
        years = int(self.v_years.get() or 1)
        cid = parent.get("cid", "")

        self._set_busy(True)

        def _do():
            try:
                pk = core.load_private_key(self._passphrase)
                children = []
                for i in range(count):
                    name  = names[i] if i < len(names) else None
                    mlabel = name or f"Mécanicien {i+1}"
                    minfo = core.make_mechanic_license(
                        pk, parent_lid, cid, years=years,
                        mechanic_name=name, label=mlabel,
                    )
                    db.add_license(minfo, {})
                    db.audit_log("gen_mechanic", minfo["lid"],
                                 f"parent={parent_lid[:8]}…")
                    children.append(minfo)
                self.after(0, lambda: self._on_mechanics_success(parent, children))
            except Exception as exc:
                self.after(0, lambda: (self._set_busy(False),
                                       messagebox.showerror("Erreur de signature", str(exc))))

        threading.Thread(target=_do, daemon=True).start()

    def _on_garage_success(self, info, children):
        self._set_busy(False)
        self.token_var.set(info["token"])
        if self.on_generated:
            self.on_generated(info)
        if children:
            self._show_recap(info, children)
        else:
            messagebox.showinfo(
                "Licence générée ✓",
                f"Client  : {info['label']}\n"
                f"Type    : {core.TYPE_LABELS.get(info['type'], info['type'])}\n"
                f"Expiry  : {info['expires_at']}\n\n"
                "Le token a été copié dans le champ résultat.\n"
                "Retrouvez-la dans l'onglet Gérer les licences.",
            )

    def _on_mechanics_success(self, parent, children):
        self._set_busy(False)
        if self.on_generated:
            self.on_generated(children[0] if children else parent)
        self._show_recap(parent, children)

    def _show_recap(self, parent, children):
        """Fenêtre récapitulative des clés mécanicien créées (copie/export)."""
        win = tk.Toplevel(self)
        win.title("Clés mécanicien générées")
        win.configure(bg=BG)
        win.geometry("720x460")
        _lbl(win, f"  {len(children)} clé(s) mécanicien créée(s)",
             font=("Segoe UI", 12, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        _lbl(win, f"  Garage parent : {parent.get('label') or parent.get('cid') or parent['lid']}",
             fg=MUTED, font=FONTS).pack(anchor="w", padx=16, pady=(0, 8))

        txt = tk.Text(win, bg=CARD2, fg=TEXT, font=(MONO[0], 8), relief="flat",
                      bd=0, highlightthickness=1, highlightbackground=BORDER, wrap="none")
        txt.pack(fill="both", expand=True, padx=16, pady=(0, 8))
        lines = []
        for c in children:
            lines.append(f"{c.get('mechanic_name') or c['label']}")
            lines.append(f"  {c['token']}")
            lines.append(f"  lid={c['lid']}  expire={c['expires_at']}")
            lines.append("")
        txt.insert("end", "\n".join(lines))
        txt.config(state="disabled")

        payload = [{
            "label":      c.get("mechanic_name") or c.get("label"),
            "lid":        c["lid"],
            "token":      c["token"],
            "expires_at": c["expires_at"],
            "parent_lid": parent["lid"],
        } for c in children]

        bar = _frame(win, bg=BG)
        bar.pack(fill="x", padx=16, pady=(0, 14))

        def _copy_all():
            self.clipboard_clear()
            self.clipboard_append("\n".join(c["token"] for c in children))
            messagebox.showinfo("Copié", "Tous les tokens ont été copiés.", parent=win)

        def _export():
            path = filedialog.asksaveasfilename(
                parent=win, defaultextension=".json",
                filetypes=[("JSON", "*.json"), ("Texte", "*.txt")],
                initialfile=f"cles-mecanicien-{parent['lid'][:8]}.json",
            )
            if not path:
                return
            try:
                if path.lower().endswith(".txt"):
                    with open(path, "w", encoding="utf-8") as f:
                        f.write("\n".join(
                            f"{p['label']}\t{p['token']}" for p in payload))
                else:
                    with open(path, "w", encoding="utf-8") as f:
                        _json.dump(payload, f, indent=2, ensure_ascii=False)
                db.audit_log("export_mechanic", parent["lid"], f"n={len(payload)}")
                messagebox.showinfo("Exporté", f"Clés exportées vers :\n{path}", parent=win)
            except Exception as exc:
                messagebox.showerror("Erreur d'export", str(exc), parent=win)

        _btn(bar, "📋  Copier tout", _copy_all, bg=CARD2, fg=TEXT,
             font=FONTS, padx=10, pady=4).pack(side="left")
        _btn(bar, "💾  Exporter…", _export, bg=CARD2, fg=TEXT,
             font=FONTS, padx=10, pady=4).pack(side="left", padx=(8, 0))

        # Enregistrement serveur optionnel (best-effort, jamais bloquant).
        url, key = self._get_server_cfg()
        if url and key:
            def _register_all():
                def _do():
                    ok_n, fail_n = 0, 0
                    for c in children:
                        ok, _ = _remote_register(url, key, c["token"])
                        if ok:
                            ok_n += 1
                        else:
                            fail_n += 1
                    self.after(0, lambda: messagebox.showinfo(
                        "Serveur GarageFlow",
                        f"Enregistrées : {ok_n} · Échecs : {fail_n}", parent=win))
                threading.Thread(target=_do, daemon=True).start()
            if messagebox.askyesno(
                "Serveur GarageFlow",
                "Enregistrer ces clés mécanicien sur le serveur maintenant ?",
                parent=win,
            ):
                _register_all()

    def _copy_token(self):
        t = self.token_var.get()
        if t and t != "— en attente de génération —":
            self.clipboard_clear()
            self.clipboard_append(t)
            messagebox.showinfo("Copié", "Token copié dans le presse-papiers.")


# ── Onglet 2 — Gérer les licences ────────────────────────────────────────────

class TabManage(tk.Frame):
    def __init__(self, master, get_server_cfg=None):
        super().__init__(master, bg=BG)
        self._get_server_cfg = get_server_cfg or (lambda: ("", ""))
        self._build()

    def _build(self):
        # Barre outils
        bar = _frame(self, bg=CARD, padx=12, pady=8)
        bar.pack(fill="x")

        _lbl(bar, "Gérer les licences", font=("Segoe UI", 11, "bold")).pack(
            side="left")

        _btn(bar, "↻ Actualiser", self.refresh, bg=CARD2, fg=MUTED,
             font=FONTS, padx=10, pady=4).pack(side="right", padx=(4, 0))

        self.v_search = tk.StringVar()
        self.v_search.trace_add("write", lambda *_: self.refresh())
        e_search = _entry(bar, textvariable=self.v_search, width=18, font=FONTS)
        e_search.pack(side="right", ipady=4, padx=(4, 8))
        _lbl(bar, "🔍", fg=MUTED, font=FONTS).pack(side="right")

        # Filtre par type (Tous / Garages / Mécaniciens)
        self.v_filter = tk.StringVar(value="Tous")
        filt = ttk.Combobox(bar, textvariable=self.v_filter, state="readonly",
                            values=["Tous", "Garages", "Mécaniciens"],
                            font=FONTS, width=12)
        filt.pack(side="right", padx=(4, 8), ipady=2)
        filt.bind("<<ComboboxSelected>>", lambda *_: self.refresh())

        # Filtre « enfants d'un parent » (activé par le bouton dédié) — lid parent.
        self._child_filter = None

        # Treeview
        cols = ("client", "type", "parent", "statut", "expiry", "cid", "lid")
        self.tree = ttk.Treeview(
            self, columns=cols, show="headings",
            selectmode="browse", height=16,
        )
        heads = [
            ("client",  "Client / Entreprise", 170),
            ("type",    "Type",                 90),
            ("parent",  "Parent",               80),
            ("statut",  "Statut",               80),
            ("expiry",  "Expiry",               90),
            ("cid",     "ID Client",           120),
            ("lid",     "LID (UUID)",           150),
        ]
        for col, text, w in heads:
            self.tree.heading(col, text=text)
            self.tree.column(col, width=w, anchor="w")

        scroll = ttk.Scrollbar(self, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side="left", fill="both", expand=True, padx=(12, 0), pady=8)
        scroll.pack(side="left", fill="y", pady=8)

        # Panneau actions
        pnl = _frame(self, bg=CARD, padx=12, pady=10)
        pnl.pack(side="right", fill="y", padx=12, pady=8)

        _lbl(pnl, "Actions", font=FONTB).pack(pady=(0, 8))

        _btn(pnl, "✅  Réactiver",  self._reactivate, bg="#064e3b",
             fg=GREEN,  font=FONTS, width=16).pack(pady=3)
        _btn(pnl, "⛔  Révoquer",   self._revoke,    bg="#450a0a",
             fg=RED,    font=FONTS, width=16).pack(pady=3)
        _btn(pnl, "⏸  Suspendre",  self._suspend,   bg="#451a03",
             fg=AMBER,  font=FONTS, width=16).pack(pady=3)
        _frame(pnl, bg=BORDER).pack(fill="x", pady=8, ipady=0)
        _btn(pnl, "📋  Copier token", self._copy,    bg=CARD2,
             fg=TEXT,   font=FONTS, width=16).pack(pady=3)
        _btn(pnl, "🔧  Voir ses clés méca.", self._show_children, bg=CARD2,
             fg=TEXT,   font=FONTS, width=16).pack(pady=3)
        _btn(pnl, "🗑  Supprimer",   self._delete,   bg=CARD2,
             fg=MUTED,  font=FONTS, width=16).pack(pady=3)

        # Détail
        self.detail_var = tk.StringVar(value="Sélectionnez une ligne pour voir le token complet.")
        detail = tk.Entry(self, textvariable=self.detail_var, state="readonly",
                          readonlybackground=CARD2, fg=MUTED,
                          font=(MONO[0], 8), relief="flat", bd=0,
                          highlightthickness=1, highlightbackground=BORDER)
        detail.pack(fill="x", padx=12, pady=(0, 8), ipady=4)

        self.tree.bind("<<TreeviewSelect>>", self._on_select)
        self.refresh()

    def refresh(self, *_):
        q = self.v_search.get().strip()
        records = db.search(q) if q else db.list_licenses()

        # Filtre par type (combobox) ou par parent (bouton « Voir ses clés »).
        ftype = self.v_filter.get()
        if self._child_filter:
            records = [r for r in records
                       if r.get("type") == "mechanic"
                       and r.get("parent_lid") == self._child_filter]
        elif ftype == "Garages":
            records = [r for r in records if r.get("type") != "mechanic"]
        elif ftype == "Mécaniciens":
            records = [r for r in records if r.get("type") == "mechanic"]

        self.tree.delete(*self.tree.get_children())
        for r in records:
            c   = r.get("client", {})
            lbl = r.get("label") or f"{c.get('prenom','')} {c.get('nom','')}".strip() or r["cid"]
            entr = c.get("entreprise", "")
            display = f"{lbl}  {('· ' + entr) if entr and entr != lbl else ''}".strip()
            parent = r.get("parent_lid", "")
            parent_disp = (parent[:8] + "…") if parent else ""
            tag = r["status"]
            self.tree.insert("", "end", iid=r["lid"], tags=(tag,),
                             values=(display,
                                     core.TYPE_LABELS.get(r["type"], r["type"]),
                                     parent_disp,
                                     STATUS_LABEL.get(r["status"], r["status"]),
                                     r.get("expires_at", ""),
                                     r["cid"],
                                     r["lid"][:8] + "…"))
        self.tree.tag_configure("active",    foreground=GREEN)
        self.tree.tag_configure("revoked",   foreground=RED)
        self.tree.tag_configure("suspended", foreground=AMBER)

    def _show_children(self):
        """Filtre la liste sur les clés mécanicien de la licence sélectionnée."""
        lid = self._selected_lid()
        if not lid:
            return
        rec = db.get_license(lid)
        if rec and rec.get("type") == "mechanic":
            messagebox.showinfo("Clé mécanicien",
                                "Sélectionnez une licence GARAGE pour voir ses clés mécanicien.")
            return
        self._child_filter = None if self._child_filter == lid else lid
        self.refresh()

    def _selected_lid(self) -> str | None:
        sel = self.tree.selection()
        return sel[0] if sel else None

    def _on_select(self, _event):
        lid = self._selected_lid()
        if lid:
            rec = db.get_license(lid)
            if rec:
                self.detail_var.set(rec.get("token", ""))

    def _apply_status(self, lid: str, status: str):
        """Update status locally and remotely in a background thread."""
        db.set_status(lid, status)
        db.audit_log(f"status_{status}", lid)
        self.refresh()
        url, key = self._get_server_cfg()
        if url and key:
            def _call():
                ok, msg = _remote_set_status(url, key, lid, status)
                self.after(0, lambda: messagebox.showinfo(
                    "Serveur GarageFlow",
                    f"{'✅' if ok else '⚠️'} {msg}"
                ))
            threading.Thread(target=_call, daemon=True).start()

    def _reactivate(self):
        lid = self._selected_lid()
        if lid:
            self._apply_status(lid, "active")

    def _revoke(self):
        lid = self._selected_lid()
        if lid and messagebox.askyesno("Confirmation", "Révoquer définitivement cette licence ?"):
            self._apply_status(lid, "revoked")

    def _suspend(self):
        lid = self._selected_lid()
        if lid:
            self._apply_status(lid, "suspended")

    def _copy(self):
        lid = self._selected_lid()
        if lid:
            rec = db.get_license(lid)
            if rec:
                self.clipboard_clear()
                self.clipboard_append(rec["token"])
                messagebox.showinfo("Copié", "Token copié dans le presse-papiers.")

    def _delete(self):
        lid = self._selected_lid()
        if lid and messagebox.askyesno("Supprimer", "Supprimer cette entrée de la base locale ?\n(Le token reste valide cryptographiquement.)"):
            db.delete_license(lid)
            self.refresh()


# ── Onglet 3 — Clés ECC ──────────────────────────────────────────────────────

class TabKeys(tk.Frame):
    def __init__(self, master, on_passphrase_change=None):
        super().__init__(master, bg=BG)
        self.on_passphrase_change = on_passphrase_change
        self._build()

    def _build(self):
        _lbl(self, "  Configuration des clés ECC P-256",
             font=("Segoe UI", 13, "bold")).pack(anchor="w", padx=20, pady=(18, 4))

        # Statut clés
        card = _frame(self, bg=CARD, padx=16, pady=14)
        card.pack(fill="x", padx=20, pady=(0, 12))

        self.lbl_status = _lbl(card, "", font=FONTB)
        self.lbl_status.pack(anchor="w")
        self.lbl_priv   = _lbl(card, "", fg=MUTED, font=FONTS)
        self.lbl_priv.pack(anchor="w", pady=(4, 0))
        self.lbl_pub    = _lbl(card, "", fg=MUTED, font=FONTS)
        self.lbl_pub.pack(anchor="w")

        self._refresh_status()

        # Passphrase
        pp_frame = _frame(self, bg=CARD, padx=16, pady=14)
        pp_frame.pack(fill="x", padx=20, pady=(0, 12))

        _lbl(pp_frame, "Passphrase clé privée", font=FONTB).pack(anchor="w")
        _lbl(pp_frame, "Laissez vide si la clé n'est pas chiffrée.", fg=MUTED, font=FONTS).pack(anchor="w", pady=(2, 8))

        self.v_pp = tk.StringVar()
        pp_row = _frame(pp_frame, bg=CARD)
        pp_row.pack(fill="x")
        _entry(pp_row, textvariable=self.v_pp, show="•", width=30).pack(
            side="left", fill="x", expand=True, ipady=4)
        _btn(pp_row, "Appliquer", self._apply_pp, bg=CARD2, fg=TEXT,
             font=FONTS, padx=10, pady=4).pack(side="left", padx=(6, 0))

        # Init / Régénérer
        init_frame = _frame(self, bg=CARD, padx=16, pady=14)
        init_frame.pack(fill="x", padx=20, pady=(0, 12))

        _lbl(init_frame, "Initialiser / Régénérer les clés", font=FONTB).pack(anchor="w")
        _lbl(init_frame,
             "⚠️  Régénérer invalide toutes les licences existantes.\n"
             "Les clés seront créées dans le dossier  keys/  à la racine du projet.",
             fg=AMBER, font=FONTS, justify="left").pack(anchor="w", pady=(4, 10))

        btn_row = _frame(init_frame, bg=CARD)
        btn_row.pack(anchor="w")
        _btn(btn_row, "🔑  Initialiser les clés", self._init_keys,
             bg="#1e3a5f", fg=BLUE, font=FONTB).pack(side="left")

        # Clé publique — brute (PEM)
        self.pub_frame = _frame(self, bg=CARD, padx=16, pady=14)
        self.pub_frame.pack(fill="x", padx=20, pady=(0, 12))
        _lbl(self.pub_frame, "Clé publique (PEM brut)",
             font=FONTB).pack(anchor="w")
        self.pub_text = tk.Text(
            self.pub_frame, height=4, bg=CARD2, fg=TEXT,
            font=(MONO[0], 9), relief="flat", bd=0,
            highlightthickness=1, highlightbackground=BORDER,
            state="disabled",
        )
        self.pub_text.pack(fill="x", pady=(6, 0), ipady=4)
        _btn(self.pub_frame, "📋  Copier PEM brut", self._copy_pub,
             bg=CARD2, fg=TEXT, font=FONTS, padx=10, pady=4).pack(anchor="w", pady=(6, 0))

        # Clé publique — format code prêt à coller
        self.code_frame = _frame(self, bg=CARD, padx=16, pady=14)
        self.code_frame.pack(fill="x", padx=20, pady=(0, 12))
        _lbl(self.code_frame,
             "Clé publique — format code  ✅  coller directement dans verify.ts et main.js",
             font=FONTB).pack(anchor="w")
        _lbl(self.code_frame,
             "Remplacez le bloc const _LINES = [...] / const _PK = [...] par ce texte.",
             fg=MUTED, font=FONTS).pack(anchor="w", pady=(2, 6))
        self.code_text = tk.Text(
            self.code_frame, height=6, bg=CARD2, fg=GREEN,
            font=(MONO[0], 9), relief="flat", bd=0,
            highlightthickness=1, highlightbackground=BORDER,
            state="disabled",
        )
        self.code_text.pack(fill="x", ipady=4)
        _btn(self.code_frame, "📋  Copier le code (TS/JS)", self._copy_code,
             bg=BLUE, fg=TEXT, font=FONTS, padx=10, pady=4).pack(anchor="w", pady=(6, 0))

        self._load_pub_display()

    def _refresh_status(self):
        if core.keys_exist():
            self.lbl_status.config(text="✅  Clés ECC configurées", fg=GREEN)
            self.lbl_priv.config(text=f"  Privée : {core.PRIV_FILE}")
            self.lbl_pub.config( text=f"  Publique: {core.PUB_FILE}")
        else:
            self.lbl_status.config(text="❌  Aucune clé trouvée — initialisez avant de générer.", fg=RED)
            self.lbl_priv.config(text="  Chemin attendu : " + str(core.PRIV_FILE))
            self.lbl_pub.config( text="")

    def _apply_pp(self):
        pp = self.v_pp.get()
        if self.on_passphrase_change:
            self.on_passphrase_change(pp)
        # Test de chargement
        if core.keys_exist():
            try:
                core.load_private_key(pp)
                messagebox.showinfo("OK", "Passphrase correcte — clé chargée avec succès.")
            except Exception as exc:
                messagebox.showerror("Erreur passphrase", str(exc))

    def _init_keys(self):
        if core.keys_exist():
            if not messagebox.askyesno(
                "Régénérer ?",
                "Des clés existent déjà.\n\n"
                "Régénérer les clés INVALIDE toutes les licences déjà signées.\n\n"
                "Continuer quand même ?",
            ):
                return
        pp = self.v_pp.get()
        try:
            result = core.generate_keys(pp)
            self._refresh_status()
            self._load_pub_display()
            messagebox.showinfo(
                "Clés générées ✓",
                "Paire de clés ECC P-256 créée.\n\n"
                "⚠️  Copiez la clé publique dans :\n"
                "  • src/lib/license/verify.ts   (tableau _K)\n"
                "  • electron/main.js             (tableau _PK)\n\n"
                "Puis relancez l'application.",
            )
        except Exception as exc:
            messagebox.showerror("Erreur initialisation", str(exc))

    def _pem_to_code_snippet(self) -> str:
        """Return the public key formatted as a TypeScript/JS array literal."""
        if not core.PUB_FILE.exists():
            return "(aucune clé publique)"
        lines = [ln for ln in core.PUB_FILE.read_text().strip().splitlines() if ln.strip()]
        items = ",\n  ".join(f"'{ln}'" for ln in lines)
        return (
            "// src/lib/license/public-key.ts  &  electron/main.js\n"
            "// Remplacez le tableau _LINES / _PK existant par ceci :\n"
            f"[\n  {items},\n]"
        )

    def _load_pub_display(self):
        # PEM brut
        self.pub_text.config(state="normal")
        self.pub_text.delete("1.0", "end")
        if core.PUB_FILE.exists():
            self.pub_text.insert("end", core.PUB_FILE.read_text())
        else:
            self.pub_text.insert("end", "(aucune clé publique)")
        self.pub_text.config(state="disabled")

        # Code prêt à coller
        self.code_text.config(state="normal")
        self.code_text.delete("1.0", "end")
        self.code_text.insert("end", self._pem_to_code_snippet())
        self.code_text.config(state="disabled")

    def _copy_pub(self):
        if core.PUB_FILE.exists():
            self.clipboard_clear()
            self.clipboard_append(core.PUB_FILE.read_text())
            messagebox.showinfo("Copié", "Clé publique (PEM) copiée dans le presse-papiers.")

    def _copy_code(self):
        snippet = self._pem_to_code_snippet()
        if snippet == "(aucune clé publique)":
            messagebox.showwarning("Clé manquante", "Initialisez les clés d'abord.")
            return
        self.clipboard_clear()
        self.clipboard_append(snippet)
        messagebox.showinfo("Copié ✓", "Snippet de code copié.\nCollez-le dans public-key.ts et main.js.")


# ── Onglet 4 — Serveur GarageFlow ────────────────────────────────────────────

class TabServer(tk.Frame):
    """Configure the remote GarageFlow server for real-time license revocation."""

    def __init__(self, master):
        super().__init__(master, bg=BG)
        cfg = db.load_server_config()
        self.v_url = tk.StringVar(value=cfg.get("url", ""))
        self.v_key = tk.StringVar(value=cfg.get("api_key", ""))
        self._build()

    def _build(self):
        _lbl(self, "  Connexion au serveur GarageFlow",
             font=("Segoe UI", 13, "bold")).pack(anchor="w", padx=20, pady=(18, 4))
        _lbl(self,
             "  Configurez l'URL et la clé API pour appliquer les révocations en temps réel.",
             fg=MUTED, font=FONTS).pack(anchor="w", padx=20, pady=(0, 14))

        card = _frame(self, bg=CARD, padx=16, pady=14)
        card.pack(fill="x", padx=20, pady=(0, 12))

        _lbl(card, "URL du serveur GarageFlow admin", fg=MUTED, font=FONTS).pack(anchor="w")
        _lbl(card, "ex: http://192.168.1.10:4028", fg=MUTED, font=("Segoe UI", 8)).pack(anchor="w")
        _entry(card, textvariable=self.v_url).pack(fill="x", ipady=4, pady=(2, 10))

        _lbl(card, "Clé API (GARAGEFLOW_API_KEY du serveur)", fg=MUTED, font=FONTS).pack(anchor="w")
        _lbl(card, "Trouvez cette valeur dans le fichier .env du serveur (variable GARAGEFLOW_API_KEY).",
             fg=MUTED, font=("Segoe UI", 8)).pack(anchor="w")
        _entry(card, textvariable=self.v_key, show="•").pack(fill="x", ipady=4, pady=(2, 10))

        row = _frame(card, bg=CARD)
        row.pack(fill="x")
        _btn(row, "💾  Enregistrer", self._save, bg=BLUE).pack(side="left")
        _btn(row, "🔌  Tester la connexion", self._test,
             bg=CARD2, fg=MUTED, font=FONTS, padx=10, pady=4).pack(side="left", padx=(8, 0))

        self.lbl_result = _lbl(card, "", fg=MUTED, font=FONTS)
        self.lbl_result.pack(anchor="w", pady=(8, 0))

        # Explanation
        info = _frame(self, bg=CARD2, padx=16, pady=14)
        info.pack(fill="x", padx=20, pady=(0, 12))
        _lbl(info, "Comment ça fonctionne :", font=FONTB).pack(anchor="w")
        _lbl(info,
             "1. L'admin installe GarageFlow et le lance comme serveur (LAN ou VPN).\n"
             "2. Entrez l'URL et la clé API (GARAGEFLOW_API_KEY) ci-dessus.\n"
             "3. Quand vous révoquez/suspendez une licence dans cet outil,\n"
             "   le serveur GarageFlow est mis à jour immédiatement.\n"
             "4. Les clients GarageFlow vérifient le serveur toutes les 2 minutes\n"
             "   et sont bloqués en cas de révocation.",
             fg=MUTED, font=FONTS, justify="left").pack(anchor="w", pady=(6, 0))

    def _save(self):
        # Valide l'URL avant enregistrement (https:// en prod, http:// toléré en LAN/local).
        ok_url, err_url = _validate_server_url(self.v_url.get())
        if not ok_url:
            self.lbl_result.config(text="⚠️  " + err_url, fg=AMBER)
            return
        db.save_server_config(self.v_url.get(), self.v_key.get())
        self.lbl_result.config(text="✅  Configuration enregistrée.", fg=GREEN)

    def _test(self):
        url = self.v_url.get().strip().rstrip("/")
        key = self.v_key.get().strip()
        if not url or not key:
            self.lbl_result.config(text="⚠️  URL et clé requis.", fg=AMBER)
            return
        # Valide l'URL avant de tester la connexion.
        ok_url, err_url = _validate_server_url(url)
        if not ok_url:
            self.lbl_result.config(text="⚠️  " + err_url, fg=AMBER)
            return
        self.lbl_result.config(text="⏳  Test en cours…", fg=MUTED)

        def _do():
            # Ping via status='active' (chemin sans écriture DB). La route renvoie 200
            # {ok:true, note:'not_registered'} pour un licenseId inconnu — c'est un succès.
            import urllib.request, urllib.error, json as _j
            test_url = url + "/api/admin/licenses/revoke-by-key"
            payload = _j.dumps({"licenseId": "__test_ping__", "status": "active"}).encode()
            req = urllib.request.Request(test_url, data=payload,
                headers={"Content-Type": "application/json", "x-gf-key": key}, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=6) as r:
                    data = _j.loads(r.read())
                    # 200 = authentification OK. note='not_registered' attendu pour ce licenseId factice.
                    if data.get("note") == "not_registered":
                        msg = "✅  Connexion réussie (licenceId inconnu = normal)."
                    else:
                        msg = "✅  Connexion réussie."
                    self.after(0, lambda: self.lbl_result.config(text=msg, fg=GREEN))
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    self.after(0, lambda: self.lbl_result.config(
                        text="❌  Clé API invalide (GARAGEFLOW_API_KEY) — vérifiez la clé du serveur.", fg=RED))
                elif e.code == 429:
                    self.after(0, lambda: self.lbl_result.config(
                        text="⚠️  Trop de requêtes (rate limit) — réessayez dans quelques instants.", fg=AMBER))
                elif e.code in (500, 502, 503, 504):
                    self.after(0, lambda e=e: self.lbl_result.config(
                        text=f"⚠️  Serveur indisponible (HTTP {e.code}) — réessayez plus tard.", fg=AMBER))
                else:
                    self.after(0, lambda e=e: self.lbl_result.config(
                        text=f"⚠️  HTTP {e.code}", fg=AMBER))
            except socket.timeout:
                self.after(0, lambda: self.lbl_result.config(
                    text="❌  Délai dépassé — le serveur ne répond pas.", fg=RED))
            except urllib.error.URLError as exc:
                if isinstance(exc.reason, socket.timeout):
                    self.after(0, lambda: self.lbl_result.config(
                        text="❌  Délai dépassé — le serveur ne répond pas.", fg=RED))
                else:
                    self.after(0, lambda: self.lbl_result.config(
                        text="❌  Connexion impossible — vérifiez l'URL du serveur et le réseau.", fg=RED))
            except Exception:
                self.after(0, lambda: self.lbl_result.config(
                    text="❌  Connexion impossible — vérifiez l'URL du serveur et le réseau.", fg=RED))

        threading.Thread(target=_do, daemon=True).start()

    def get_config(self) -> tuple[str, str]:
        return self.v_url.get().strip().rstrip("/"), self.v_key.get().strip()


# ── Fenêtre principale ────────────────────────────────────────────────────────

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("GarageFlow — Gestionnaire de Licences v2")
        self.geometry("960x680")
        self.minsize(800, 600)
        self.configure(bg=BG)
        self._passphrase = ""
        self._build()
        self._check_keys_on_start()

    def _build(self):
        # ─ Barre titre ─
        tb = tk.Frame(self, bg="#070d1b", height=36)
        tb.pack(fill="x")
        tb.pack_propagate(False)
        tk.Label(tb, text="  🔑  GarageFlow — Gestionnaire de Licences ECC v2",
                 bg="#070d1b", fg=MUTED,
                 font=("Segoe UI", 9, "bold")).pack(side="left", padx=4)

        # ─ Notebook ─
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure("TNotebook",           background=CARD,  borderwidth=0)
        style.configure("TNotebook.Tab",       background=CARD2, foreground=MUTED,
                        padding=[14, 6], font=("Segoe UI", 10))
        style.map("TNotebook.Tab",
                  background=[("selected", BG)],
                  foreground=[("selected", TEXT)])
        style.configure("Treeview",            background=CARD2, foreground=TEXT,
                        fieldbackground=CARD2, rowheight=26, borderwidth=0)
        style.configure("Treeview.Heading",    background=CARD,  foreground=MUTED,
                        font=("Segoe UI", 9, "bold"), relief="flat")
        style.map("Treeview",
                  background=[("selected", BLUE)],
                  foreground=[("selected", TEXT)])
        style.configure("TScrollbar", background=CARD2, troughcolor=CARD, borderwidth=0)
        style.configure("TCombobox",  fieldbackground=CARD2, background=CARD2,
                        foreground=TEXT, arrowcolor=MUTED, borderwidth=0)
        style.configure("TSpinbox",   fieldbackground=CARD2, background=CARD2,
                        foreground=TEXT, arrowcolor=MUTED, borderwidth=0)
        style.configure("TSeparator", background=BORDER)

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=0, pady=0)

        self.tab_server = TabServer(nb)
        self.tab_gen    = TabGenerate(nb, on_generated=self._on_generated,
                                      get_server_cfg=self.tab_server.get_config)
        self.tab_manage = TabManage(nb, get_server_cfg=self.tab_server.get_config)
        self.tab_keys   = TabKeys(nb, on_passphrase_change=self._set_passphrase)

        nb.add(self.tab_gen,    text="  ⚡  Générer       ")
        nb.add(self.tab_manage, text="  📋  Gérer les licences  ")
        nb.add(self.tab_keys,   text="  🔑  Clés ECC      ")
        nb.add(self.tab_server, text="  🌐  Serveur GarageFlow  ")

    def _set_passphrase(self, pp: str):
        self._passphrase = pp
        self.tab_gen.set_passphrase(pp)

    def _on_generated(self, _info):
        self.tab_manage.refresh()

    def _check_keys_on_start(self):
        if not core.HAS_CRYPTO:
            messagebox.showerror(
                "Dépendance manquante",
                "Le module Python 'cryptography' est requis.\n\n"
                "Installez-le avec :\n"
                "    pip install cryptography\n\n"
                "puis relancez le programme.",
            )
            return
        if not core.keys_exist():
            messagebox.showwarning(
                "Clés ECC manquantes",
                "Aucune paire de clés n'est configurée.\n\n"
                "Allez dans l'onglet  🔑 Clés ECC  et cliquez\n"
                "'Initialiser les clés' pour commencer.",
            )


# ── Point d'entrée ────────────────────────────────────────────────────────────
# Sans ce garde, `python scripts/keygen_ui.py` définissait les classes puis
# rendait la main immédiatement : aucune fenêtre ne s'ouvrait. On lance ici la
# boucle Tk (App().mainloop()), avec un message clair si Tkinter n'est pas
# disponible (durcissement — superset du point d'entrée mechanic).
def main():
    try:
        App().mainloop()
    except tk.TclError as e:
        print(
            "Impossible de démarrer l'interface graphique (Tkinter indisponible "
            f"ou pas d'affichage) : {e}",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
