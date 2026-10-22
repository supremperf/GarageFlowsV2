---
doc-numbers: journal
---

# Actions manuelles restantes

Liste arrêtée au 22 octobre 2026. Les actions sont ordonnées par dépendance. Aucune modification de production ne doit être faite sans autorisation explicite.

## P0 — débloquer une release candidate

### 1. Rétablir la toolchain Prisma officielle

**Environnement :** machine de build avec accès réseau approuvé, idéalement Windows x64 pour l’artefact final.  
**Action :** permettre le téléchargement/vérification des moteurs Prisma 5.22.0 ou fournir un cache officiel contrôlé.  
**À ne pas faire :** utiliser `/dev/null`, un client `noEngine`, WASM ou un autre moteur comme preuve SQLite/PostgreSQL.  
**Preuve attendue :** `npm ci`, génération des deux clients et `npm run build` réussis ; moteurs natifs identifiés.

### 2. Rejouer la suite DB complète sur bases isolées

**Action :** exécuter Vitest avec les moteurs natifs, SQLite temporaire et PostgreSQL/Redis de test.  
**Preuve attendue :** 0 fichier en échec ; résultat explicite de `tenant-isolation.test.ts`, sync, backup/restore et préparation DB.  
**Contrainte :** aucune base existante réinitialisée ; aucun `--force-reset`.

### 3. Réconcilier SBOM et notices tierces

**Constat :** notice actuelle 98 composants ; inventaire installé 132 entrées racine comprise ; SBOM npm 96/102 selon le mode. Des dépendances optionnelles natives ne sont pas couvertes uniformément.  
**Action :** inventorier le contenu du paquet Windows réel, associer versions/licences/textes, régénérer les notices sans réduire le périmètre et faire relire les obligations LGPL/CC-BY.  
**Preuve attendue :** correspondance paquet ↔ SBOM ↔ notices, avec revue humaine.  
**À ne pas faire :** régénérer depuis la SBOM actuellement incomplète et considérer le problème résolu.

### 4. Produire et inspecter Windows

**Action :** exécuter `npm run dist` sur Windows après les points 1 à 3.  
**Preuves attendues :** `GarageFlows-Setup.exe`, `win-unpacked`, fuses, scan NSIS/secrets, signature, empreinte, notices et `verify:installer`.  
**État actuel :** non exécuté ; aucun artefact Windows.

## P1 — valider les environnements et parcours

### 5. Configurer staging sans secrets inventés

- PostgreSQL/Neon et `DIRECT_URL` si requis ;
- Redis/Upstash pour le rate limiting distribué ;
- URL HTTPS, proxy de confiance et NextAuth ;
- secrets distincts pour appareils, MAC, portail, SMTP, TOTP, sauvegarde et facturation ;
- stockage durable de sauvegarde adapté à Vercel ;
- valeurs conservées dans un coffre, jamais dans les livrables.

**Preuve attendue :** démarrage de production accepté par l’instrumentation, health DB vert, aucune valeur secrète dans les logs.

### 6. Exécuter les navigateurs et appareils

- installer les navigateurs Playwright approuvés ;
- exécuter les 144 scénarios sur la cible de test ;
- couvrir WebKit/Safari et les appareils PWA retenus si inclus dans la release ;
- joindre traces/vidéos des échecs et résultats, sans données secrètes.

**État actuel :** 144 tests listés, 0 exécuté.

### 7. Tester les services externes avec des comptes de test

| Service | Parcours minimal |
|---|---|
| SMTP | envoi, réception, expiration des liens |
| portail | inscription, login, 2FA, devis/signature, tickets |
| facturation électronique | sandbox, file, webhook et reprise d’erreur |
| mise à jour | manifeste signé, téléchargement, rejet d’une signature invalide |
| OCR | Tesseract local ou provider approuvé, sans confondre avec Copilot |
| synchronisation | aller/retour, conflits, tombstones, photos et reprise offline |

**Interdiction :** ne pas transformer un mock ou une sortie 0 sans cible en preuve de connexion.

### 8. Valider Windows métier et données

- poste vierge et mise à niveau d’une copie de données existantes ;
- activation d’une licence de test existante et compatibilité HWID V1 ;
- migrations, CRUD, isolation, photos, backup/restore ;
- offline/reprise, mise à jour et retour arrière applicatif ;
- ACL NTFS et conservation des données après désinstallation.

## P1 — compléter la sécurité de la chaîne source

### 9. Exécuter un scanner Git adapté

**Action :** exécuter Gitleaks ou l’outil approuvé sur le working tree et, selon la politique, l’historique.  
**Contexte :** le téléchargement Gitleaks a échoué dans le sandbox ; `npm run scan:secrets` est un outil OCR de captures, pas un scan Git.  
**Preuve attendue :** version de l’outil, configuration, périmètre, nombre de fichiers/commits et findings triés.  
**À ne pas faire :** utiliser un scan de 0 fichier ou uniquement le standalone comme preuve pour le dépôt.

### 10. Revoir les dépendances outdated

**Action :** trier les 32 dépendances directes obsolètes, consulter les changelogs et proposer des mises à jour par petits lots avec tests.  
**Contrainte :** pas de `npm audit fix --force`, pas de majors groupées sans revue.  
**État actuel :** audit de vulnérabilités vert, lockfile inchangé.

## P2 — revue et gouvernance

### 11. Relire les changements locaux

Les corrections et documents ne sont pas commités. Effectuer une revue de diff, rejouer les contrôles finaux et décider de leur intégration. Tout commit/push nécessite l’autorisation demandée par l’utilisateur ; la branche Arena de session ne doit pas être renommée ni remplacée.

### 12. Réexaminer le verdict

N’envisager un nouveau verdict qu’avec les preuves P0/P1 du périmètre de livraison. Le verdict courant reste **NON PRÊT POUR LA PRODUCTION**. Les éléments favorables et les limites sont détaillés dans `AUDIT_COMPLET.md` et `PRODUCTION_READINESS.md`.
