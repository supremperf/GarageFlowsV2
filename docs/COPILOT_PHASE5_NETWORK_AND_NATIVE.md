# Phase 5 — Prisma officiel : diagnostic et validation native

## Sandbox local : BLOQUÉ, pas de contournement

Preuves append-only `docs/audit/copilot-phase5/V02..V04`, puis V13/V24. Node 22.22.3/OpenSSL 3.5.6, Prisma et client **5.22.0**, moteur `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, Linux x64 `debian-openssl-3.0.x`.

- DNS `binaries.prisma.sh` résolu ; HTTPS échoue **avant établissement TLS**, `ECONNRESET`, aucun statut HTTP/certificat validé. Ce n’est pas une preuve de certificat invalide.
- `registry.npmjs.org` : TLS autorisé, HTTP 200 ; installation npm reproductible réussie.
- Deux `prisma generate` échouent sur téléchargement officiel de checksum schema-engine. Les six suites locales échouent en setup au téléchargement query-engine : **54 cas non exécutés**, affichés skipped par Vitest, pas 54 passes.
- V24 : 225 diagnostics du compilateur local sans clients natifs générés. La comparaison historique sous ces mêmes dépendances n’est pas une preuve de régression/exécution native. **Le TypeScript standard réussit en CI après génération officielle** ; ne pas « corriger » ces cascades avec casts, faux clients, déclarations diagnostic ou exclusions.

Ticket au propriétaire réseau de cet environnement : autoriser DNS/SNI/HTTPS 443 Node vers **`binaries.prisma.sh`** et chemins `/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/` (checksums `.sha256`, schema-engine/query-engine compressés), ainsi que le registre officiel **`registry.npmjs.org`** pour les paquets verrouillés. Si un proxy d’entreprise est requis, le propriétaire doit fournir sa configuration/chaîne CA approuvées hors chat. Pas de miroir non vérifié, moteur téléchargé ailleurs, CA arbitraire, TLS désactivé ou checksum ignoré.

Après changement réel des prérequis, dans le checkout inchangé :

```sh
node scripts/diagnose-prisma-runtime.cjs
npx prisma generate
npx prisma generate --schema prisma/server/schema.prisma
node scripts/validate-copilot-native.cjs
npx tsc --noEmit
npm run build
npm run check:perf-budget
```

Vérifier les deux versions 5.22.0 et les origines/checksums officiels ; distinguer SQLite et PostgreSQL et leurs URL autorisées. Ne pas répéter les téléchargements sans changement de prérequis.

## GitHub Actions : prérequis satisfaits, vraie exécution

L’environnement CI existant obtient les moteurs officiels via `npm ci`/génération des deux clients, sans rapatrier ni remplacer de moteur dans le sandbox. Le wrapper natif exécute réellement les six fichiers, exige **54 cas exécutés et réussis**, refuse setup/skips/incomplétude/exit non nul ; les tests du wrapper ne sont pas cette preuve native. Les clés de modèle sont retirées de son environnement enfant et le modèle est désactivé.

Premier résultat sur `ce879b1` : **52/54 réussis, 2 échoués**, aucun cas non exécuté ; métadonnées des deux jobs dans `native-ci-initial.json`. Les assertions sont les cas Vitest, pas un comptage de toutes les expressions `expect`.

Les deux échecs sont dans `copilot-cout-achat` (confirmation des index dans preuve CI suivante). Lecture statique : ses deux premiers cas exigent que MECHANIC obtienne le stock opérationnel expurgé des coûts, tandis que `toolAllowed()` borne le catalogue aux trois rôles staff et que `low_stock` exige `job:manage`. `server-readers` revérifie ce garde et refuse. La matrice d’autorisation indépendante accorde exactement **11 permissions assigned/self/logout** au mécanicien et ne lui donne pas `job:manage`.

**Conflit de contrats à arbitrer**, pas un problème de moteur désormais en CI :

1. maintenir le périmètre mécanicien strict actuel (les deux attentes historiques restent échouées, non supprimées) ; ou
2. autoriser explicitement une capacité distincte de lecture de stock opérationnel, limitée au garage authentifié et sans coûts, avec menace, schéma de projection, tests négatifs et revue RBAC dédiés.

Aucune ouverture de permission, modification de cette matrice, relaxation de test ou exemption de suite n’a été effectuée pour faire passer ces cas. Les données financières et recherches globales restent interdites au mécanicien. Décision produit/sécurité explicite nécessaire avant changement de ce contrat.

Le nouveau job indépendant obligatoire `base-verification` mesure le TypeScript, build standard et budget immuable même si l’intégration échoue. Il ne remplace pas `check` : les gates existantes et la nouvelle gate sont conservées dans les dépendances agrégées. Le job demeure rouge si une gate échoue ; aucun `continue-on-error`, succès forcé ni mode de compilation alternatif.

Le démarrage production et les parcours licenciés/authentifiés restent **NON VALIDÉS** : un build réussi ne fournit ni configuration PostgreSQL/Neon/Vercel autorisée, ni vraie licence/issuer, ni environnement staging approuvé. Ne pas traiter la configuration SQLite de compilation CI comme un démarrage production sain ; l’interdiction SQLite en production est préservée.
