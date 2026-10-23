---
doc-numbers: journal
---

# STAGING — rapport MASTER 6

**Verdict : PASS.** Les services de staging sont réellement provisionnés, réellement exercés, et un déploiement Preview a été produit et vérifié. C'était le troisième blocage de MASTER 5 ; il est levé.

## 1. Environnement de staging — réel et isolé

| Service | Instance | Isolation vérifiée |
|---|---|---|
| PostgreSQL | **Neon, environnement Preview** — `neondb`, PostgreSQL **18.6** | variables Preview distinctes de Production ; la base de production n'a **jamais** été interrogée |
| Redis | **Upstash, environnement Preview** — hôte `humble-gelding-137819.upstash.io` | clés de contrôle préfixées puis supprimées, 0 résiduelle |
| compute | serveur de **production** du produit (`.next/standalone`, `NODE_ENV=production`) | — |
| licence | licence de **TEST**, `SIGNATURE_INVALID` sous l'ancrage de production | — |
| données | seed de démonstration + enregistrements préfixés, supprimés en fin de parcours | aucune donnée personnelle réelle copiée |

**Distinction à ne pas confondre** : les §2 et §3 mesurent le code de production branché sur les services de staging depuis cette machine. Le §4 mesure un **déploiement Vercel réel**. Les deux sont rapportés séparément.

## 2. PostgreSQL de staging

| Contrôle | Résultat |
|---|---|
| connexion et authentification | **OK** — `neondb` / `neondb_owner`, TLS |
| version | **PostgreSQL 18.6** (aarch64, Neon) |
| migrations `migrate deploy` sur la base de staging | **appliquées** |
| schéma | **48 tables** dans `public` |
| relations, contraintes, cascade | **vérifiées** par le smoke test de la porte |
| transactions et rollback | **vérifiés** (10/10 opérations réelles, hérité MASTER 5 et rejoué) |
| concurrence : 50 créations de factures en parallèle | **50 numéros distincts et contigus** |
| migrations rejouées sur base **vierge** à nom unique | **22/22**, aucun `DROP DATABASE` sur une base partagée |
| reconnexion | **OK** — l'application répond après rafale (30/30 en 227 ms) |

## 3. Redis de staging

| Contrôle | Résultat |
|---|---|
| connexion et authentification (`PING`) | **PONG** |
| écriture puis lecture (`SET`/`GET`) | valeur relue conforme |
| expiration réelle (`EXPIRE` + `TTL` + disparition) | TTL=1 s puis clé absente |
| limitation de débit (fenêtre 3 autorisés / 2 refusés) | `autorisé, autorisé, autorisé, refusé, refusé` |
| indisponibilité (jeton invalide) | **HTTP 401** — aucun accès sans jeton valide |
| partage inter-instances du compteur | **OK** — prouvé par `release:gate` contre un Redis réel |
| nettoyage | **0 clé résiduelle** sous le préfixe de contrôle |

## 4. Déploiement Preview Vercel — réel

| | |
|---|---|
| identifiant | `dpl_C1FGbnHRpggCVpuL6L9XA2BHHyHi` |
| cible | `preview` |
| statut | **● Ready** |
| URL | `https://appgarageflows-gomy2ln6k-garage-flows.vercel.app` |

Endpoints réellement exercés (via `vercel curl`, requête authentifiée — la Preview est protégée par Vercel Authentication, réglage du projet) :

| Route | Statut | Corps |
|---|---:|---|
| `/api/health` | **200** | `{"status":"ok"}` |
| `/api/ping` | **200** | `{"ok":true}` |
| `/api/auth/csrf` | **200** | jeton CSRF émis |
| `/api/clients` | **401** | `{"error":"Non autorisé","code":"UNAUTHENTICATED"}` |
| `/login` | **200** | HTML rendu |

En-têtes relevés : HSTS `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, **aucun `unsafe-eval`**.

Détail du déblocage dans `MASTER6_VERCEL_REPORT.md`.

## 5. Tests HTTP réels — 35/35

Voir `MASTER6_TEST_RESULTS.md §7` pour le détail par domaine. Preuve : `MASTER6_EVIDENCE/logs/11-staging-http-reel.txt`.

## 6. SMTP

Aucun serveur SMTP de test autorisé n'a été fourni, et l'architecture ne porte **aucune variable `SMTP_*`** : les identifiants sont des données **par garage**, chiffrées au repos en AES-256-GCM.

Ce qui est prouvé (hérité MASTER 5, contre un serveur SMTP réel démarré en local, **5/5**) : chiffrement au repos avec enveloppe `GFSEC1:`, message réellement transmis, authentification présentée avec le secret **déchiffré**, configuration incomplète signalée sans exception, refus serveur **jamais** présenté comme un succès, clé de chiffrement modifiée bloquant l'envoi.

Ce qui reste **BLOCKED** : acheminement externe réel — SPF, DKIM, DMARC, réputation, réception dans une boîte. **Aucun courriel commercial ou client n'a été envoyé.**

## 7. Nettoyage et bases résiduelles

Les conteneurs jetables de cette mission ont été supprimés. Des bases de contrôle subsistent sur l'instance Neon de **Preview** — elles ne contiennent que des données de contrôle, et aucune n'est la base applicative `neondb`. Leur liste exacte et leur ordre de suppression figurent dans `MASTER6_MANUAL_ACTIONS.md` : un `DROP DATABASE` sur une instance partagée sort du mandat sans autorisation explicite.
