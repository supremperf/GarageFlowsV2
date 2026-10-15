# Matrice concurrentielle — logiciels de gestion de garage (marché français)

**Date de collecte : 2026-08-07.** Instantané sourcé : chaque affirmation sur un
concurrent provient d'une page web réellement consultée à cette date (URL en
fin de section) ; quand une information n'a pas été trouvée, elle est notée
**inconnu** — rien n'est extrapolé. Les prix et périmètres évoluent : cette
matrice doit être **re-vérifiée avant tout usage commercial ou contractuel**.

La colonne GarageFlows s'appuie exclusivement sur des capacités **vérifiées
dans le code de ce dépôt** (tests et gardes CI à l'appui — voir
`docs/audit/RISK_REGISTER.md` et `docs/PRODUCTION-READINESS.md`).

## 1. Panel comparé

| Produit | Éditeur | Modèle | Tarif public (collecté le 2026-08-07) |
|---|---|---|---|
| **GarageFlows** (ce dépôt) | — | desktop Electron (SQLite locale) **et** serveur (PostgreSQL) + PWA | non commercialisé à ce jour (décision de l'acquéreur) |
| EBP MéCa (ACTIV/PRO) | EBP | hybride (SaaS ou local, non détaillé) | non publiée (« sur devis ») ; source tierce non confirmée : 51 €/mois (LeBonLogiciel) |
| wm cloud (WinMotor) | Solware Auto (dep. 1987) | cloud 100 % | non publiée (chiffrage via démo) |
| Sage Apimécanique | Sinari Invest (ex-Sage, arrêt commercialisation 2021) | desktop Windows (VB + Access 2010) | revendeurs : 39 € HT/mois (probablement obsolète) |
| Fiducial DMS Pro (V-Mobility/Vulcain) | FIDUCIAL | hybride (SaaS ou local) | non publiée (« sur devis ») |
| Gest'Garage | Paul Jeanroy (indépendant) | cloud | 19–79 € TTC/mois, essai 14 j |
| Fiche Atelier ⚠ | THE DUG MEDIA ltd (Chypre) | cloud | contradictoire selon la page (19/35 € ou 39/79 €/mois) |
| AutoProGestion | AutoProGestion | cloud | 29–59 €/mois (HT/TTC non précisé), Entreprise sur devis |

⚠ **Fiche Atelier — fiabilité douteuse** : éditeur non français sans SIREN
publié, tarifs contradictoires entre deux pages du même site, CGU pointant vers
`example.com`, aucune présence dans les comparatifs tiers ni avis indépendants.
Conservé à titre de signalement, à exclure d'un benchmark décisionnel.

## 2. Matrice fonctionnelle

Légende : ✓ oui · ◐ partiel · ✗ non · ? inconnu (non documenté publiquement).
Pour GarageFlows, chaque ✓ renvoie à une preuve du dépôt.

| Capacité | GarageFlows | EBP MéCa | wm cloud | Apimécanique | Fiducial | Gest'Garage | AutoProGestion |
|---|---|---|---|---|---|---|---|
| Planning atelier | ✓ (cœur du produit, multi-mécaniciens) | ◐ (PRO seulement) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Devis / factures | ✓ (monnaie entière exacte, numérotation transactionnelle, immuabilité testée) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Ordres de réparation | ✓ (compteur dédié, machine à états) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Stock pièces | ✓ (décrément atomique prouvé sous concurrence PostgreSQL) | ◐ (PRO) | ✓ | ✓ | ✓ | ✓ | ✓ (plan Pro) |
| Portail client | ✓ (lien tokenisé signé, tickets, RDV — cloisonnement testé) | ? | ? | ? | ? | ✓ | ✓ |
| Mobile | ◐ (PWA responsive complète ; pas d'app native) | ? (pas d'app native selon tiers) | ◐ (web mobile) | ? | ◐ (contradictoire) | ◐ (web responsive) | ✗ (« bientôt ») |
| Desktop / hors-ligne | ✓ (Electron + SQLite locale, MàJ vérifiées) | ◐ (formule locale) | ✗ | ✓ (technologie obsolète) | ◐ (Vulcain local) | ✗ | ✗ |
| Facturation électronique (réforme FR) | ◐ (fondations codées ; formats à valider, non certifié) | ✓ (Factur-X + PA annoncés) | ◐ (« préparation » annoncée) | ? (incertaine, produit en fin de vie) | ✓ (PA Fiducial annoncée) | ✓ (Factur-X annoncé) | ✓ (PDP annoncée) |
| Multi-site / multi-établissement | ◐ (multi-tenant isolé prouvé par tests ; consolidation multi-sites non construite) | ◐ | ◐ (renvoie vers winmotor2) | ◐ (multi-dépôt) | ◐ | ? | ◐ (Entreprise) |
| Export comptable FEC | ✓ (conformité libellés/nommage testée) | ✓ (liaison compta) | ? | ✓ (liaison Sage) | ✓ (compta intégrée) | ✓ | ✓ |
| Signature électronique | ◐ (sceau d'intégrité HMAC local — qualifié honnêtement, non eIDAS) | ? | ✓ (devis signés) | ? | ✓ | ✓ (email/SMS) | ✓ (plan Pro) |
| Catalogues pièces / plaque (SIV) | ✗ (aucune intégration tierce) | ✓ (ETAI, 200 000+ réf.) | ? | ✓ (temps barémés) | ✓ (DARVA, diagnostic) | ? | ✓ (lookup SIV) |

## 3. Lecture — positionnement de GarageFlows

**Différenciateurs réels (prouvés dans le dépôt)** :
- **Double déploiement desktop hors-ligne + serveur** : seuls les produits
  hérités (Apimécanique en fin de vie, Vulcain « historique ») offrent un vrai
  desktop ; aucun SaaS du panel n'a de mode hors-ligne. GarageFlows combine
  Electron/SQLite hors-ligne **et** PostgreSQL serveur **et** PWA — combinaison
  absente du panel.
- **Rigueur financière démontrée** : monnaie en entiers exacts (zéro flottant,
  3 gardes CI), numérotation sous concurrence réelle prouvée, immuabilité des
  factures émises testée. Aucun concurrent ne publie ce niveau de preuve (ce
  qui ne signifie pas qu'ils ne l'ont pas — c'est invérifiable de l'extérieur).
- **Isolation multi-tenant testée** (matrice de permutation inter-garages) et
  portail client à jeton de capacité signé, cloisonnement testé.
- **Transparence** : SBOM, registre de risques, seuils d'observabilité et
  budget de performance versionnés — atout de due diligence plus que de vente.

**Écarts face au marché (à combler ou assumer)** :
- **Facturation électronique** : 4 concurrents sur 7 **annoncent** une
  conformité réforme 2026 (Factur-X, PA/PDP). GarageFlows n'a que des
  fondations (`src/lib/einvoicing/`) — c'est l'écart concurrentiel le plus
  daté, l'échéance réglementaire étant annoncée au 1er septembre 2026 par
  plusieurs sites du panel.
- **Intégrations métier absentes** : catalogues de pièces (ETAI), lookup plaque
  SIV, interfaces assurance (DARVA) — présentes chez les acteurs établis.
- **Pas d'application mobile native** (la PWA responsive en tient lieu) — écart
  partagé avec la quasi-totalité du panel.
- **Notoriété nulle** : Fiducial revendique 6 600 garages, Solware 3 500
  professionnels ; GarageFlows part de zéro client.

**Sur les prix** : la comparaison tarifaire du panel est fragile — les trois
acteurs établis (EBP, Solware, Fiducial) ne publient pas leurs prix, et les
chiffres disponibles viennent de petits acteurs (19–79 €/mois) ou de sources
tierces non confirmées. Toute grille de prix GarageFlows devra être positionnée
par l'acquéreur sur des devis réels, pas sur cette matrice.

## 4. Fiches sources par concurrent

### EBP MéCa (ACTIV / PRO) — EBP
Forces : conformité e-invoicing annoncée (Factur-X, « Plateforme Agréée intégrée »), couverture PRO large (carrosserie, VN/VO, prêt), catalogues ETAI. Limites : prix sur devis, planning/stock réservés à PRO, ACTIV limité à 1 utilisateur/1 société, pas d'app mobile documentée.
Sources consultées (2026-08-07) : ebp.com/logiciel-garage-automobile/ (+ pages ACTIV et PRO), qonto.com (comparatif), lebonlogiciel.com (prix ACTIV 51 €/mois — non confirmé par EBP), logiciels.pro.

### wm cloud — Solware Auto
Forces : éditeur métier depuis 1987 (3 500+ professionnels revendiqués), chaîne RDV→OR→facture sans ressaisie, 100 % cloud multi-appareils, abonnement « tout compris ». Limites : prix non publié, aucun mode hors-ligne, portail client non documenté, e-invoicing flou (NF525 + « préparation » 2026, sans Factur-X/PDP explicites), multi-sites renvoyé vers d'autres produits ; sur la gamme haute (WinMotor Next) des tiers relèvent complexité et 3,2/5 (5 avis).
Sources (2026-08-07) : winmotorcloud.com (accueil, /logiciel-planning-garage/, /logiciel-facturation-garage/, /prix-logiciel-gestion-garage/, guide complet), solware.fr, qonto.com, lebonlogiciel.com.

### Sage Apimécanique — Sinari Invest (fin de vie)
Produit desktop historique complet (devis→OR→BL→facture, carrosserie/assurance, multi-dépôt, liaison compta Sage, 3,82/5 sur 44 avis) mais **en fin de vie** : commercialisation Sage arrêtée en 2021, technologie VB/Access 2010 jugée non maintenable par un revendeur, absent du catalogue actuel de Sinari, conformité e-invoicing incertaine. Pertinent surtout comme **parc installé à conquérir**.
Sources (2026-08-07) : fclinformatique.fr, arcgestion.fr/blog/quel-avenir-pour-apimecanique/ (+ accueil, ancienne page produit en 404), equip-garage.fr (39 € HT/mois), lebonlogiciel.com, 2abim.fr, sinari.com (sector-garages, products-garages).

### Fiducial DMS Pro (V-Mobility / Vulcain / AD-MS 360) — FIDUCIAL
Forces : acteur le plus établi du panel (45 ans, 6 600 garages, 20 000 utilisateurs revendiqués), couverture très large (atelier, magasin, VO/VN, compta, CRM), e-invoicing via « Plateforme Agréée FIDUCIAL Cloud », SaaS hébergé en France ISO 27001, choix SaaS/local. Limites : prix sur devis, satisfaction moyenne (3,85/5 sur 20 avis), app mobile non documentée par l'éditeur (sources tierces contradictoires), portail client non documenté, gamme éclatée en 3 produits.
Sources (2026-08-07) : fiducial.fr (4 pages officielles), logiciels.pro (×2), lebonlogiciel.com, getapp.com (« à partir de 1 000 €/mois » — non confirmé par l'éditeur).

### Gest'Garage — éditeur indépendant
Forces : prix publics bas (19–79 € TTC/mois), Factur-X/réforme 2026 en argument central (XML CII, PDF/A-3, archivage 10 ans, FEC), portail client sans compte, chaîne devis signé→OR→facture. Limites : éditeur unipersonnel très récent (~1,5 an), aucun avis indépendant trouvé, pas de multi-site ni d'intégrations catalogues documentés, pas de hors-ligne.
Sources (2026-08-07) : gestgarage.fr (accueil, /fonctionnalites), pauljeanroy.dev, autoprogestion.fr/comparatif-logiciels-garage et groupe-asttas.fr (comparatifs tiers où le produit ne figure pas).

### Fiche Atelier — THE DUG MEDIA ltd ⚠ (voir réserve §1)
Revendique OR sur tablette, devis/factures illimités, stock, SMS, « 2000+ garages » (invérifiable). Tarifs contradictoires (19/35 € vs 39/79 €/mois selon la page), éditeur chypriote sans SIREN, signes de site inachevé (placeholders, CGU vers example.com), hébergement « en France » contredit par des mentions légales citant Cloudflare (San Francisco).
Sources (2026-08-07) : fiche-atelier.fr (accueil, /fonctionnalites, /tarifs, /mentions-legales/), quel-logiciel-garage.fr (comparatif tiers où le produit ne figure pas).

### AutoProGestion
Forces : planning 3 vues drag & drop + Kanban, chaîne devis→RDV→OR→facture, portail client avec paiement et signature à distance, e-invoicing annoncé via « Super PDP » inclus tous plans, spécificités FR (SIV, Cerfa VO, livre de police, FEC, Pennylane), 29–59 €/mois sans engagement. Limites : app mobile « bientôt », pas de hors-ligne, multi-site sur devis, Starter limité à 100 clients, quasi absent des comparatifs tiers, avis Trustpilot inaccessibles (anti-bot), une source tierce contradictoire sur le modèle/prix.
Sources (2026-08-07) : autoprogestion.fr (accueil, /tarifs, /fonctionnalites), axiumhq.io (contradictoire), lesite.pro, groupe-asttas.fr, myautogms.com (comparatifs consultés — produit absent), fr.trustpilot.com (existence confirmée, contenu inaccessible).

## 5. Limites de cette matrice (contrôle de complétude)

Issues de la passe de critique indépendante du 2026-08-07 :

- **Panel incomplet** : des acteurs cités par les comparatifs tiers consultés
  n'ont pas de fiche — TDV, GAD, Kwixéo, Henrri (groupe-asttas.fr), les SaaS
  Axium et autoGMS (leurs blogs ont servi de sources tierces), et **Sinari
  Garage** (successeur vivant d'Apimécanique). À compléter avant un benchmark
  décisionnel.
- **Comparaison tarifaire fragile** : 3 leaders sur devis ; chiffres tiers non
  confirmés (51 €/mois EBP, 1 000 €/mois Fiducial) ; HT/TTC hétérogène ou non
  précisé (Fiche Atelier, AutoProGestion).
- **« Inconnu » fréquent sur des critères différenciants** (portail client :
  4 fiches sur 7 ; app mobile native ; e-invoicing pour 2 fiches) — l'absence
  de documentation publique n'est pas une absence de fonctionnalité.
- Les affirmations chiffrées des éditeurs (« 6 600 garages », « -60 % de
  no-show », « 2000+ garages ») sont reproduites telles quelles et **non
  vérifiées**.
