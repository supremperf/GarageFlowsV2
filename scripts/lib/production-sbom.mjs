import path from 'node:path'

/**
 * Pure CycloneDX helpers. Package metadata always comes from npm SBOM and
 * physical production locations from npm ls --long; this module only selects
 * and reconciles those two sources.
 */

function productionPackages(tree) {
  const keys = new Set()
  const locations = new Map()
  const visit = (dependencies) => {
    for (const [name, node] of Object.entries(dependencies || {})) {
      if (node?.version) {
        const key = `${name}@${node.version}`
        keys.add(key)
        if (typeof node.path !== 'string' || !node.path) {
          throw new Error(`npm ls --long did not provide a physical path for ${key}`)
        }
        const relative = path.relative(process.cwd(), node.path)
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`Production package path escapes the project: ${key}`)
        }
        const paths = locations.get(key) || new Set()
        paths.add(relative)
        locations.set(key, paths)
      }
      visit(node?.dependencies)
    }
  }
  visit(tree?.dependencies)
  const ambiguous = [...locations].filter(([, paths]) => paths.size !== 1)
  if (ambiguous.length) {
    throw new Error(
      `Ambiguous physical production locations: ${ambiguous.map(([key]) => key).sort().join(', ')}`,
    )
  }
  return {
    keys,
    locations: new Map([...locations].map(([key, paths]) => [key, [...paths][0]])),
  }
}

export function productionPackageKeys(tree) {
  return productionPackages(tree).keys
}

export function filterProductionSbom(fullSbom, productionTree) {
  if (fullSbom?.bomFormat !== 'CycloneDX' || !Array.isArray(fullSbom.components)) {
    throw new Error('A CycloneDX SBOM with components is required')
  }
  const production = productionPackages(productionTree)
  const wanted = production.keys
  const byKey = new Map()
  for (const component of fullSbom.components) {
    if (!component.name || !component.version) continue
    const key = `${component.name}@${component.version}`
    const entries = byKey.get(key) || []
    entries.push(component)
    byKey.set(key, entries)
  }
  const missing = [...wanted].filter((key) => !byKey.has(key)).sort()
  if (missing.length) {
    throw new Error(`npm SBOM is missing production packages: ${missing.join(', ')}`)
  }
  const ambiguous = [...wanted].filter((key) => byKey.get(key).length !== 1).sort()
  if (ambiguous.length) {
    throw new Error(`Ambiguous production name@version in npm SBOM: ${ambiguous.join(', ')}`)
  }

  const components = fullSbom.components
    .filter((component) => wanted.has(`${component.name}@${component.version}`))
    .map((component) => {
      const key = `${component.name}@${component.version}`
      const properties = (component.properties || []).filter(
        (property) =>
          property.name !== 'cdx:npm:package:path' &&
          property.name !== 'cdx:npm:package:development',
      )
      properties.push(
        { name: 'cdx:npm:package:path', value: production.locations.get(key) },
        { name: 'cdx:npm:package:development', value: 'false' },
      )
      return { ...component, properties }
    })
  const rootRef = fullSbom.metadata?.component?.['bom-ref']
  if (!rootRef) throw new Error('The root CycloneDX metadata component/bom-ref is required')
  const allowedRefs = new Set([rootRef, ...components.map((component) => component['bom-ref'])])
  if (allowedRefs.has(undefined)) throw new Error('Every production component needs a bom-ref')

  const dependencyByRef = new Map((fullSbom.dependencies || []).map((entry) => [entry.ref, entry]))
  const missingGraph = [...allowedRefs].filter((ref) => !dependencyByRef.has(ref)).sort()
  if (missingGraph.length) {
    throw new Error(`npm SBOM dependency graph is incomplete: ${missingGraph.join(', ')}`)
  }
  const dependencies = [...allowedRefs].map((ref) => {
    const entry = dependencyByRef.get(ref)
    return {
      ref,
      dependsOn: (entry.dependsOn || []).filter((dependency) => allowedRefs.has(dependency)),
    }
  })

  return {
    ...fullSbom,
    metadata: {
      ...fullSbom.metadata,
      properties: [
        ...(fullSbom.metadata.properties || []).filter(
          (property) => !property.name?.startsWith('garageflows:sbom:'),
        ),
        {
          name: 'garageflows:sbom:production-filter',
          value: 'npm ls --omit=dev --all --json --long',
        },
        {
          name: 'garageflows:sbom:source',
          value: 'npm sbom --include=dev --include=optional --sbom-format cyclonedx --sbom-type application',
        },
        { name: 'garageflows:sbom:full-components', value: String(fullSbom.components.length) },
        { name: 'garageflows:sbom:production-components', value: String(components.length) },
      ],
    },
    components,
    dependencies,
  }
}
