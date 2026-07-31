/**
 * Central application configuration.
 * All magic numbers and tunable constants live here.
 *
 * Product identity (name, colours, domains, legal, e-mail…) lives in the
 * white-label layer at src/config/brand.ts and is surfaced here via BRAND so
 * there is a single source of truth. See docs/WHITE_LABEL_GUIDE.md.
 */

import { BRAND } from './brand'

export const APP_CONFIG = {
  name:    BRAND.productName,
  version: '2.0',

  /** Default pagination limit when ?limit is not specified */
  defaultPageLimit: 20,

  /** Maximum pagination limit per request */
  maxPageLimit: 100,

  /** Rate limits (requests / window) */
  rateLimit: {
    api:   { max: 120, windowMs: 60_000 },       // 120 req/min
    login: { max: 10,  windowMs: 5 * 60_000 },   // 10 attempts/5 min
  },

  /** User roles in order of privilege (highest first) */
  roles: ['OWNER', 'MANAGER', 'MECHANIC', 'RECEPTIONIST', 'VIEWER'] as const,

  /** Roles that can manage users and garage settings */
  managerRoles: ['OWNER', 'MANAGER'] as const,

  /** Roles with full read/write on operational data (jobs, clients, etc.) */
  operatorRoles: ['OWNER', 'MANAGER', 'MECHANIC', 'RECEPTIONIST'] as const,

  /** Read-only role */
  viewerRole: 'VIEWER' as const,

  /** Max logo size in bytes (base64-encoded) */
  maxLogoBase64: 512 * 1024,

  /** Audit log retention: how many days to keep (0 = forever) */
  auditRetentionDays: 0,
} as const

export type AppRole = typeof APP_CONFIG.roles[number]
