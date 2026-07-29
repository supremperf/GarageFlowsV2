# Intégration du plan de contrôle — Client GarageFlow (Electron)

Ce document décrit l'intégration côté **client desktop** (`GarageFlow.exe`) des
fonctions pilotées à distance par le serveur officiel (`api.garageflows.fr`,
dépôt `garagesite3`). Le serveur reste la **source de vérité** ; le client
applique et affiche.

Tout vit dans le **processus principal** (`electron/main.js` +
`electron/control-plane.js`), jamais dans le renderer : le React ne peut pas
contourner la protection.

---

## Configuration (variables d'environnement)

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `GF_LICENSE_SERVER` | Base HTTPS du serveur (activation, check, notifications, crash). | — (requis pour le contrôle distant) |
| `GF_UPDATE_CHANNEL` | Canal de mise à jour (`stable`/`beta`/…), utilisé pour le ciblage. | `stable` |

Toutes les communications passent par HTTPS. Aucune clé privée n'est stockée
côté client (vérification ECDSA avec la **clé publique** embarquée uniquement).

---

## 1. Modules / droits (entitlements)

- Le heartbeat `POST /api/license/check` renvoie `modules: string[]` (droits
  effectifs calculés par le serveur).
- `electron/main.js` persiste la liste dans un **cache chiffré AES-256-GCM**
  (clé dérivée du HWID, `gf_entitlements.dat`) et la diffuse au renderer
  (`entitlements:update`).
- Renderer : `EntitlementsProvider` + `useModule('billing')` /
  `useEntitlements()` (`src/lib/entitlements.tsx`).
  - Sous Electron : strictement la liste serveur.
  - Hors Electron (web/dev) : permissif — l'enforcement réel reste serveur.
- **Ajouter/retirer un module ne nécessite aucune réinstallation** : pris en
  compte au prochain check (≤ 6 h, ou immédiatement au redémarrage).

```tsx
import { useModule } from '@/lib/entitlements'
function FacturationButton() {
  if (!useModule('billing')) return null
  return <button>Nouvelle facture</button>
}
```

## 2. Centre de notifications

- `main.js` interroge `GET /api/notifications?licenseId=&version=&channel=` à
  chaque check et diffuse au renderer (`notifications:update`).
- Composant `src/components/NotificationCenter.tsx` (monté dans `Providers`) :
  cloche + badge non lues + panneau. Les notifications **obligatoires** non
  acquittées s'affichent en **surimpression bloquante** (« J'ai compris » →
  `POST /api/notifications/ack`).
- API pont : `getNotifications`, `onNotifications`, `ackNotification`.

## 3. Crash reporting (avec consentement)

- Handlers globaux `uncaughtException` / `unhandledRejection` +
  `render-process-gone` dans `main.js`.
- Envoi vers `POST /api/crash` avec `consent:true`, **file offline-first**
  (`gf_crash_queue.json`, bornée à 50) vidée dès que possible.
- Contenu technique uniquement : version, stack, OS/arch/CPU/RAM, *breadcrumbs*
  (dernières actions), extrait de logs, licenseId, HWID. **Aucune donnée métier.**
- Empreinte de regroupement identique au serveur (`control-plane.js`
  `computeCrashFingerprint`) → crashs identiques regroupés.
- Consentement RGPD géré par l'utilisateur : `getCrashConsent` /
  `setCrashConsent` (par défaut activé, coupable dans les paramètres).
- Le renderer peut remonter une erreur (`reportCrash`) et déposer des miettes
  (`addBreadcrumb`).

## 4. Anti-contournement du mode hors ligne (recul d'horloge)

- Le mode hors ligne existant (grâce 48 h, verrou 72 h) est renforcé par une
  **détection de recul d'horloge** (`gf_clock.json`, référence de temps
  monotone). Une reconnexion rétablit la confiance.
- Si l'horloge Windows recule au-delà de la tolérance (15 min) **ou** que la
  durée hors ligne devient négative, le logiciel se **verrouille** (fail-closed),
  empêchant de « gagner du temps » en changeant la date. L'événement est
  journalisé et remonté comme incident de sécurité.

---

## Surface IPC (preload `window.electronAPI`)

| Méthode | Rôle |
| --- | --- |
| `getEntitlements()` / `onEntitlements(cb)` | Modules autorisés (+ abonnement). |
| `getNotifications()` / `onNotifications(cb)` / `ackNotification(id)` | Notifications. |
| `getCrashConsent()` / `setCrashConsent(v)` | Consentement crash. |
| `reportCrash(info)` / `addBreadcrumb(action)` | Remontée renderer. |

---

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `electron/control-plane.js` | Helpers purs (empreinte crash, recul d'horloge, file bornée, base distante) — **testés**. |
| `electron/main.js` | Télémétrie de check, modules, notifications, crash, clock-tamper, IPC. |
| `electron/preload.js` | Pont sécurisé (nouvelles méthodes). |
| `src/lib/entitlements.tsx` | Provider + `useModule()`. |
| `src/components/NotificationCenter.tsx` | Centre de notifications. |
| `src/lib/__tests__/control-plane.test.ts` | Tests unitaires (vitest). |

## Tests

```bash
npm test   # vitest — inclut les helpers du plan de contrôle
```
