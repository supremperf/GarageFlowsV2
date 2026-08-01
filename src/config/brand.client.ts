/**
 * Marque côté CLIENT — sûr pour les composants « use client » (aucun accès fs).
 *
 * Résout un sous-ensemble d'identité (nom, wordmark, couleurs, tagline) depuis
 * les défauts partagés (brand.defaults.ts) surchargés par les variables
 * `NEXT_PUBLIC_GF_BRAND_*` (les seules exposées au navigateur par Next.js — elles
 * sont figées au build). Le serveur utilise src/config/brand.ts (Zod + fichier).
 *
 * Les valeurs par défaut proviennent de la MÊME source que le serveur
 * (brand.defaults.ts) : pas de dérive. Un test le vérifie.
 */
import { DEFAULT_BRAND, type ClientBrand } from './brand.defaults'

function pick(v: string | undefined, fallback: string): string {
  return v && v.trim() ? v.trim() : fallback
}

/** Identité de marque résolue pour le client (défauts ← NEXT_PUBLIC_GF_BRAND_*). */
export const CLIENT_BRAND: ClientBrand = {
  productName: pick(process.env.NEXT_PUBLIC_GF_BRAND_PRODUCT_NAME, DEFAULT_BRAND.productName),
  shortName: pick(process.env.NEXT_PUBLIC_GF_BRAND_SHORT_NAME, DEFAULT_BRAND.shortName),
  tagline: pick(process.env.NEXT_PUBLIC_GF_BRAND_TAGLINE, DEFAULT_BRAND.tagline),
  wordmark: {
    primary: pick(process.env.NEXT_PUBLIC_GF_BRAND_WORDMARK_PRIMARY, DEFAULT_BRAND.wordmark.primary),
    secondary: pick(process.env.NEXT_PUBLIC_GF_BRAND_WORDMARK_SECONDARY, DEFAULT_BRAND.wordmark.secondary),
  },
  colors: {
    primary: pick(process.env.NEXT_PUBLIC_GF_BRAND_PRIMARY_COLOR, DEFAULT_BRAND.colors.primary),
    primaryDark: pick(process.env.NEXT_PUBLIC_GF_BRAND_PRIMARY_DARK_COLOR, DEFAULT_BRAND.colors.primaryDark),
    accent: pick(process.env.NEXT_PUBLIC_GF_BRAND_ACCENT_COLOR, DEFAULT_BRAND.colors.accent),
  },
  supportUrl: pick(process.env.NEXT_PUBLIC_GF_BRAND_SUPPORT_URL, DEFAULT_BRAND.support.url),
  marketingDomain: pick(process.env.NEXT_PUBLIC_GF_BRAND_MARKETING_DOMAIN, DEFAULT_BRAND.domains.marketing),
}
