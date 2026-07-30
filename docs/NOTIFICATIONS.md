# Module Premium — Notifications multi-canal

Moteur **universel** de notifications : abstraction de canaux
(Email / SMS / WhatsApp / push / interne), modèles à **variables dynamiques**,
**déclencheurs** métier, dispatch avec **reprise automatique**, et **journal**
complet. Le cœur est sans dépendance réseau et 100 % testable.

## Architecture

```
src/lib/notifications/
├── types.ts       # Channel, NotificationTrigger, TemplateDef, DispatchResult, ChannelProvider
├── template.ts    # renderTemplate — {{ path | filter }} sûr (pas d'exécution de code)
├── templates.ts   # modèles par défaut (FR) pour chaque déclencheur
├── triggers.ts    # déclencheur → canaux par défaut
├── channels.ts    # FunctionProvider (transport injecté), InternalProvider, MockProvider
├── engine.ts      # NotificationEngine : résout → rend → dispatche (reprise) → résultat
└── index.ts
```

### Modèles à variables
`{{ client.name }}`, filtres `{{ amount | currency }}` (→ `240,00 €`),
`{{ date | date }}` (→ `29/07/2026`), `{{ note | default:"—" }}`, `upper`/`lower`.
Les variables absentes sont rendues vides **et signalées** (`missingVars`) — jamais
d'erreur, jamais d'exécution de code (sûr contre l'injection).

### Déclencheurs pris en charge
`appointment_reminder`, `maintenance_due`, `vehicle_ready`, `delay`,
`quote_accepted`, `quote_refused`, `invoice_overdue`, `warranty_expiring`,
`order_received`, `stock_out` — chacun avec un modèle par défaut et une liste de
canaux par défaut (le canal **interne** est toujours inclus).

### Canaux extensibles
`ChannelProvider` est une interface simple. Les transports réels sont **injectés**
(`FunctionProvider(channel, sendFn)`), donc l'API branche nodemailer pour l'email
et une passerelle pour le SMS/WhatsApp sans toucher au moteur ; un canal non
configuré renvoie `not_configured` (jamais d'échec bloquant → journal complet).
`MockProvider` sert aux tests (avec `failTimes` pour simuler des pannes transitoires).

### Reprise
`NotificationEngine` réessaie chaque envoi jusqu'à `maxAttempts` (backoff
exponentiel, `sleep` injectable pour les tests), et retourne un `DispatchResult`
structuré (`sent` / `failed` / `skipped` / `not_configured`, `attempts`, `error`).

## API

- `POST /api/notifications/dispatch` `{ trigger? | channel?, channels?, templateKey?, to, context }`
  → authentifié, rate-limité (30/min/garage). L'**email** part via le SMTP du
  garage (comme `reminders/send`) ; SMS/WhatsApp/push → `not_configured` tant
  qu'aucune passerelle n'est branchée. Chaque résultat est **journalisé**.
- `GET /api/notifications/dispatch?status=&channel=&limit=` → journal récent.

## Persistance / migration

Ajoute le modèle Prisma **`NotificationLog`** (+ relation `Garage.notificationLogs`,
index). Appliquer via `npm run db:push` avant prod.

## Tests

`src/lib/notifications/__tests__/notifications.test.ts` — 12 tests : rendu de
variables/filtres/manquantes, `renderMessage` (sujet + corps), dispatch interne,
`not_configured`, **reprise puis succès**, échec après épuisement, absence de
modèle, dispatch par déclencheur multi-canaux (avec rendu du filtre monétaire).

## À venir
- Passerelles SMS/WhatsApp/push réelles (Twilio, Meta, WebPush) via `FunctionProvider`.
- Planification + relances automatiques (cron) et statistiques d'ouverture.
- Éditeur de modèles par garage (surcharge de `DEFAULT_TEMPLATES`).
