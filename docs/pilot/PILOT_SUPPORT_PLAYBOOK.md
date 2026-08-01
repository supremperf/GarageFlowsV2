# Playbook de support pilote

> **MODÈLE — NON SIGNÉ.** À adapter aux ressources réelles de l'équipe.

## Canaux
- Canal principal : [e-mail support / messagerie dédiée].
- Urgences (blocage total) : [téléphone / astreinte].
- Documentation self-service : `../BUYER_TECHNICAL_FAQ.md`, `../LOCAL_DEVELOPMENT.md`.

## Niveaux de gravité & délais cibles (indicatifs)
| Gravité | Exemple | Réponse cible | Contournement |
|---|---|---|---|
| P1 bloquant | Impossible de facturer / app ne démarre pas | [2 h ouvrées] | Restauration sauvegarde |
| P2 majeur | Fonction clé dégradée | [1 j ouvré] | Alternative documentée |
| P3 mineur | Gêne, cosmétique | [3 j ouvrés] | Suivi backlog |

_Ces délais sont des cibles internes de pilote, **pas un SLA contractuel**._

## Procédure incident
1. Recueillir : version, OS, étapes, capture, logs (`userData/garageflow.log`).
2. Reproduire ; classifier la gravité.
3. Contournement immédiat si possible (ex. sauvegarde/restauration).
4. Correctif (branche → test → release) si dans le périmètre IA/équipe.
5. Journaliser dans le registre d'incidents (`FEEDBACK_FORM.md` + suivi interne).
6. Clôturer avec le garage.

## Diagnostic rapide
- App ne démarre pas : vérifier base (`isDbValid`), logs, licence/HWID.
- Facture : vérifier numérotation, statut (émise = immuable → avoir).
- Facture électronique : `POST /einvoice/submit` → 422 = document non conforme
  (voir `validation.errors`).
- Mise à jour : vérifier SHA-256 + signature du manifeste.

## Escalade
- Bug produit → équipe dev (correctif).
- Besoin externe (certificat, PDP, juridique) → `../EXTERNAL_ACTIONS_REQUIRED.md`.

## Clôture de pilote
- Bilan support (nb incidents par gravité, temps de résolution **réels**).
- Ne publier aucune statistique de support non mesurée.
