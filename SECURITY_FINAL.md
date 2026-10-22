---
doc-numbers: journal
---

# Sécurité finale — MASTER 2

**Verdict sécurité release : NON VALIDÉE de bout en bout. Les contrôles locaux favorables ne ferment pas les portes Windows, DB, staging et historique.**

## 1. Contrôles réussis

- TypeScript, ESLint et gardes de cohérence : verts.
- Tests Node : **507/507** ; release-safety : **184/184**.
- Supply-chain/audit ciblé : **23/23**.
- `audit:strict` et audit runtime desktop : **0 vulnérabilité LOW/MODERATE/HIGH/CRITICAL** au jour du contrôle.
- HWID/licence : `git diff --exit-code HEAD -- electron src/lib/license` sort 0 ; `collectHwidFieldsV1` et `getHwidV1` restent les versions de la base. Aucune clé privée suivie détectée.
- `.env` : mode `600`, contenu jamais journalisé ; aucune rotation de licence ou d’autorité.
- Standalone : 2 826 fichiers inspectés, aucune clé privée ni valeur du secret local traquée détectée.
- HTTP : 401/403 sur les routes privées sondées, CSP et en-têtes anti-framing/nosniff/referrer/permissions/HSTS présents.

## 2. Nouvelle prévention des faux verts

Le défaut de `final-release-gate.mjs` a été reproduit sur une copie sans commandes réelles : quatre contrôles critiques non exécutés aboutissaient à « GATE PASSÉ ». Après correction :

- le mode complet bloque les skips obligatoires comme les échecs ;
- un service fourni en `--fast` reste obligatoire s’il échoue ;
- `--fast` annonce seulement un pré-contrôle local, jamais une readiness production ;
- `npm run readiness:final` exige 33 contrôles A–K, leurs codes, marqueurs et empreintes ;
- `release:publish` appelle cette porte après `dist` et avant la signature.

Les 12 tests des deux portes passent. Ils couvrent notamment exigence absente, statut non vert, code incohérent, marqueur absent, preuve modifiée, chemin sortant, doublon et SHA256SUMS malformé.

## 3. Limites de sécurité encore ouvertes

- **Pas de scan Gitleaks** : binaire, Go, Docker et Podman absents ; le téléchargement historique des assets reste bloqué. Le scan ciblé MASTER 2 du working tree est consigné dans `38-source-working-tree-secret-scan.txt`, mais ne couvre pas l’historique Git ni toutes les familles de secrets.
- **Pas de runtime DB** : health 503 et tests DB incomplets ; l’isolation tenant n’est pas prouvée sur le scénario réel.
- **Pas d’artefact Windows** : fuses, PE, NSIS, signature et secrets du paquet final non contrôlés.
- **Pas de staging** : authentification et autorisations ne sont pas revérifiées contre les services réels.
- **CSP** : `'unsafe-inline'` demeure pour scripts/styles ; ce n’est pas une exploitation démontrée, mais reste une réduction de défense en profondeur.
- **OCR réel** : un test Tesseract est ignoré ; il n’est pas compté comme une réussite.

## 4. Politique de clôture

Conserver les clés privées hors du dépôt et des artefacts, ne jamais désactiver TLS ou les protections, ne pas régénérer HWID/licences, et n’utiliser que des comptes/données de test. Exécuter les contrôles de l’artefact réel et de l’historique avant toute publication. Aucun scan ciblé ne doit être présenté comme un scan Git complet.

Preuves principales : `25-artifact-static-checks.txt`, `26-hwid-and-data-preservation.txt`, `31-standalone-smoke.txt`, `32-sbom-notice-delta.txt`, `33-final-node-release-safety.txt`, `34-final-static-security.txt`, `35-production-readiness-required-ocr-tests.txt`, `38-source-working-tree-secret-scan.txt`, `40-evidence-secret-scan.txt`.
