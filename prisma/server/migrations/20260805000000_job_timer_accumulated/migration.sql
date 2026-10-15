-- Chrono mécanicien (§6) : secondes accumulées sur les segments terminés
-- (pause/reprise sans perte de temps). Additif, DEFAULT 0 (rétro-compatible).
ALTER TABLE "Job" ADD COLUMN     "timerAccumulatedSec" INTEGER NOT NULL DEFAULT 0;
