# Rapport de sécurité — dépendances et contrôles vérifiés

**Date** : 2026-10-19
**Périmètre** : arbre de dépendances installé, verrou de versions, contrôles
applicatifs couverts par des tests exécutés.
**Environnement** : Node 22.22.3, npm 10.x, Linux x64, dépôt au commit de travail
`arena/7d755e35-garageflowsv2` (aucune mise à jour de dépendance effectuée).

> Ce rapport ne prétend ni « zéro vulnérabilité » ni conformité réglementaire.
> Il rapporte des mesures datées et nomme explicitement ce qui n'a pas pu être
> vérifié.

---

## 1. Audit des vulnérabilités déclarées

Commande (arbre **complet**, y compris développement, optionnel et peer) :

```bash
npm audit --json --audit-level=low --include=dev --include=optional --include=peer
```

| Sévérité | Nombre |
|---|---:|
| critical | 0 |
| high | 0 |
| moderate | 0 |
| low | 0 |
| info | 0 |
| **total** | **0** |

Le garde-fou CI `npm run audit:strict` (`scripts/audit-ci.js`, sans exception de
sévérité ni `omit=dev`) rend :

```text
LOW=0 MODERATE=0 HIGH=0 CRITICAL=0 TOTAL=0
```

Il refuse aussi une réponse incomplète ou incohérente : un audit indisponible
n'est jamais interprété comme un audit vert.

### Portée exacte de cette mesure

`npm audit` interroge la base d'avis du registre pour les versions **verrouillées**
par `package-lock.json`. Il ne détecte ni une vulnérabilité sans avis publié, ni
un paquet compromis, ni une faille dans notre propre code. C'est un indicateur,
pas une certification.

## 2. Verrou de dépendances et provenance

- `package-lock.json` : `lockfileVersion: 3`, **832** entrées, **827** empreintes
  `integrity`.
- Les quatre entrées sans `integrity` sont des dépendances **locales**
  (`file:vendor/braces-bounded`, plus ses liens) : elles ne viennent pas du
  registre et ne peuvent donc pas porter une SRI de registre.
- Le paquet `braces` est remplacé par un **fork source** local
  (`vendor/braces-bounded`) qui corrige l'avis
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  (dénis de service par expressions/ranges non bornés). La provenance est
  documentée dans `vendor/braces-bounded/README.md` :
  archive `braces@3.0.3` (SHA-1 `490332f4…`), SRI
  `sha512-yQbXgO/OSZVD2IsiLlro+…`, et SHA-256 des fichiers d'origine dans
  `upstream-hashes.json`. Le correctif est local (bornes de profondeur, de
  cardinalité et de taille), pas un simple renommage de paquet.
- Aucune dépendance n'a été ajoutée, retirée ou mise à jour pendant cette
  session : le diff `package.json` ne contient que des scripts.

### Vérification des signatures de paquets — NON VÉRIFIÉE

```bash
npm audit signatures
```

échoue avec une erreur **réseau** dans cet environnement (le point d'accès de
vérification n'est pas joignable). Ce n'est pas un résultat de sécurité : la
vérification de signature n'a **pas eu lieu**. À rejouer sur un poste disposant
d'un accès complet au registre.

## 3. Mises à jour disponibles — décision

`npm outdated` relève **33** dépendances directes en retard. Les écarts majeurs
notables : `next` 15 → 16, `react`/`react-dom` 18 → 19, `prisma`/`@prisma/client`
5 → 7, `tailwindcss` 3 → 4, `eslint` 8 → 10, `vitest` 4 → 5, `zod` 4.3 → 4.6,
`electron` 41 → 44.

**Décision : aucune montée de version effectuée.**
Motifs :

1. aucun avis de sécurité ne l'exige (audit à 0) ;
2. une montée majeure aveugle (Next, React, Prisma, Tailwind, ESLint) casse des
   contrats structurants du dépôt — rendu, génération Prisma, règles de lint —
   et exige une campagne de migration avec régression complète ;
3. la consigne de mission interdit les mises à jour non ciblées sans tests de
   régression et vérification de build.

Les correctifs **mineurs** sûrs ne sont pas appliqués non plus dans cette
session : les mélanger à un correctif fonctionnel rendrait le diff et la
validation illisibles. Ils restent un lot séparé, à valider par la CI complète.

## 4. Contrôles applicatifs prouvés par des tests exécutés

Les sept fichiers suivants ont été lancés ensemble : **216 tests, 216 réussis,
0 échec**.

| Fichier | Ce qui est verrouillé |
|---|---|
| `src/__tests__/security-headers.test.ts` | en-têtes de sécurité (CSP, frame-ancestors, nosniff…) |
| `src/lib/__tests__/secrets.test.ts` | résolution des secrets, refus des valeurs faibles |
| `src/lib/__tests__/secrets-jamais-distribues.test.ts` | aucun secret dans le paquet client |
| `src/lib/__tests__/crash-redaction.test.ts` | rapports de crash expurgés |
| `src/lib/__tests__/quoted-secret-redaction.test.ts` | secrets entre guillemets retirés des logs |
| `src/lib/__tests__/authz-full-matrix.test.ts` | matrice de permissions complète |
| `src/lib/__tests__/security-rate-limit.test.ts` | limitation de débit |

Contrôles spécifiques à la facturation électronique, ajoutés ou revérifiés :

- **SSRF** : destination validée à chaque appel, redirections refusées, DNS
  relu (16 + 9 tests) ;
- **webhooks entrants** : HMAC-SHA256 à temps constant, fenêtre anti-rejeu,
  corps brut signé, idempotence, refus sans écriture (27 tests) ;
- **identifiants de plateforme** : AES-256-GCM, jamais renvoyés au client ;
- **documents** : immutabilité et intégrité couvertes par
  `document-immutability`, `signature`, `record-mac`.

## 5. Scans de secrets

- Le test de politique `tests/secret-scan-policy.test.cjs` vérifie que chaque
  suppression Gitleaks est une **localisation exacte verrouillée par empreinte**
  (959 entrées), et qu'aucune source critique (auth, clé publique) n'est exclue
  en bloc. Résultat : **vert**, y compris après re-triage documenté des 29
  empreintes du fichier de test keygen (snapshot public gelé).
- `npm run test:release-safety` : **155/155**.
- `npm run check:artifact-secrets` n'a **pas pu** s'exécuter : il exige un
  répertoire `dist/` produit par le packaging Windows, absent ici. Il devra
  tourner sur l'artefact réel avant diffusion.

## 6. Risques résiduels et angles morts

| Élément | Statut |
|---|---|
| Acceptation réelle par une PDP | **NON VÉRIFIÉ** — aucun identifiant PDP |
| Vérification des signatures npm | **NON VÉRIFIÉE** — réseau indisponible |
| Tests PostgreSQL (multi-tenant, licences, e-facturation) | **NON EXÉCUTÉS** — moteur Prisma natif absent |
| Exécution de l’installateur Windows | **NON EXÉCUTÉE** — pas de Windows dans l’environnement |
| Test d’intrusion / DAST | **NON RÉALISÉ** |
| Vulnérabilité inconnue (0-day, code interne) | **HORS PORTÉE** de `npm audit` |

Aucune de ces lignes n'est compensée par une affirmation de conformité.

## 7. Reproduire

```bash
npm audit --json --audit-level=low --include=dev --include=optional --include=peer
npm run audit:strict
npm run test:audit
npm run test:release-safety
npx vitest run src/__tests__/security-headers.test.ts \
  src/lib/__tests__/secrets.test.ts \
  src/lib/__tests__/secrets-jamais-distribues.test.ts \
  src/lib/__tests__/crash-redaction.test.ts \
  src/lib/__tests__/quoted-secret-redaction.test.ts \
  src/lib/__tests__/authz-full-matrix.test.ts \
  src/lib/__tests__/security-rate-limit.test.ts
```
