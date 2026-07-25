"""
GarageFlow — Gestionnaire de Licences ECC v2
=============================================

Lance l'interface graphique du keygen.

Usage :
    python scripts/keygen_gui.py

Prérequis :
    pip install cryptography

Fichiers :
    keygen_core.py  — crypto ECC (signature, vérification, clés)
    keygen_db.py    — base de données locale JSON (licences générées)
    keygen_ui.py    — interface graphique tkinter
"""

import sys
import os

# Ajouter le dossier scripts au path pour les imports relatifs
sys.path.insert(0, os.path.dirname(__file__))


def main():
    try:
        import tkinter  # noqa: F401
    except ImportError:
        print("ERREUR : tkinter est introuvable.")
        print("Sur Windows, tkinter est inclus avec Python.")
        print("Téléchargez Python depuis https://www.python.org et cochez 'tcl/tk'.")
        sys.exit(1)

    # Imports après vérification tkinter
    from keygen_ui import App

    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
