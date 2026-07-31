# GarageFlow — FAQ acquéreur

*Réponses factuelles pour la data room. Chiffres techniques vérifiés en première main (2026-07-31). Aucune donnée commerciale/financière/client n'est affirmée.*

---

### Q1. Qu'achète-t-on exactement ?

Un logiciel de gestion d'atelier automobile en trois artefacts partageant un socle : application desktop Electron (GarageFlowsV2), PWA dérivée, et control-plane cloud + vitrine (garagesite3). Plus la marque, les domaines, le backend et les clés de signature (ces derniers **hors dépôt**, à transférer).

### Q2. Le produit est-il exploitable en l'état ?

Non, pas sans transfert d'actifs externes. Les **clés privées de signature** (licence ECC P-256, mise à jour Ed25519) sont côté serveur uniquement ; le **backend control-plane**, la base et les **domaines garageflows.fr** sont hors dépôt. Sans eux, impossible d'émettre une licence ou de signer une mise à jour. Ce sont les **bloquants P0**.

### Q3. Quelle est la qualité du code ?

Le socle sécurité/licensing/backend est de qualité « production-candidate ». Vérifié cette session : GarageFlowsV2 **678 tests passés / 0 échec** ; garagesite3 **140 tests passés / 0 échec** ; `tsc --noEmit` propre des deux côtés. ~857 cas de test backend au total, CI complète (typecheck, lint, build, tests sur Postgres/Redis réels, gitleaks, audit de dépendances).

### Q4. Quels sont les scores de maturité ?

Audit interne : technique **60/100**, sécurité **70/100**, transférabilité **45/100**, démonstrabilité **57/100**, global **54/100**.

### Q5. Y a-t-il de la facturation électronique ?

Non. **Aucune** implémentation Factur-X/UBL/CII, aucun Chorus Pro/PDP, aucun e-reporting. TVA mono-taux en-tête (pas de ventilation par ligne EN16931), pas de SIRET acheteur snapshotté, pas de modèle Avoir ni Paiement, dates en chaîne. Chantier pluri-mensuel avant conformité au mandat français 2026-2027. Les fondamentaux de facturation (numérotation sans trou, immuabilité, TVA en centimes entiers, export FEC) sont en revanche sains.

### Q6. L'« API ouverte » est-elle utilisable ?

Non en production. `/api/v1` est un **bac à sable in-memory non persistant** (documenté dans le code) qui perd les données au cold start serverless et n'a pas de webhooks. La rendre réelle nécessite persistance + autorisation + rate-limiting distribué + webhooks.

### Q7. Peut-on migrer les données d'un garage existant ?

Pas via un outil intégré. **Aucun assistant d'import** CSV/Excel (pas de parser, pas de mapping, pas de dry-run) ; le CSV est export-only. Migration = développement additif.

### Q8. Peut-on gérer plusieurs garages / un réseau ?

Pas nativement. Le schéma s'arrête à un `Garage` unique par installation ; **pas d'entité Organisation/Réseau** au-dessus. Le « multi-garage » existe comme capacité de licensing/déploiement (N installations) mais **pas** comme hiérarchie opérationnelle avec reporting consolidé. Une refonte schéma + contrôle d'accès serait requise.

### Q9. Le produit fonctionne-t-il hors-ligne ?

Partiellement, avec une limite forte : grâce hors-ligne de 48 h (avertissement) puis **verrou dur à 72 h** qui appelle `app.quit()`. Pour des garages mal connectés, c'est une limitation de disponibilité à ré-architecturer.

### Q10. Le binaire Windows est-il signé ?

Non. Aucune signature de code configurée dans electron-builder ⇒ SmartScreen « éditeur inconnu ». Un certificat OV/EV à procurer et câbler. Seule cible : Windows x64 (pas de macOS/Linux/arm64).

### Q11. Y a-t-il des tests d'interface / E2E ?

Non. Aucun Playwright/Cypress ni test de composant `.tsx` ; la couche UI est validée manuellement. Le backend est en revanche largement couvert. Couverture mesurée (v8) mais **non bloquante**.

### Q12. Quelle est la posture de propriété intellectuelle et de licences open source ?

Toutes les dépendances **directes** des deux dépôts sont permissives (MIT/ISC/Apache/BSD) ; **aucun GPL/AGPL/SSPL**. Copyleft limité à du transitif faible risque (LGPL sharp/libvips, MPL au niveau fichier sur outillage). Voir `docs/SBOM.md` et `docs/OPEN_SOURCE_LICENSE_AUDIT.md`. **Attention** : aucun fichier LICENSE ni assignation de PI dans les dépôts ⇒ la chaîne de titre repose sur la cession écrite à formaliser au closing.

### Q13. Y a-t-il un verrouillage à un fournisseur d'IA ?

Non. Le SDK Anthropic est **optionnel**, bien abstrait, activé par une clé API facultative et dégradé gracieusement en son absence ; la couche Copilot est provider-agnostique. Le produit s'exécute sans aucune dépendance IA.

### Q14. Comment les données des locataires (garages) sont-elles isolées ?

Isolation multi-tenant en profondeur, **prouvée par tests** : 401 sans session, 403 pour la licence d'un autre garage, 403 pour un device révoqué. Scoping `where:{id, garageId}` sur les routes métier + garde de relation anti-IDOR 2nd-order.

### Q15. Quels sont les points de sécurité à durcir avant une exploitation en équipe ?

Back-office admin à **clé statique partagée unique** (pas d'IAM par opérateur/MFA/RBAC), portail 2FA avec contournement de rate-limit possible (X-Forwarded-For non filtré) et secrets TOTP stockés en clair, anti-tamper local JS-only contournable. Aucun n'est catastrophique ; chacun est un item de durcissement à budgéter.

### Q16. Que faut-il vérifier absolument en due diligence ?

L'existence, la validité et l'exclusivité des **clés privées** ; la propriété des **domaines** et l'accès au **backend/base** ; la **chaîne de titre** de la PI. Ces éléments **ne sont pas vérifiables depuis le code** et gouvernent l'exploitabilité — voir les caveats honnêtes de l'audit.

### Q17. Comment se déroule le transfert ?

Par transferts d'actifs conditionnels (clés en séquestre, paiement de transfert lié à un test d'exploitabilité de bout en bout). Voir `docs/TRANSFER_PLAYBOOK.md` et `docs/buyer-package/TRANSACTION_STRUCTURES.md`.

### Q18. Pourquoi la fourchette 150 k – 350 k EUR ?

Le socle sécurité/licensing et la posture PI/dépendances propre soutiennent le **plancher** ; la dépendance d'exploitabilité aux actifs externes, l'écart facturation électronique et les fonctions « façade » (white-label peu câblé, backup sans UI, API démo) plaident contre le **plafond**. Le positionnement dans la fourchette dépend du profil acquéreur et de la structuration.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
