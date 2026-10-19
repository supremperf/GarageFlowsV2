# Facturation électronique — sécurité opérationnelle

<!-- doc-numbers: journal -->

Ce document décrit les garde-fous **réellement implémentés** dans le dépôt au
2026-10-19. Il ne certifie ni conformité réglementaire ni interopérabilité avec
une plateforme agréée : aucun échange avec une PDP réelle n'a eu lieu dans
l'environnement de développement (voir [BLOCAGES_EXTERNES.md](BLOCAGES_EXTERNES.md)).

## 1. Identifiants de plateforme

- Chiffrés au repos en AES-256-GCM (`src/lib/einvoicing/credentials-cipher.ts`).
- Clé dédiée serveur `GF_EINVOICE_CREDENTIALS_KEY` (32 octets), versionnée par
  `GF_EINVOICE_CREDENTIALS_KEY_VERSION` pour permettre une rotation contrôlée.
- Jamais renvoyés au client, même tronqués : la projection publique ne contient
  que des champs de configuration (`projeter()`).
- Un secret absent du corps d'une mise à jour est **conservé** : l'interface ne
  réaffiche pas les secrets, donc ne peut pas les renvoyer.

## 2. Appels sortants

- HTTPS obligatoire, validation de la destination **à chaque appel** (pas
  seulement à l'enregistrement) : refus des hôtes réservés et des adresses non
  routables (`ssrf-guard.ts`), y compris après résolution DNS.
- Délai de 20 secondes, redirections refusées (`redirect: 'error'`).
- La clé d'idempotence est déterministe et persistée avant l'appel réseau ; une
  réponse perdue ne provoque pas de seconde déclaration.

## 3. Webhooks entrants

La route `POST /api/einvoicing/webhooks/[providerId]` est **publique** (une
plateforme n'a pas de session GarageFlows). Son authentification est la
signature HMAC du corps brut :

```text
X-GF-Timestamp: <secondes Unix>
X-GF-Signature: <hex HMAC-SHA256(secret, «timestamp».«corps brut»>
```

- Secret **par garage**, stocké dans les identifiants chiffrés de la connexion
  (`webhookSecret`).
- Comparaison à temps constant (`crypto.timingSafeEqual`).
- Fenêtre anti-rejeu de 5 minutes, dans les deux sens.
- Le corps est signé **avant** tout parsing : re-sérialiser changerait les octets.
- Un identifiant d'événement (`eventId` dans le corps, ou `X-GF-Event-Id`) rend
  le traitement idempotent.
- Un statut brut inconnu n'écrase rien, et un statut en retard ne fait pas
  régresser la facture (`doitRemplacerStatut`).
- Aucun corps de webhook n'est journalisé : seuls `providerId`,
  `transmissionId` et le statut canonique le sont.

### Vérifier une signature à la main

```bash
TS=$(date +%s)
BODY='{"externalId":"EXT-123","status":"accepted","eventId":"evt-1"}'
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" -hex | awk '{print $2}')
curl -X POST "$BASE/api/einvoicing/webhooks/generic-pa" \
  -H "content-type: application/json" \
  -H "x-gf-timestamp: $TS" \
  -H "x-gf-signature: $SIG" \
  --data-binary "$BODY"
```

Réponses : `200` appliqué / ignoré / doublon, `400` charge invalide, `401`
signature absente, fausse ou hors fenêtre, `404` transmission ou connecteur
inconnu, `409` connexion sans secret ou identifiant ambigu entre garages,
`413` au-delà de 64 Kio, `429` débit dépassé, `500` erreur interne (aucun
détail renvoyé).

## 3bis. Reprise automatique (file)

`POST /api/internal/einvoicing/queue` est une route **d'exploitation**, jamais
appelée par un écran. Elle est protégée par un jeton dédié
`EINVOICING_QUEUE_TOKEN` (≥ 32 caractères) en `Authorization: Bearer …`,
comparé à temps constant ; sans jeton configuré, elle répond 503 et ne fait
rien. Elle est également fermée si `EINVOICING_ENABLED` ou
`EINVOICING_OUTGOING_ENABLED` est faux.

Elle ne reprend que des transmissions `error` sans identifiant externe, après
un backoff de 5 min / 15 min / 1 h / 4 h / 24 h et cinq tentatives au maximum.
Elle ne touche jamais un statut `unknown` (la plateforme a peut-être reçu la
facture) ni `rejected` (contenu refusé : le renvoyer tel quel boucle).

## 4. Isolation et statuts

- Le `garageId` vient toujours d'une session serveur ou de la licence du poste,
  jamais du corps d'une requête de gestion.
- Une transmission n'est retrouvée que par `(providerId, externalId)` ; si
  plusieurs garages partagent l'identifiant, la requête est refusée (409).
- Le statut n'est mis à jour que sur une réponse ou un webhook **vérifié**.

## 5. Ce qui n'est pas prouvé ici

- Aucune acceptation réelle par une plateforme agréée (pas d'identifiants PDP).
- Aucun format validé par un destinataire réel.
- Les suites de tests qui exigent PostgreSQL n'ont pas été exécutées dans
  l'environnement de cette session (moteur Prisma indisponible).

Voir [audit/2026-10-19/RAPPORT-LICENCES-ET-EINVOICING.md](audit/2026-10-19/RAPPORT-LICENCES-ET-EINVOICING.md)
pour les mesures et les commandes de reproduction.
