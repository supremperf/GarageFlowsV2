---
doc-numbers: journal
---

# Preuves d’audit — 22 octobre 2026

Ces fichiers sont des copies des sorties produites dans le sandbox. Seules les séquences ANSI ont été retirées des journaux de commandes. Ils ne contiennent volontairement aucune valeur de secret. Les chemins `/tmp` d’origine sont internes au sandbox et ne sont pas nécessaires pour lire les copies.

## Index

| Fichier | Commande ou origine | Objet |
|---|---|---|
| `01-official-build-prisma-failure.txt` | `npm run build` | échec TLS avant Next pendant Prisma Generate |
| `02-next-build-no-engine.txt` | `node scripts/next-build.cjs` | compilation isolée avec clients `noEngine` |
| `03-postbuild.txt` | `npm run postbuild` | assets, ressources et manifeste standalone |
| `04-verify-standalone.txt` | `npm run verify:standalone` avant renforcement | ancien contrôle structurel en 4 éléments, faux vert sans moteur |
| `05-standalone-secret-scan.txt` | `node scripts/check-artifact-secrets.mjs .next/standalone` | 2 827 fichiers, 1 valeur locale traquée |
| `06-preflight-release.txt` | `npm run preflight:release` | préflight Linux, cible Windows et avertissement externe |
| `07-standalone-smoke.txt` | requêtes `curl` sur serveur local | codes HTTP et en-têtes ; correction du chemin du chunk conservée |
| `08-standalone-server.txt` | `node .next/standalone/server.js` | démarrage et erreur Prisma health sans valeur de configuration |
| `09-vitest-final.txt` | suite Vitest complète | résultats globaux et erreurs de préparation Prisma |
| `10-node-tests.txt` | `node --test tests/*.test.cjs` | 495 tests Node |
| `11-keygen-python.txt` | `npm run test:keygen` | quatre suites Python, dont un OCR ignoré |
| `12-python-vitest.txt` | trois fichiers Vitest keygen/Python | 26 tests d’intégration |
| `13-release-safety.txt` | `npm run test:release-safety` | 172 tests de sécurité release |
| `14-config-auto-tests.txt` | `npm run test:config:auto` | 119 tests du configurateur automatique |
| `15-audit-strict.txt` | `npm run audit:strict` | vulnérabilités NPM par niveau |
| `16-desktop-audit.txt` | `npm run check:desktop-audit` | audit statique Electron |
| `17-perf-budget.txt` | `npm run check:perf-budget` | budgets du build Next isolé |
| `18-secrets-regression-before.txt` | Vitest ciblé avant correction | reproduction du défaut de parsing |
| `19-setup-regression-before.txt` | Node test ciblé avant correction | reproduction génération/permissions |
| `20-setup-after-fix.txt` | `npm run setup` après correction | génération annoncée sans afficher le secret |
| `21-license-inventory.txt` | `license-checker --production --json` | inventaire JSON de l’installation courante |
| `22-keygen-e2e-no-target.txt` | `npm run test:keygen:e2e` sans cible | aucun parcours E2E exécuté malgré la sortie 0 |
| `23-evidence-secret-scan.txt` | `node scripts/check-artifact-secrets.mjs artifacts/verification/audit-2026-10-22` | contrôle ciblé des preuves |
| `24-source-working-tree-secret-scan.txt` | snapshot des fichiers Git non ignorés + même contrôleur | 2 750 textes lus, 104 binaires exclus ; pas de scan d’historique |
| `25-standalone-engine-before-after.txt` | version `HEAD` puis courante sur fixture sans moteur | exits 0 puis 1 sur une fixture par ailleurs identique |
| `26-standalone-engine-validation.txt` | tests du garde + vérification de l’artefact réel | 16/16, 172/172 et refus du standalone `noEngine` |

Le contrôle n°23 lit les 26 fichiers `.txt` et `SHA256SUMS`, soit 27 fichiers. Cet outil traque les clés privées et les valeurs du `.env` local ; il ne constitue pas un Gitleaks ni un scan de l’historique Git.

## Vérification d’intégrité des copies

```bash
cd artifacts/verification/audit-2026-10-22
sha256sum -c SHA256SUMS
```

Les empreintes prouvent que les fichiers lus correspondent aux fichiers hachés après copie. Elles ne remplacent pas la CI et ne prouvent pas à elles seules l’identité de l’exécutant.

## Limites

- le build officiel reste en échec ;
- la compilation isolée utilise un contournement `noEngine` et ne valide pas Prisma runtime ;
- les journaux ne contiennent pas de validation Windows, PostgreSQL, Redis, SMTP ou navigateur ;
- l’inventaire de licences de l’installation courante n’est pas une nomenclature du futur paquet Windows.
