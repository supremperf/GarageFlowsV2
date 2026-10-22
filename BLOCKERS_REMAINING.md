---
doc-numbers: journal
---

# Blocages restants — MASTER 2

**Au 22 octobre 2026, chaque élément P0/P1 ci-dessous reste ouvert. Un seul suffit à interdire la production.**

| ID | Priorité | Blocage et preuve | Responsable/action de clôture |
|---|---|---|---|
| BLK-01 | P0 | `binaries.prisma.sh` réinitialise avant TLS ; aucun moteur natif (`03`, `04`, `18`) | infrastructure build : autoriser le CDN officiel ou fournir un cache approuvé avec SHA-256, puis générer et charger les moteurs |
| BLK-02 | P0 | build officiel exit 1 ; standalone refusé (`18`) | mainteneur build : rejouer la chaîne sans `noEngine`, health DB 200 et garde standalone vert |
| BLK-03 | P0 | suite Vitest complète en échec, parties DB non exécutées (`15`) | après BLK-01 : suite complète sur bases isolées, zéro échec et périmètre réel vérifié |
| BLK-04 | P0 | aucun Setup.exe, `dist/` absent (`25`) | chaîne Windows x64 : `npm run dist`, inspection NSIS/win-unpacked, empreinte et contenu |
| BLK-05 | P0 | aucune installation, signature, persistance ou désinstallation Windows | équipe release Windows : VM/poste de test, licence de test existante, données de test et procédure complète |
| BLK-06 | P0 | SBOM/notices non réconciliées avec le paquet réel (`28`, `32`) | conformité + release : inventorier le paquet, réconcilier les 33 écarts source et faire relire LGPL/CC-BY |
| BLK-07 | P1 | Chromium officiel indisponible ; 144 tests listés, 0 exécuté (`13`, `20`) | fournir le navigateur officiel/cache approuvé puis exécuter tous les projets sans skip critique |
| BLK-08 | P1 | PostgreSQL et Redis de test absents (`21`) | fournir des instances isolées et leurs accès coffre ; exécuter migrations, concurrence, isolation et rate limiting |
| BLK-09 | P1 | SMTP, portail, facturation et mises à jour sans staging (`21`) | fournir comptes/données de test et cible non-production ; exécuter les parcours sans client/paiement réel |
| BLK-10 | P1 | OCR réel Tesseract ignoré (`14`, `32`) | installer Tesseract approuvé ou exécuter le test sur un hôte équipé ; conserver le résultat réel |
| BLK-11 | P1 | Gitleaks/historique Git non exécuté (`32`) | fournir le binaire vérifié ou un scanner équivalent approuvé ; scanner working tree et historique, trier les findings |
| BLK-12 | P1 | working tree contient corrections et rapports non commités | revue humaine puis commit/push uniquement avec autorisation explicite ; release depuis un commit propre |

## Dépendances de sortie

1. **BLK-01** débloque la majeure partie de BLK-02/03 et est requis avant BLK-04.
2. BLK-04 doit précéder les inspections Windows et la réconciliation de l’artefact.
3. BLK-07 à BLK-09 exigent des ressources externes ; aucune ne peut être remplacée par un mock ou une sortie 0 sans cible.
4. BLK-10 à BLK-12 restent indépendants et ne doivent pas être oubliés après un build vert.

La nouvelle commande `npm run readiness:final` consolide ces exigences et reste rouge tant qu’une preuve critique est absente, modifiée ou non exécutée.
