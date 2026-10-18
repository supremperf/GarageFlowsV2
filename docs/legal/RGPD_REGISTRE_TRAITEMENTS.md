# Registre des activités de traitement (RGPD art. 30) — PROJET

> **PROJET technique à valider par un DPO / conseil juridique** (AUD-014). Ce
> registre est DÉRIVÉ du modèle de données et du code réellement déployés ; il
> recense les traitements de données personnelles observés. Il ne constitue pas
> un avis juridique et n'est pas opposable en l'état : la qualification des bases
> légales, des durées de conservation et des mentions d'information relève du
> responsable de traitement et de son conseil.

## Rôles

- **Éditeur de GarageFlows** : selon les traitements, **sous-traitant** (art. 28)
  des garages pour les données de leurs clients finaux hébergées dans l'app, et
  **responsable de traitement** pour ses propres traitements (leads, crash
  reporting, comptes du control-plane).
- **Garage utilisateur** : **responsable de traitement** des données de ses
  clients (fiches clients, véhicules, factures, portail).

Un **DPA (accord de sous-traitance, art. 28)** entre l'éditeur et chaque garage
est **obligatoire et à établir** (modèle à préparer par le conseil).

## Traitements recensés (dérivés du code)

| # | Traitement | Données personnelles | Personnes | Base légale (à confirmer) | Conservation (à définir) | Localisation |
|---|---|---|---|---|---|---|
| T1 | Gestion des clients du garage | nom, téléphone, e-mail, adresse | clients finaux | exécution du contrat / intérêt légitime du garage | durée relation + prescription légale | app (SQLite desktop ou PostgreSQL) |
| T2 | Véhicules & interventions | immatriculation, VIN, historique | clients finaux | idem T1 | idem T1 | app |
| T3 | Devis / factures / OR | identité, montants, signature | clients finaux | **obligation légale** (facturation) | **conservation légale comptable (ex. 10 ans)** | app + export FEC |
| T4 | Portail client (comptes) | e-mail, mot de passe (bcrypt), 2FA (TOTP chiffré), appareils | clients finaux | exécution du contrat / consentement (2FA) | durée du compte + purge | app (`PortalUser`, `PortalDevice`) |
| T5 | Comptes staff du garage | identité, rôle, mot de passe (bcrypt) | employés du garage | exécution du contrat de travail / intérêt légitime | durée d'emploi | app (`User`) |
| T6 | Licences & appareils | HWID (haché HMAC), IP, pays | postes du garage | exécution du contrat de licence | durée de la licence | control-plane (PostgreSQL) |
| T7 | Journal d'audit | acteur, cible, IP, pays, action | opérateurs / clients | intérêt légitime (sécurité) | durée de sécurité à définir | control-plane (`AuditLog`) |
| T8 | Rapports de crash | version, trace (rédigée), licenseId, HWID haché, IP, pays | postes du garage | **consentement** (consent:true exigé) | durée de diagnostic à définir | control-plane (`CrashReport`) |
| T9 | Leads / contact | nom, e-mail, téléphone, message, IP, user-agent | prospects | consentement / intérêt légitime | à définir | control-plane (`Lead`) |
| T10 | Newsletter | e-mail | abonnés | **consentement** (double opt-in implémenté) | jusqu'au désabonnement | control-plane (`NewsletterSubscriber`) |
| T11 | Notifications produit | licenseId, HWID, pays | postes du garage | intérêt légitime | à définir | control-plane (`Notification`) |

## Mesures techniques observées (art. 32)

- Mots de passe : bcrypt (coût 12). 2FA TOTP : secret **chiffré au repos**
  (AES-256-GCM). SMTP : mot de passe chiffré. HWID : **haché HMAC** avant
  persistance. Crash reports : rédaction des champs sensibles
  (`sanitizeCrashReport`, testée).
- Chiffrement en transit (HTTPS/TLS), sauvegardes **chiffrées** (AES-256-GCM,
  restauration prouvée — `restore-roundtrip.test.ts`).
- Cloisonnement multi-garage prouvé (isolation testée — lot C).
- Journalisation d'audit avec pseudonymisation des IP dans les clés de rate
  limiting.

## Sous-traitants ultérieurs (art. 28.2) — à contractualiser

| Sous-traitant | Rôle | Localisation à confirmer |
|---|---|---|
| Neon | base PostgreSQL (control-plane) | **UE à confirmer** |
| Vercel | hébergement PWA / vitrine | **UE à confirmer** |
| Upstash | Redis (rate limiting distribué) | **UE à confirmer** |
| Fournisseur SMTP | e-mails transactionnels | à confirmer |
| Anthropic | assistant IA (copilot) — si données personnelles transmises | **à évaluer** |

## Lacunes bloquantes pour la conformité (à traiter par le responsable/DPO)

1. **DPA art. 28** éditeur ↔ garages : absent (modèle à rédiger).
2. **Bases légales & durées de conservation** : à qualifier traitement par
   traitement (colonnes « à confirmer/définir » ci-dessus).
3. **Mentions d'information & politique de confidentialité** opposables :
   la page publique existe mais affirme des garanties (art. 28, localisation UE)
   non étayées (AUD-014) — à aligner sur la réalité contractuelle.
4. **Gestion des cookies / consentement** : aucun mécanisme trouvé côté vitrine
   alors que la page RGPD le promet.
5. **Procédures droits des personnes** (accès, effacement, portabilité) et
   **violation de données** (notification 72 h) : à formaliser.
6. **Localisation UE effective** des sous-traitants (Neon/Vercel/Upstash) : à
   documenter avec preuves (régions de déploiement).

> Ces lacunes relèvent d'une **revue juridique externe obligatoire** (assignée
> dans `docs/audit/AUDIT_EXECUTION_PLAN.md`) — non réalisable par l'audit
> technique.
