# Checklist de release Windows

_Procédure reproductible pour produire un installateur Windows. Les étapes
marquées 🪟 nécessitent Windows (BLOCKED_ENVIRONMENT hors Windows) ; 🔒 nécessitent
un certificat (BLOCKED_EXTERNAL)._

## Pré-requis

- [ ] Node 20+, npm.
- [ ] 🪟 Windows 10/11 x64 **ou** runner `windows-latest` (le workflow
      `.github/workflows/windows-build.yml`).
- [ ] Clé publique de licence présente (`keys/public.pem`) — le build échoue
      proprement sinon (voir `scripts/post-build.js`).
- [ ] 🔒 (release signée) secrets `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD`.

## Étapes

1. [ ] `npm ci`
2. [ ] `npx prisma generate` **et** `npx prisma generate --schema prisma/server/schema.prisma`
3. [ ] `npx tsc --noEmit` → **0 erreur**
4. [ ] `npx next lint` → **0 erreur**
5. [ ] `npm test` → **toutes vertes**
6. [ ] `npm run brand:check` → packaging à jour (ou `npm run brand:apply`)
7. [ ] 🪟 `npm run dist` (exécute `predist`=apply-brand, build, post-build,
      electron-builder --win --x64) → `dist/<Produit> Setup <version>.exe`
8. [ ] 🔒 Vérifier la signature : `./scripts/verify-windows-signature.ps1 -Path dist -Strict`
9. [ ] 🪟 Tester l'installation : `./scripts/test-windows-installation.ps1 -Installer "dist/<Produit> Setup <version>.exe"`
10. [ ] Vérifier le manifeste de mise à jour (`dist/latest.yml`) et le SHA-256.
11. [ ] Publier l'installateur via l'admin (téléversement) ou le serveur de MàJ ;
       le client vérifie SHA-256 + signature Ed25519 du manifeste avant d'installer.

## Contrôles post-installation (🪟 manuel)

- [ ] Premier lancement : base créée depuis le template (`garageflow-template.db`),
      dossier `userData` correct, logs écrits.
- [ ] Activation de licence (saisie manuelle → contrôle HWID).
- [ ] Mise à jour : téléchargement repris, vérification, installation atomique, rollback.
- [ ] Désinstallation : nettoyage, aucune donnée secrète résiduelle.
- [ ] Antivirus courant : pas de faux positif bloquant (dépend de la réputation 🔒).

## Statut d'exécution dans cet environnement

- Étapes 1–6 : **exécutables et vérifiées** ici (Linux).
- Étapes 7–9 et contrôles 🪟 : **BLOCKED_ENVIRONMENT** (pas de Windows). Le
  workflow CI Windows est fourni et prêt à les exécuter.
- Signature 🔒 : **BLOCKED_EXTERNAL** (pas de certificat).

_Voir aussi : `docs/WINDOWS_CODE_SIGNING.md`, `docs/UPDATE_SECURITY.md`._
