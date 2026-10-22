---
doc-numbers: journal
---

# Sécurité — état vérifié et exigences de livraison

Audit daté du 22 octobre 2026, base `150654535ca0b3b417e96be057ba674a119c512f` plus les corrections locales décrites dans `CORRECTIONS_EFFECTUEES.md`.

## 1. Résultat synthétique

Les contrôles statiques, l’audit NPM, les gardes Electron et le scan du standalone sont favorables dans leur périmètre. La sécurité de la release n’est néanmoins pas démontrée de bout en bout : runtime DB, tests d’intégration bloqués, paquet Windows, historique Git et services externes restent à valider.

## 2. Mesures réellement observées

### Application HTTP

Le smoke standalone a observé sur `/login` :

- CSP avec `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'` et `form-action 'self'` ;
- `X-Frame-Options: DENY` ;
- `X-Content-Type-Options: nosniff` ;
- `Referrer-Policy: strict-origin-when-cross-origin` ;
- `Permissions-Policy: camera=(), microphone=(), geolocation=()` ;
- HSTS `max-age=63072000; includeSubDomains`.

La CSP autorise encore `'unsafe-inline'` pour scripts et styles. Ce n’est pas une vulnérabilité démontrée à elle seule, mais une réduction de défense en profondeur à conserver dans la revue XSS.

Sans session, le smoke donne `/api/clients` → 401 et `/api/admin/licenses` → 403. Cela ne remplace pas les tests d’autorisation de chaque route.

### Validation de configuration

Un lancement avec `NODE_ENV=production` hors contexte Electron a été refusé pour : SQLite en PWA, pepper absent, Redis distribué absent et proxy de confiance non déclaré. Ce comportement fail-closed est attendu. Aucune valeur de production n’a été injectée pour contourner ce refus.

### Electron

Les fenêtres inspectées dans `electron/main.js` déclarent notamment :

- `contextIsolation: true` ;
- `nodeIntegration: false` ;
- `sandbox: true` ;
- `webSecurity: true` ;
- `allowRunningInsecureContent: false` sur la fenêtre principale inspectée.

`npm run check:desktop-audit` termine avec 0 alerte. Ce contrôle statique ne valide ni les fuses du binaire Electron final ni le comportement Windows.

### Secrets et artefact

- `.env` local ignoré, mode `600`, sans valeur secrète dans les livrables ;
- post-build : aucun `.env` dans le standalone et aucune clé privée purgée restante ;
- scan du standalone : 2 827 fichiers, une valeur de secret local traquée, aucune détection ;
- scan des preuves : 26 journaux texte + `SHA256SUMS`, soit 27 fichiers réellement lus, aucune détection ;
- scan ciblé du working tree non ignoré : 2 750 fichiers texte, 104 binaires exclus, aucune détection ;
- clé publique existante seule matérialisée ; aucune clé privée créée ou remplacée.

Ces scans ne couvrent pas tous les types de secrets et ne remplacent pas un scanner Git sur le working tree et l’historique.

## 3. Authentification, licences et isolation

### API

L’annexe d’`AUDIT_COMPLET.md` liste 169 routes, leurs méthodes et les marqueurs extraits statiquement : wrappers `withAuth`, portail, mécanicien, licence garage, session admin, clé interne, JWT, `x-gf-key`, etc. Cette cartographie doit servir à la revue d’autorisation ; la présence d’un marqueur ne prouve pas le bon périmètre garage/objet.

### Isolation multi-tenant

`tenant-isolation.test.ts` prévoit deux garages et vérifie relations FK, lectures et écritures atomiques. Dans cet audit, le test n’aboutit pas : le client généré `noEngine` exige un protocole Data Proxy et ne peut pas utiliser la copie SQLite temporaire. L’isolation est donc **partiellement validée par les autres tests, non validée ici par ce scénario DB réel**.

### Licences et HWID

- les suites Python/keygen et trois suites Vitest dédiées sont vertes dans leur périmètre ;
- HWID V1 n’a pas été modifié ;
- les tests de non-remplacement de clés privées passent ;
- la compatibilité avec les licences réellement émises doit néanmoins être revérifiée sur Windows avec une licence de test existante, sans régénérer l’autorité.

## 4. Constats de sécurité ouverts

| ID | Sévérité release | Constat | Preuve/limite | Action de clôture |
|---|---|---|---|---|
| SEC-01 | P0 | moteur Prisma natif absent | build officiel en échec TLS ; health 503 | build officiel + tests DB avec moteur attendu |
| SEC-02 | P0 | paquet Windows non inspecté | aucun `dist/GarageFlows-Setup.exe` | fuses, NSIS, secrets, signature et essais Windows |
| SEC-03 | P0 | notices de l’artefact non réconciliées | 98 notices ; inventaires npm/SBOM divergents | générer depuis le paquet réel et revue licence |
| SEC-04 | P1 | intégration DB incomplète | 80 fichiers Vitest en échec d’infrastructure | exécuter sur moteurs natifs et bases isolées |
| SEC-05 | P1 | scan Git spécialisé non exécuté | Gitleaks indisponible ; `scan:secrets` = OCR | exécuter Gitleaks sur working tree et historique en CI |
| SEC-06 | P1 | services externes non testés | aucune connexion PostgreSQL/Redis/SMTP/etc. | staging avec comptes et données de test |
| SEC-07 | P1 | navigateurs non testés | 144 tests listés, 0 exécuté | Playwright avec navigateurs installés |

Aucun de ces constats ne doit être converti en « vulnérabilité exploitable » sans preuve supplémentaire. Ce sont des portes de preuve et de livraison.

## 5. NPM et supply chain

- `npm run audit:strict` : 0 vulnérabilité aux quatre niveaux au moment du contrôle ;
- arbre `npm ls` : aucun problème reporté ;
- supply-chain : 23/23 ;
- 32 dépendances directes apparaissent outdated : revue planifiée, pas de mise à jour forcée ;
- les paquets natifs Prisma/Sharp et les outils Electron doivent être vérifiés sur la plateforme cible, pas seulement sur Linux.

## 6. Politique de manipulation des secrets pour la release

1. générer les secrets dans le coffre ou sur la cible, jamais dans un ticket, une conversation ou un journal ;
2. ne pas recopier les secrets desktop dans Vercel, ni les secrets serveur dans un poste desktop ;
3. conserver séparés NextAuth, pepper appareils, MAC DB, portail, SMTP, TOTP, sauvegarde et facturation ;
4. ne pas supprimer les clés `*_OLD` tant que des cryptogrammes dépendent encore de l’ancienne version ;
5. ne jamais régénérer l’autorité P-256 ou les clés Ed25519 de publication sans procédure approuvée de compatibilité ;
6. vérifier les ACL NTFS sur Windows et les permissions `600` sur POSIX ;
7. contrôler l’artefact final après packaging, pas seulement les sources.

## 7. Commandes de contrôle à rejouer

```bash
npm run check:consistency
npm run check:desktop-audit
npm run audit:strict
npm run test:release-safety
npm run preflight:release
```

Après un build officiel réussi :

```bash
npm run verify:standalone
node scripts/check-artifact-secrets.mjs .next/standalone
npm run dist
```

`npm run dist` enchaîne déjà les contrôles d’artefact prévus par le projet. Son exécution n’est pertinente qu’avec les moteurs natifs et sur la cible Windows. Les résultats doivent être conservés sans secrets avec leurs empreintes.
