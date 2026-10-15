"""
Tests de CYCLE DE VIE des widgets du Keygen (anti-TclError).

Bug reproduit en production :

    Exception in Tkinter callback
    _tkinter.TclError: bad window path name ".!notebook.!tabgenerate.!toplevel"

Cause : la fenêtre récapitulative des clés mécanicien lance l'enregistrement
serveur dans un thread, puis planifie
`messagebox.showinfo(..., parent=win)` via `.after(0, …)`. Si l'utilisateur
ferme cette fenêtre pendant la requête, `win` est détruite et son chemin Tcl
n'existe plus au moment de l'affichage.

Exécution (depuis la racine du projet) :
    python scripts/test_keygen_ui_lifecycle.py

Nécessite tkinter et une session graphique. Aucun dialogue réel n'est ouvert :
`messagebox` est remplacé par une sonde, donc les tests ne bloquent jamais.
"""

import sys
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import tkinter as tk

try:
    tk.Tk().destroy()
except tk.TclError as exc:  # pragma: no cover - dépend de l'environnement
    print(f"tkinter indisponible ({exc}) — tests ignorés.")
    raise SystemExit(0)

import keygen_ui as ui


class _DialogSpy:
    """Remplace messagebox : enregistre le parent reçu, n'ouvre rien."""

    def __init__(self):
        self.calls = []

    def showinfo(self, title, message, parent=None):
        self.calls.append(("showinfo", title, message, parent))

    def showerror(self, title, message, parent=None):
        self.calls.append(("showerror", title, message, parent))


class WidgetLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.spy = _DialogSpy()
        self._real_messagebox = ui.messagebox
        ui.messagebox = self.spy

    def tearDown(self):
        ui.messagebox = self._real_messagebox
        try:
            self.root.destroy()
        except tk.TclError:
            pass

    # ── Reproduction du défaut ───────────────────────────────────────────────

    def test_dead_window_path_raises_tclerror(self):
        """Le comportement d'origine : un chemin de fenêtre détruit lève."""
        win = tk.Toplevel(self.root)
        path = str(win)
        win.destroy()
        with self.assertRaises(tk.TclError) as ctx:
            self.root.tk.call("winfo", "class", path)
        self.assertIn("bad window path name", str(ctx.exception))

    # ── Les garde-fous ───────────────────────────────────────────────────────

    def test_widget_alive(self):
        win = tk.Toplevel(self.root)
        self.assertTrue(ui._widget_alive(win))
        win.destroy()
        self.assertFalse(ui._widget_alive(win))
        self.assertFalse(ui._widget_alive(None))

    def test_live_parent_falls_back_to_surviving_ancestor(self):
        win = tk.Toplevel(self.root)
        self.assertIs(ui._live_parent(win, self.root), win)
        win.destroy()
        # C'est ici que le crash se produisait : `parent=win` détruit.
        self.assertIs(ui._live_parent(win, self.root), self.root)

    def test_live_parent_returns_none_when_all_dead(self):
        win = tk.Toplevel(self.root)
        win.destroy()
        self.assertIsNone(ui._live_parent(win, None))

    def test_dialog_never_receives_a_destroyed_parent(self):
        win = tk.Toplevel(self.root)
        win.destroy()
        ui._info("Serveur GarageFlows", "Enregistrées : 2 · Échecs : 0", win, self.root)
        kind, _title, _msg, parent = self.spy.calls[-1]
        self.assertEqual(kind, "showinfo")
        self.assertIs(parent, self.root)

    # ── Scénarios demandés ───────────────────────────────────────────────────

    def test_A_normal_generation_callback_runs(self):
        seen = []
        ui._ui(self.root, lambda: seen.append("done"))
        self.root.update()
        self.assertEqual(seen, ["done"])

    def test_B_window_closed_before_scheduling_is_ignored(self):
        win = tk.Toplevel(self.root)
        win.destroy()
        seen = []
        ui._ui(win, lambda: seen.append("should not run"))
        self.root.update()
        self.assertEqual(seen, [])

    def test_D_window_closed_between_scheduling_and_execution(self):
        """La vraie course : planifié pendant que la fenêtre vivait encore."""
        win = tk.Toplevel(self.root)
        seen = []
        ui._ui(win, lambda: seen.append("should not run"))
        win.destroy()  # l'utilisateur ferme avant que la boucle Tk ne tourne
        self.root.update()
        self.assertEqual(seen, [])

    def test_E_slow_worker_thread_closing_window_does_not_raise(self):
        """Reproduction FIDÈLE du crash signalé.

        Une vraie `mainloop()` est nécessaire : c'est la seule condition dans
        laquelle tkinter accepte un `.after()` venu d'un thread secondaire —
        exactement la situation de l'application réelle.
        """
        win = tk.Toplevel(self.root)

        def start():
            def worker():
                time.sleep(0.15)  # « enregistrement serveur en cours »
                ui._ui(self.root, lambda: ui._info(
                    "Serveur GarageFlows", "Enregistrées : 3 · Échecs : 0", win, self.root))
            threading.Thread(target=worker, daemon=True).start()
            # L'utilisateur ferme la fenêtre PENDANT la requête.
            self.root.after(50, win.destroy)
            self.root.after(700, self.root.quit)

        self.root.after(0, start)
        self.root.mainloop()  # ne doit lever aucune TclError

        self.assertTrue(self.spy.calls, "le retour serveur n'a jamais été délivré")
        kind, _title, _msg, parent = self.spy.calls[-1]
        self.assertEqual(kind, "showinfo")
        # Le parent détruit a été remplacé par une fenêtre vivante.
        self.assertIs(parent, self.root)

    def test_F_server_error_message_reaches_the_user(self):
        """Une erreur réseau n'est jamais avalée : elle atteint l'utilisateur."""
        def start():
            def worker():
                time.sleep(0.05)
                ui._ui(self.root, lambda: ui._error(
                    "Erreur de signature", "clé privée illisible", self.root))
            threading.Thread(target=worker, daemon=True).start()
            self.root.after(500, self.root.quit)

        self.root.after(0, start)
        self.root.mainloop()

        kind, title, message, _parent = self.spy.calls[-1]
        self.assertEqual(kind, "showerror")
        self.assertEqual(title, "Erreur de signature")
        self.assertIn("clé privée illisible", message)

    def test_G_success_after_delay_still_displays(self):
        win = tk.Toplevel(self.root)
        ui._ui(self.root, lambda: ui._info("OK", "Terminé", win, self.root))
        self.root.update()
        self.assertIs(self.spy.calls[-1][3], win)

    def test_app_closed_entirely_is_ignored(self):
        root2 = tk.Tk()
        root2.withdraw()
        seen = []
        root2.destroy()
        ui._ui(root2, lambda: seen.append("nope"))
        self.assertEqual(seen, [])


class ExceptionCaptureTests(unittest.TestCase):
    """`except … as exc` est supprimé à la sortie du bloc (Python 3).

    Un callback différé qui référence `exc` lève NameError et l'utilisateur ne
    voit alors JAMAIS l'erreur réelle de signature. La capture par argument par
    défaut est l'idiome retenu dans keygen_ui.
    """

    @staticmethod
    def _late_bound():
        try:
            raise ValueError("échec de signature")
        except ValueError as exc:
            return lambda: str(exc)

    @staticmethod
    def _default_arg_bound():
        try:
            raise ValueError("échec de signature")
        except ValueError as exc:
            return lambda msg=str(exc): msg

    def test_late_binding_loses_the_exception(self):
        with self.assertRaises(NameError):
            self._late_bound()()

    def test_default_argument_preserves_the_message(self):
        self.assertEqual(self._default_arg_bound()(), "échec de signature")


if __name__ == "__main__":
    unittest.main(verbosity=2)
