# 09 — Propriété intellectuelle

## 1. Résumé exécutif

La posture de licences des **dépendances** est propre pour une cession (voir `10_THIRD_PARTY_DEPENDENCIES.md`). Le point d'attention PI est la **chaîne de titre (chain of title)** : elle ne peut **pas** être confirmée depuis le code seul et doit être établie **contractuellement**.

## 2. Fichier LICENSE — ajouté, mais non suffisant

Un fichier `LICENSE` a été ajouté cette session dans **les deux dépôts** (`/home/user/GarageFlowsV2/LICENSE`, `/home/user/garagesite3/LICENSE`). Il s'agit d'une licence **propriétaire** (« Proprietary Software License »), tous droits réservés, sans concession de droits hors accord écrit signé.

> **Point crucial :** ce fichier **affirme** le caractère propriétaire du logiciel mais **n'établit ni ne transfère à lui seul la propriété**. Le fichier lui-même le précise (« NOTE ON CHAIN OF TITLE … does NOT by itself establish or transfer ownership »). **La cession de PI reste un acte contractuel.**

À l'origine (au moment de l'audit), **aucun** fichier LICENSE ni cession de PI n'existait dans les dépôts (les deux marqués `private:true`) — d'où le statut « non-operational / IP ownership documentation » de l'inventaire.

## 3. Bloqueur P0 — cession de PI écrite

La cession de propriété intellectuelle est l'un des **quatre bloqueurs P0** de l'opération (avec les clés privées, le backend, et les domaines — voir `07_DEPLOYMENT_MODEL.md`).

**Exigence de closing :** une **cession de PI écrite** couvrant :
- les **deux codebases** (`GarageFlowsV2` desktop et `garagesite3` cloud) ;
- tous les **actifs de marque** dans `public/` (logos, icônes PWA — qui apparaissent être les actifs propres de la cible) ;
- la marque/le nom « GarageFlow » et les domaines associés ;
- le droit de recevoir et d'exploiter les **clés privées de signature**.

## 4. Ce que la diligence NE peut PAS confirmer depuis le code

| Élément | Statut de vérification |
|---|---|
| Chaîne de titre / propriété exclusive du code | **Non vérifiable** depuis le dépôt — repose entièrement sur le contrat de cession (non vu) |
| Existence/validité/propriété exclusive des clés privées de signature | **Non vérifiable** — affirmées server-side, absentes du dépôt |
| Propriété des domaines garageflows.fr, DNS, hébergement | **Non vérifiable** depuis le dépôt |
| Contributions de tiers / sous-traitants (droits d'auteur) | **Non audité** — à couvrir par déclarations et garanties vendeur |
| Actifs de marque : originalité / droits sur les logos | Apparaissent propres à la cible ; **aucune police tierce bundlée** (pas de `.woff/.ttf/.otf`) |

## 5. Posture de licences des dépendances (propre)

Résumé — détail dans `10_THIRD_PARTY_DEPENDENCIES.md` :
- **Toutes les dépendances directes** des deux dépôts sont **permissives** (MIT/ISC/Apache-2.0/BSD).
- **Aucun copyleft fort** (GPL/AGPL/SSPL) nulle part.
- Copyleft limité au **transitif à faible risque** : LGPL-3.0 via `@img/sharp-libvips` (natif, lié dynamiquement, outillage build/dev) et MPL-2.0 file-level (axe-core, lightningcss, dompurify dual-licensed Apache) dans l'outillage build/test.
- `@anthropic-ai/sdk` (v0.79.0, MIT) : optionnel, bien abstrait, dégradation gracieuse sans clé — aucun lock-in.

## 6. Actions recommandées (closing)

- [ ] **Cession de PI écrite** couvrant les deux codebases + actifs de marque + nom/marque GarageFlow.
- [ ] **Déclarations et garanties vendeur** sur la propriété exclusive et l'absence de revendications de tiers/sous-traitants.
- [ ] Transfert vérifié des **clés privées de signature** (voir `07_DEPLOYMENT_MODEL.md`).
- [ ] Transfert des **domaines** garageflows.fr et DNS.
- [ ] Confirmation que `sharp`/libvips reste **lié dynamiquement et non modifié** (conformité LGPL) — voir `10_THIRD_PARTY_DEPENDENCIES.md`.

Voir aussi `docs/IP_ASSET_REGISTER.md`.

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
