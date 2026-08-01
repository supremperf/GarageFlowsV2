# Facturation électronique — Limites (franc)

_Ce qui N'EST PAS fait. Date : 2026-08-01._

## Ce qui est réel (rappel)
Modèle pivot EN 16931, mapping en centimes entiers, validateur (BR-xx cœur +
cohérence totaux/TVA), génération **UBL 2.1** et **CII** testées, provider
agnostique + **sandbox fonctionnel** (cycle de vie), vérification de webhook, et
une **route API** scopée par garage. 30 tests verts.

## Ce qui N'EST PAS fait (bloquant pour un usage légal)

1. **Aucune transmission officielle.** Pas de connexion à Chorus Pro / au PPF / à
   une PDP agréée. Le « dépôt » se fait vers un **sandbox en mémoire**. Un
   contrat + des accès sont requis (`ELECTRONIC_INVOICING_PROVIDER.md`).
2. **Pas de Factur-X PDF/A-3.** On génère le XML CII (`factur-x.xml`) mais pas le
   PDF/A-3 qui doit l'embarquer — nécessite une bibliothèque PDF (non ajoutée).
3. **Validation officielle absente.** Validateur interne (règles essentielles),
   pas de Schematron/EN 16931 officiel ni de certification.
4. **Limites du modèle de données** (voir audit) : un **seul taux de TVA**
   d'en-tête (pas de TVA par ligne) ; **pas de SIRET acheteur** dans `Client`
   (avertissement B2B) ; dates stockées en chaînes ; pas de remises/acomptes ;
   **pas de modèle Avoir/Paiement** persistant.
5. **e-reporting** et **archivage à valeur probante** : non implémentés.
6. ~~Sandbox non persistant~~ **CORRIGÉ** — les transmissions sont désormais
   **persistées** (modèles Prisma `EInvoiceSubmission` + `EInvoiceEvent`, sur les
   deux schémas ; migration serveur incluse). La route
   `POST /api/invoices/[id]/einvoice/submit` mappe → valide → dépose (sandbox) →
   **enregistre** la transmission (empreinte SHA-256, statut, événements de cycle
   de vie), idempotente par `(garageId, idempotencyKey)` et scopée par garage.
   L'adaptateur **sandbox** reste en mémoire (c'est un double de test) ; la
   PERSISTANCE, elle, est réelle et testée (isolation multi-tenant comprise).

## Ce qu'il reste à faire pour un usage réel (ordre)

1. Ajouter au schéma : SIRET acheteur, TVA par ligne, dates `DateTime`, montants
   figés à l'émission, modèles **Avoir** et **Paiement** (migration Prisma).
2. Ajouter l'incorporation **PDF/A-3** (Factur-X complet).
3. Écrire l'adaptateur **PDP réelle** + persistance des transmissions + route
   webhook signée.
4. Faire valider par un **Schematron officiel** et par la PDP en sandbox.
5. Obtenir le **contrat/agrément** et les accès de production.

**Ne jamais présenter GarageFlow comme une plateforme agréée ni la transmission
comme active.** Voir `docs/ACQUISITION_READINESS_AUDIT.md`.
