# GarageFlow — Fichiers régressifs supprimés

Règle appliquée : un fichier n'est supprimé QUE si (1) une meilleure version existe,
(2) tous ses imports sont migrés, (3) les tests passent, (4) aucun comportement utile
n'est perdu, (5) la suppression est documentée.

## Résultat : AUCUN fichier supprimé

La fusion a été menée en **3-way depuis l'ancêtre commun `main`** : hardening est la
base, mechanic une branche de fonctionnalité. Les implémentations **régressives** de
mechanic n'étaient pas des fichiers distincts à supprimer — c'étaient d'anciennes
**versions de contenu** des 8 fichiers communs. Elles ont été **écartées lors de la
résolution de fusion** (git a retenu la version hardening, ou une fusion des deux),
et non supprimées comme fichiers. Il n'existe donc aucun fichier à retirer.

| Contenu régressif potentiel (branche mechanic) | Traitement | Remplacement / preuve | Tests |
|---|---|---|---|
| Ancien `electron/main.js` de mechanic | Écarté à la fusion (auto-merge additif sur la base hardening) | `electron/main.js` hardening conservé + hooks mechanic additifs | `public-key-consistency.test.ts` |
| Ancienne clé publique (`c48e6b3e…`) | **Absente du dépôt** (jamais présente dans la fusion) | Clé canonique `7bed3cb7…478` dans les 2 consommateurs | `public-key-consistency.test.ts` |
| Ancien middleware (licence-avant-NextAuth) | Écarté à la résolution de conflit | `src/middleware.ts` NextAuth-first + confinement mechanic greffé | `src/__tests__/middleware.test.ts` |
| Ancien serveur de licence local / fallback | Jamais introduit | `electron/license-endpoint.js` hardening conservé | inventaire durcissement §5 |
| Ancien état local non signé | Jamais introduit | `electron/signed-state.js` hardening conservé | — |
| Doublon `httpGetJson` | Absent (retiré côté hardening avant fusion) | version hardening unique | — |
| Schémas Prisma mechanic sans index hardening | Écartés | schémas fusionnés (index hardening 120-129 conservés) | `prisma validate` |
| Gestion SMTP en clair | Jamais introduite | `secret-cipher.ts` (AES-256-GCM) conservé ; `/api/garages` exclut `smtpPass` | `secret-cipher.test.ts` |
| Ancien `IS_DEV` (env-only) | Écarté | `IS_DEV = !app.isPackaged && ELECTRON_DEV==='1'` conservé | — |
| Anciennes versions des scripts de configuration | Écartées | scripts hardening conservés (`.ps1`, `.cmd`, manifest) | `test_keygen.py` |
| Schéma d'audit `mechanicId NOT NULL` (chaînes vides) | **Corrigé en place** (jamais expédié) | colonnes `actorUserId`/`actorRole`/`targetMechanicId` nullables (§6) | tests audit (§7) |

Aucune protection, aucun test, aucune migration, aucun script ni document utile n'a
été supprimé pour faciliter la fusion.
