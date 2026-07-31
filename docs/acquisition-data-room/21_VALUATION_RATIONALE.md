# 21 — Logique de valorisation (rationale)

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> **Avertissement — aucun prix n'est affirmé comme un fait.** Ce document expose une **logique défendable** pour situer GarageFlow dans la fourchette cible **150 k€ – 350 k€**, en exposant honnêtement les facteurs de valeur ET les détracteurs. La valeur réelle dépend de fondamentaux business (revenus, traction, churn) **non audités** et à diligencer séparément. Les chiffres sont des **repères de raisonnement**, pas une offre.

## 1. Base de raisonnement — coût de remplacement

Le coût de reconstruction d'un équivalent (`19_RECONSTRUCTION_COST_ANALYSIS.md`) est estimé à **~180 k€ – 450 k€** (médian ~250–280 k€). Reconstruire un équivalent *fonctionnel et vendable* (avec e-invoicing, signature de code, E2E, import) coûterait davantage. Ce coût de remplacement **soutient le plancher** de la fourchette : l'ingénierie déjà réalisée — surtout le cœur sécurité/licensing — dépasse largement 150 k€ en valeur de reconstruction.

## 2. Facteurs de VALEUR (ce qui tire vers le haut)

1. **Cœur sécurité/licensing d'ingénierie supérieure** — isolation renderer Electron, updates signés Ed25519 (SHA-256 avant exécution, anti-downgrade), backups AES-256-GCM, jetons device HMAC, sièges TOCTOU-safe, isolation multi-tenant **prouvée par tests**. C'est l'actif rare et différenciant.
2. **Control-plane réel et DB-backed** (ES256, rate limiting fail-closed, validation d'env au boot) — 135 tests unitaires verts.
3. **Suite de tests substantielle** (~857 cas, faible mocking) derrière une CI complète sur 2 dépôts.
4. **Time-to-market évité** : ~18–30 mois de reconstruction contournés (valeur d'option pour un acquéreur pressé d'entrer sur le marché).
5. **Posture PI/dépendances propre** : direct deps permissifs (MIT/ISC/Apache/BSD), **aucun GPL/AGPL**, copyleft limité au transitif faible (LGPL sharp / MPL tooling).
6. **Fondations de valeur latentes** : white-label typé bien conçu (à câbler), backup chiffré production-grade (sans UI) — réduisent le coût de build futur.
7. **Fondamentaux de facturation compliance-grade** : numérotation transactionnelle gap-safe, immutabilité des factures émises, TVA en centimes exacts.
8. **Pas de verrouillage fournisseur IA** : features optionnelles bien abstraites, Copilot provider-agnostique.

## 3. Facteurs de DÉTRACTION (ce qui plafonne / escompte)

1. **Dépendance d'opérabilité hors code** : produit **inexploitable sans transfert** des clés privées + backend + domaines — **non vérifiables** par la diligence. Risque d'exécution majeur.
2. **Zéro e-invoicing** sur le marché cible face au **mandat légal FR 2026-2027** : chantier multi-mois **obligatoire** avant usage légal B2B.
3. **Fonctionnalités façade-deep** : API v1 démo en mémoire, white-label non câblé, backup/monitoring sans UI — le produit « montrable » excède le produit « utilisable ».
4. **Pas d'import de données** (coût d'onboarding élevé) ni **hiérarchie multi-garage** (thèse roll-up = redesign).
5. **Frictions de déploiement réel** : binaire Windows non signé (SmartScreen), verrou 72 h hors-ligne (`app.quit()`).
6. **Zéro couverture de test UI/E2E** sur 3 surfaces → vélocité de refactor contrainte.
7. **Durcissements sécurité restants** : clé admin unique partagée (pas d'IAM/MFA), bypass 2FA, TOTP en clair, anti-tamper JS-only.
8. **Dette de maintenance** : Electron 31, Next 14/15 split, next-auth v4, migrations desktop non reproductibles.
9. **Fondamentaux business non audités** : sans revenu/traction prouvés, la valeur repose sur l'actif technique, pas sur un going concern.

## 4. Trois scénarios de valorisation (avec conditions explicites)

> Chaque scénario est **conditionnel**. Le prix se déplace vers le haut **uniquement si** les conditions listées sont remplies et vérifiées.

### Scénario A — Prudent : **150 – 200 k€**
**Positionnement** : valeur d'actif technique escomptée pour le risque d'opérabilité, sans preuve de marché.
**Conditions** :
- Les 4 transferts P0 sont **contractualisés** mais l'opérabilité end-to-end reste à prouver post-close (ou re-keying à faire).
- Aucune traction commerciale prouvée ; achat sur la base du code + sécurité.
- L'acquéreur absorbe seul les coûts e-invoicing, signature de code, E2E.
**Justification** : sous le coût de reconstruction médian, escompté pour le risque d'exécution et les écarts. **C'est la fourchette défendable au vu de l'état actuel** (voir §6).

### Scénario B — Stratégique : **200 – 275 k€**
**Positionnement** : opérabilité prouvée + acquéreur avec un usage stratégique clair.
**Conditions** :
- Validation E2E réussie **sans le vendeur** (5 étapes de `17_`) — opérabilité **démontrée**.
- Transferts P0 exécutés et vérifiés (clés, backend, domaines, cession PI).
- Correctifs sécurité pré-close (2FA, TOTP, IAM plan) engagés.
- L'acquéreur a un canal de distribution (ex. distributeur pièces / réseau) qui valorise le time-to-market.
**Justification** : au niveau du coût de reconstruction médian, l'opérabilité prouvée retirant le principal risque.

### Scénario C — Premium : **275 – 350 k€**
**Positionnement** : haut de fourchette — **exige un acquéreur stratégique + preuve de marché + partenariat/earn-out**.
**Conditions cumulatives** :
- Tout le Scénario B, **plus** :
- **Preuve de marché** : clients réels/revenu récurrent audités (fondamentaux business aujourd'hui non vérifiés).
- **Acquéreur stratégique** pour qui le produit débloque une valeur adjacente (canal pièces, réseau de garages) supérieure à la valeur intrinsèque.
- Structure de deal atténuant le risque : **earn-out / partnership** liant une partie du prix à des jalons (e-invoicing livré, N garages déployés, traction).
- Roadmap e-invoicing **cadrée et chiffrée**, signature de code obtenue.
**Justification** : le plafond n'est **pas** justifié par l'état technique seul ; il requiert une valeur stratégique externe + un partage de risque contractuel.

## 5. Synthèse — table des scénarios

| Scénario | Fourchette | Condition déterminante |
|---|---|---|
| A — Prudent | **150 – 200 k€** | P0 contractualisés, opérabilité non encore prouvée, pas de traction |
| B — Stratégique | **200 – 275 k€** | Opérabilité **prouvée E2E** + acquéreur à usage stratégique |
| C — Premium | **275 – 350 k€** | B + **preuve de marché** + acquéreur stratégique + **earn-out/partenariat** |

## 6. Fourchette défendable aujourd'hui = le PLANCHER

**Au vu de l'état actuel** — opérabilité contingente à des transferts non vérifiés, e-invoicing absent, features façade-deep, aucune preuve de marché dans le périmètre audité — la fourchette **défendable sans conditions supplémentaires est le Scénario A (150 – 200 k€), soit le PLANCHER de la cible**. Monter vers 275–350 k€ **exige** de lever explicitement les conditions des scénarios B puis C. Le coût de reconstruction (§1) empêche de descendre sous ce plancher : il y a une valeur d'ingénierie réelle et substantielle, même escomptée.

## 7. Rappel d'honnêteté

Aucun prix ici n'est un fait. La valeur finale se négocie sur des éléments **hors périmètre du code** (revenus, clients, contrats, propriété effective des actifs externes) que cette due diligence technique **n'a pas pu vérifier** et qui doivent être diligencés séparément.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
