-- GF-PORT-001 — cycle de vie de l'accès portail client.
--
-- STRICTEMENT ADDITIVE : trois colonnes, aucune lecture ni réécriture des
-- données existantes, aucune suppression, rien rendu obligatoire.
--
--   disabledAt         NULL = accès ACTIF. Permet au garage de couper l'accès
--                      portail d'un client sans supprimer le compte — donc sans
--                      perdre ses tickets, ses rendez-vous ni son historique.
--   mustChangePassword le mot de passe en place est TEMPORAIRE (remis par le
--                      garage à la création de l'accès ou à une réinitialisation).
--                      Tant que le drapeau est levé, la seule action permise est
--                      le changement de mot de passe.
--   passwordChangedAt  distingue un compte jamais utilisé d'un compte actif, et
--                      sert de trace d'audit.
--
-- `mustChangePassword` vaut FALSE par défaut : les comptes existants ont été
-- créés par auto-inscription, avec un mot de passe déjà choisi par leur
-- titulaire. Les contraindre rétroactivement à en changer serait une régression
-- de service pour des comptes parfaitement légitimes.

ALTER TABLE "PortalUser" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "PortalUser" ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PortalUser" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
