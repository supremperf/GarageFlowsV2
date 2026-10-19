# Facturation électronique — couche FORMATS (validation + CII)

Complète `EINVOICING_ARCHITECTURE.md` (drapeaux fail-closed, adaptateurs,
chiffrement des identifiants). Cette couche traite le **document lui-même** :
modèle canonique, validation, sérialisation CII du profil Factur-X MINIMUM.

## 1. Ce que fait cette couche (vérifiable par les tests)

```
src/lib/einvoicing/
├── document-model.ts  # modèle canonique (sous-ensemble EN 16931) + construction
│                      #   depuis Garage/Invoice/InvoiceLine — centimes entiers
├── validate.ts        # SIREN/SIRET (Luhn), TVA FR (clé contrôlée),
│                      #   validation de profil : champs BT-x + cohérence
│                      #   arithmétique recalculée par la couche financière
└── cii-xml.ts         # XML CII urn:factur-x.eu:1p0:minimum — FAIL-CLOSED :
                       #   refuse de sérialiser un document invalide
```

- **Une seule formule de TVA dans le dépôt** : `taxCentsFromBasis` (ajoutée à
  `src/lib/money.ts`, couche financière centrale) est utilisée PAR
  `computeTotals` ET par cette couche — une divergence de calcul entre
  l'affichage, la facturation et l'e-invoicing est impossible par construction.
  Arrondi fiscal demi-éloigné-de-zéro appliqué **une fois sur l'assiette du
  taux**, pas ligne à ligne.
- **Montants 100 % entiers** : lignes via `lineTotalCentsFromScaled` (chemin
  entier exact), formatage XML par arithmétique entière (`centsToDecimalString`).
- **Validation avant émission** : identifiants français réellement contrôlés
  (Luhn SIREN/SIRET, clé TVA `(12 + 3×(SIREN mod 97)) mod 97`, cohérences
  SIREN↔SIRET↔TVA), dates calendaires réelles, totaux recalculés — toute
  falsification d'assiette/TVA/TTC est détectée (règles `GF-EI-041/042/043`).
- **Fail-closed** : `generateFacturXMinimumXml` lève `EInvoiceValidationError`
  (avec la liste des règles violées) plutôt que d'émettre un XML douteux.

Tests : `src/lib/einvoicing/__tests__/formats.test.ts` (identifiants, totaux,
mutations une à une, échappement XML, refus fail-closed).

**Preuve XSD exécutée (2026-08-07)** : une facture générée par ce code
(`buildCanonicalInvoice` → `generateFacturXMinimumXml`, avec caractères
spéciaux dans les libellés) **valide contre le XSD officiel Factur-X 1.09
MINIMUM** (`xmllint --schema Factur-X_MINIMUM.xsd` → « validates », exit 0 ;
schémas issus du dépôt de référence akretion/factur-x). Cette passe a d'ailleurs
corrigé un défaut trouvé en revue adversariale : `SpecifiedLegalOrganization`
n'admet qu'**un seul** `ram:ID` (cardinalité 0..1) — le SIREN (schemeID 0002)
est émis en priorité, le SIRET (0009) en repli.

**Revue adversariale (2026-08-07)** : 18 allégations produites par 3 chasseurs
indépendants, chacune soumise à réfutation contradictoire ; 6 défauts réels
démontrés et corrigés avec test de régression chacun (double `ram:ID`
XSD-invalide ; bruit IEEE-754 de la TVA sur taux exotiques → chemin 100 %
entier en centièmes de point ; double arrondi du repli grands montants →
arrondi unique BigInt ; dépassement `MAX_SCALED` silencieusement facturé
0,00 € → règle GF-EI-035 ; `lineTotalCents` falsifiable → recalcul GF-EI-036 ;
`taxRate` NaN blanchi en 0 % → rejet GF-EI-040). 2 allégations réfutées ;
10 vérifications interrompues par une limite de session — leurs allégations à
faible coût ont été durcies par prudence (caractères XML 1.0 interdits
GF-EI-050, SIREN tout-zéros, codes pays, vide « invisible », totaux
entiers sûrs GF-EI-045, négatif toléré pour un futur avoir 381).

## 2. Ce que cette couche NE fait PAS (limites honnêtes)

À dire tel quel en due diligence — le terme « conforme Factur-X » n'est **pas**
revendiqué :

1. **Pas de PDF/A-3** : Factur-X au sens strict est un PDF/A-3 avec ce XML
   embarqué. La génération du PDF hybride n'est pas implémentée.
2. **Validation officielle partielle** : le XSD officiel MINIMUM a été passé
   avec succès **une fois, hors CI** (preuve du 2026-08-07 ci-dessus) ; il
   n'est pas exécuté en continu, et les règles **Schematron** (contraintes
   métier au-delà du XSD) n'ont jamais été exécutées. Une passe sur le
   validateur de référence (ex. outil FNFE-MPE) reste requise avant toute
   revendication de conformité.
3. **Profil MINIMUM uniquement** : sans lignes détaillées ni ventilation
   multi-taux (le modèle de données a un taux unique par facture). Les profils
   BASIC/EN 16931 exigeront les lignes et la ventilation par taux.
4. **Aucune transmission** : le registre d'adaptateurs est volontairement vide
   (`adapter.ts`) — aucun envoi réel vers une plateforme, et rien n'est
   présenté comme tel. Le raccordement à une plateforme agréée (choix
   commercial + contrat + homologation) reste entièrement à faire.
5. **Type 380 uniquement** : les avoirs (381) ne sont pas générables tant que
   le modèle de données ne les porte pas.

## 3. Chemin vers la conformité réglementaire (échéances françaises)

Étapes restantes, dans l'ordre : (1) embarquer le XML dans un PDF/A-3 ;
(2) valider sur les artefacts officiels (XSD + Schematron) ; (3) choisir et
contractualiser une plateforme agréée, implémenter son adaptateur réel derrière
`EInvoiceProviderAdapter` ; (4) tests d'homologation en sandbox plateforme ;
(5) activer les drapeaux (`EINVOICING_*`) environnement par environnement.
Les concurrents du panel (`docs/COMPETITIVE_MATRIX.md`) annoncent déjà ces
raccordements — c'est l'écart marché le plus daté du produit.
