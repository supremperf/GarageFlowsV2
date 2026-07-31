# GarageFlow — Contenu de présentation acquéreur (slide par slide)

*Contenu texte destiné à alimenter un deck. Factuel. Aucune traction/revenu/client inventé. Les chiffres techniques sont vérifiés en première main (2026-07-31).*

---

## Slide 1 — Titre

**GarageFlow** — Logiciel de gestion d'atelier automobile pour garages indépendants.
Desktop Electron + PWA + control-plane cloud. Dossier de cession technique.
Fourchette de valorisation cible : 150 k – 350 k EUR.

*Note orateur : positionner immédiatement l'objet de la vente — un socle logiciel opérationnel, pas un fonds de commerce ; les données commerciales/clients sont à diligencer séparément et ne sont pas affirmées ici.*

---

## Slide 2 — La thèse en une phrase

Un **socle sécurité + licensing + control-plane de qualité production-candidate**, entouré d'un large fonctionnel métier automobile, avec une posture PI/dépendances propre — dont l'acquisition économise **plusieurs mois-ingénieur** de construction d'infrastructure.

*Argument : la valeur est le time-to-market et le risque évité, pas le volume de code.*

---

## Slide 3 — Ce qui est livré (3 artefacts, 1 socle)

- **Desktop Electron** : Next.js 14 standalone embarqué sur 127.0.0.1, SQLite/Prisma, **37 modèles**, **125 routes API**.
- **PWA** : dérivée du même code applicatif.
- **Control-plane cloud** (garagesite3) : Next.js 15 + PostgreSQL, **13 modèles**, **56 routes API** ; émet les licences, publie et signe les mises à jour, agrège les crash reports.

---

## Slide 4 — Fonctionnel métier automobile (construit)

Modules opérationnels au niveau API/UI (routes réelles) :
clients • véhicules • ordres de réparation / work-orders • devis • factures • rendez-vous & planning • catalogue pièces • opérations de main-d'œuvre • inspections • décodage VIN • OCR plaque / lookup plaque • stock & prévision de stock • fournisseurs • bons de commande • garanties • prêt de véhicule (loaner) • rapports • tableau de bord financier & rentabilité • Copilot (couche LLM provider-agnostique).

*Note : « construit » = code + route présents ; certaines fonctions transverses restent « façade » (voir slide risques).*

---

## Slide 5 — Sécurité (différenciateur clé)

- Isolation renderer Electron : `contextIsolation`, `sandbox`, `nodeIntegration:false`, navigation confinée au loopback.
- Serveur Next.js embarqué lié **uniquement** à 127.0.0.1.
- Mises à jour **signées Ed25519**, hash **SHA-256 vérifié avant exécution** de l'installeur, anti-downgrade, allowlist d'hôtes.
- Licence **ECDSA P-256** (clé publique embarquée ; clé privée côté serveur).
- Sauvegardes **AES-256-GCM** authentifiées ; tokens device **HMAC** révocables ; comparaisons **timing-safe** partout.
- Score sécurité de l'audit interne : **70/100**.

---

## Slide 6 — Licensing & control-plane (l'actif réel)

- Vérification asymétrique + contrôle de sièges **transactionnel TOCTOU-safe** (`SELECT … FOR UPDATE` + recomptage).
- Rate-limiting **distribué fail-closed** (Upstash Redis) sur les routes sensibles.
- Validation d'environnement **fail-closed** au boot en production.
- Publication de release + rollout/rollback manuel ; crash reporting ; modules/entitlements ; notifications ; audit log.
- **135 tests unitaires** sur ce cœur (control-plane).

---

## Slide 7 — Qualité & CI (réduction de risque)

- **~857 cas de test backend** (~87 fichiers), faible taux de mock, tests d'intégration réels sur SQLite/route-handlers.
- Résultats vérifiés cette session : GarageFlowsV2 **678/0**, garagesite3 **140/0** ; `tsc --noEmit` propre des deux côtés.
- CI dans les deux dépôts : typecheck + lint + build + migrations sur Postgres vierge + tests sur **Postgres 16 + Redis 7 réels** + gitleaks + audit de dépendances.
- Isolation multi-tenant **prouvée par tests** (401 sans session / 403 cross-garage / 403 device révoqué).

---

## Slide 8 — PI & dépendances (transférabilité)

- **Toutes les dépendances directes permissives** (MIT/ISC/Apache/BSD) dans les deux dépôts.
- **Aucun GPL/AGPL/SSPL** ; copyleft limité à du transitif faible risque (LGPL sharp/libvips, MPL au niveau fichier sur outillage).
- SDK Anthropic **optionnel**, bien abstrait, dégradation gracieuse sans clé API — pas de lock-in fournisseur IA.
- Voir `docs/SBOM.md` et `docs/OPEN_SOURCE_LICENSE_AUDIT.md`.

---

## Slide 9 — Time-to-market : ce que l'acquéreur n'a PAS à construire

Infrastructure déjà en place (à valoriser comme mois-ingénieur évités) :
socle d'authentification/session multi-tenant • système de licence asymétrique + sièges • pipeline de mise à jour signée vérifiée • sauvegardes chiffrées • rate-limiting distribué • crash reporting • control-plane de release • suite de tests + CI complète • documentation d'architecture et d'exploitation.

---

## Slide 10 — Risques à traiter (honnêteté)

- **P0 (hors dépôt)** : clés privées de signature + backend + domaines garageflows.fr + cession de PI. Sans transfert, **produit inexploitable/non monétisable**.
- **Facturation électronique** : zéro implémentation ; chantier pluri-mensuel avant mandat 2026-2027.
- **API /api/v1** : démo in-memory non persistante.
- **Absents** : import CSV/Excel, tests E2E, hiérarchie multi-garage. Signature de code Windows non configurée ; verrou hors-ligne 72 h.

---

## Slide 11 — Scores de maturité (audit interne)

| Dimension | Score /100 |
|---|---|
| Technique | 60 |
| Sécurité | 70 |
| Transférabilité | 45 |
| Démonstrabilité | 57 |
| **Global** | **54** |

---

## Slide 12 — Valorisation & prochaines étapes

- Fourchette **150 k – 350 k EUR** : plancher soutenu par le socle sécurité/licensing + PI propre ; plafond bridé par l'exploitabilité dépendante d'actifs externes et l'écart facturation électronique.
- Étapes proposées : (1) NDA + accès data room, (2) démo technique + métier, (3) vérification P0 (mint d'une licence + signature d'une mise à jour de bout en bout par l'acquéreur), (4) structuration (voir `TRANSACTION_STRUCTURES.md`).

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.*
