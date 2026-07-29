import type { MetadataRoute } from 'next'

/**
 * Application privée (app.garageflows.fr) : aucun contenu ne doit être indexé.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  }
}
