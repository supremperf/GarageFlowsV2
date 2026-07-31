# Politique de licence hors ligne — GarageFlow

> Document de data room (due diligence technique). Décrit précisément le
> comportement de GarageFlow lorsque le poste perd la connexion : période de
> grâce de 48 h, verrouillage dur à 72 h, et détection de recul d'horloge.
> Chaque affirmation renvoie à `electron/main.js`.

## 1. Principe

GarageFlow est un logiciel de bureau qui exige une **connexion internet
périodique** pour confirmer la validité de la licence. Il tolère des coupures
courtes (fail-open sur erreur réseau, cf. `docs/LICENSING_ARCHITECTURE.md` §5)
mais applique, au-delà d'un certain temps hors ligne, une politique de grâce puis
de verrouillage.

## 2. Paramètres exacts

| Constante | Valeur | Effet | Référence |
|---|---|---|---|
| `GRACE_PERIOD_MS` | **48 h** (`48 * 60 * 60 * 1000`) | Au-delà : **avertissement** non bloquant | `electron/main.js:298` |
| `LOCK_PERIOD_MS` | **72 h** (`72 * 60 * 60 * 1000`) | Au-delà : **`app.quit()`** (fermeture forcée) | `electron/main.js:299` |
| `ONLINE_CHECK_URL` | `https://1.1.1.1` (DNS Cloudflare) | Sonde de connectivité fiable | `electron/main.js:301` |
| Sonde de licence | `/api/health` du serveur de licence (si configuré) | Vérifie la joignabilité de l'autorité | audit desktop |

Le fichier d'horodatage de dernière connexion est
`APP_DATA/last_online.json` (`ONLINE_CHECK_FILE`, `main.js:297`).

## 3. Séquence de contrôle (fonction hors-ligne)

Vérification déclenchée 30 s après le démarrage puis périodiquement (toutes les
~4 h) via `startOnlineGraceCheck` (`main.js:1221+`). Logique dans le bloc
`main.js:1179-1219` :

1. Si en ligne : l'horodatage `last_online` est rafraîchi, `clockTampered` remis
   à `false` (`main.js:1169`), aucun avertissement.
2. Si hors ligne :
   - `checkClockIntegrity()` est appelé (§4) — `main.js:1181`.
   - Calcul de `offlineMs = Date.now() - lastOnlineTs` (`main.js:1183-1184`).
   - **Verrouillage** si `offlineMs > LOCK_PERIOD_MS` **OU** `offlineMs < 0`
     (durée négative → horloge reculée) **OU** `clockTampered`
     (`main.js:1193`) : dialogue d'erreur bloquant « Connexion requise » puis
     **`app.quit()`** (`main.js:1194-1211`).
   - **Avertissement** si `offlineMs > GRACE_PERIOD_MS` (mais < 72 h) : dialogue
     non bloquant indiquant le nombre d'heures restantes avant verrouillage
     (`main.js:1206-1218`).

Message de verrouillage (extrait, `main.js:1195-1205`) :
> « GarageFlow nécessite une connexion internet. […] Votre logiciel est hors ligne
> depuis plus de 72 heures. » ou « Incohérence de l'horloge système détectée. »

## 4. Détection de recul d'horloge (anti-contournement)

Objectif : empêcher un utilisateur de « gagner du temps » en reculant l'horloge
Windows pour éviter le verrouillage.

- `checkClockIntegrity()` (`main.js:619-631`) compare l'heure murale courante à
  une **référence de confiance monotone** persistée dans `TRUSTED_CLOCK_PATH`.
- La détection s'appuie sur `cp.detectClockRollback(previous, now, CLOCK_SKEW_MS)`
  (`control-plane.js`). Un recul au-delà de la tolérance `CLOCK_SKEW_MS` :
  - journalise `SECURITY: clock rollback detected` ;
  - positionne `clockTampered = true` ;
  - émet un rapport de crash de type `security` (`clock_rollback_detected`).
- En avance normale, la référence est mise à jour (**strictement croissante**,
  `main.js:628`).
- Conséquence : `clockTampered` **ou** `offlineMs < 0` déclenche le même
  verrouillage que le dépassement des 72 h (`main.js:1193`). Le mode hors ligne
  devient « strict » : une reconnexion réelle est exigée.

## 5. Risque produit : le verrouillage dur à 72 h

> **Classement audit : risque ÉLEVÉ (high).** Voir domaine
> `desktop-architecture` dans `docs/ACQUISITION_READINESS_AUDIT.md`.

Un outil de **bureau** destiné à des garages indépendants qui **s'auto-ferme
(`app.quit()`) après 72 h sans connexion** constitue une **vraie responsabilité
de disponibilité** :

- De nombreux garages indépendants ont une connexion internet peu fiable ou
  absente.
- Un long week-end prolongé, une panne box, un déménagement d'atelier → le
  logiciel se ferme et **bloque l'exploitation** (facturation, ordres de
  réparation) tant que la connexion n'est pas rétablie.
- Cela **contredit un positionnement « desktop / offline-first »** et peut
  générer churn et escalades de support.

Le comportement est **conforme à sa conception** (ce n'est pas un bug) : c'est un
**choix de politique** à réévaluer, pas un défaut d'implémentation.

## 6. Options de remédiation (propositions — non implémentées)

Ces pistes sont des **propositions de conception (DESIGN)**, pas des
fonctionnalités existantes :

1. **Allonger / rendre configurable** `LOCK_PERIOD_MS` (ex. 14–30 jours) via
   entitlement de licence, pour aligner sur des clients réellement hors ligne.
2. **Remplacer le `app.quit()` par un mode dégradé** : overlay non destructif en
   lecture seule / fonctions critiques maintenues, plutôt qu'une fermeture — même
   philosophie que l'overlay de révocation qui, lui, ne quitte pas l'app
   (`main.js:1054+`).
3. **Grâce hors-ligne signée par la licence** : la durée tolérée devient un champ
   du jeton (`typ`/entitlement), différenciant `trial` vs `enterprise`.
4. **Preuve de temps monotone renforcée** (compteur monotone OS / TPM) pour
   durcir la détection de recul d'horloge tout en relâchant la contrainte de
   fenêtre.
5. **Pré-avertissements plus précoces** (J-7, J-3) et bannière persistante plutôt
   qu'un unique dialogue à 48 h.

Chaque option est un **arbitrage disponibilité ↔ protection du revenu** que
l'acquéreur devra trancher selon son segment de marché.

## 7. Ce qui n'est PAS concerné

- Les **coupures courtes** (< 48 h) : aucun impact, fail-open réseau
  (`main.js:1040-1042`).
- Le heartbeat d'appareil : adaptatif (≈ 2 min normal / 20 s si bloqué),
  fail-open sur erreur réseau — ne verrouille jamais un utilisateur hors ligne
  (cf. `verified-facts.md`, `docs/LICENSING_ARCHITECTURE.md` §5).

---
Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md`.
