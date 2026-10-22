'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

async function helpers() {
  return import('../scripts/lib/production-sbom.mjs')
}

function fixture() {
  return {
    sbom: {
      bomFormat: 'CycloneDX',
      metadata: { component: { 'bom-ref': 'app@1.0.0' } },
      components: [
        { 'bom-ref': 'prod@1.0.0', name: 'prod', version: '1.0.0', licenses: [{ license: { id: 'MIT' } }] },
        { 'bom-ref': 'optional@2.0.0', name: 'optional', version: '2.0.0', licenses: [{ license: { id: 'ISC' } }] },
        { 'bom-ref': 'dev@3.0.0', name: 'dev', version: '3.0.0', licenses: [{ license: { id: 'Apache-2.0' } }] },
      ],
      dependencies: [
        { ref: 'app@1.0.0', dependsOn: ['prod@1.0.0', 'optional@2.0.0', 'dev@3.0.0'] },
        { ref: 'prod@1.0.0', dependsOn: ['dev@3.0.0'] },
        { ref: 'optional@2.0.0', dependsOn: [] },
        { ref: 'dev@3.0.0', dependsOn: [] },
      ],
    },
    tree: {
      dependencies: {
        prod: {
          version: '1.0.0',
          path: path.join(process.cwd(), 'node_modules/prod'),
          dependencies: {
            optional: {
              version: '2.0.0',
              path: path.join(process.cwd(), 'node_modules/prod/node_modules/optional'),
            },
          },
        },
      },
    },
  }
}

test('production SBOM keeps devOptional production packages and prunes development graph', async () => {
  const { filterProductionSbom } = await helpers()
  const { sbom, tree } = fixture()
  const result = filterProductionSbom(sbom, tree)
  assert.deepEqual(result.components.map((component) => component.name), ['prod', 'optional'])
  assert.equal(result.components[0].licenses[0].license.id, 'MIT')
  assert.equal(
    result.components[0].properties.find((property) => property.name === 'cdx:npm:package:path').value,
    'node_modules/prod',
  )
  assert.equal(
    result.components[0].properties.find((property) => property.name === 'cdx:npm:package:development').value,
    'false',
  )
  assert.deepEqual(result.dependencies.find((entry) => entry.ref === 'app@1.0.0').dependsOn, [
    'prod@1.0.0',
    'optional@2.0.0',
  ])
  assert.deepEqual(result.dependencies.find((entry) => entry.ref === 'prod@1.0.0').dependsOn, [])
  assert.equal(result.dependencies.some((entry) => entry.ref === 'dev@3.0.0'), false)
})

test('production SBOM fails closed when npm metadata is incomplete', async () => {
  const { filterProductionSbom } = await helpers()
  const { sbom, tree } = fixture()
  tree.dependencies.missing = {
    version: '9.0.0',
    path: path.join(process.cwd(), 'node_modules/missing'),
  }
  assert.throws(() => filterProductionSbom(sbom, tree), /missing production packages: missing@9\.0\.0/)
})

test('production SBOM rejects ambiguous name@version instead of choosing a license arbitrarily', async () => {
  const { filterProductionSbom } = await helpers()
  const { sbom, tree } = fixture()
  sbom.components.push({
    'bom-ref': 'nested/prod@1.0.0',
    name: 'prod',
    version: '1.0.0',
  })
  sbom.dependencies.push({ ref: 'nested/prod@1.0.0', dependsOn: [] })
  assert.throws(() => filterProductionSbom(sbom, tree), /Ambiguous production name@version/)
})

test('production SBOM rejects different physical locations for one name@version', async () => {
  const { filterProductionSbom } = await helpers()
  const { sbom, tree } = fixture()
  tree.dependencies.prod.dependencies.optional.dependencies = {
    prod: {
      version: '1.0.0',
      path: path.join(process.cwd(), 'node_modules/other/node_modules/prod'),
    },
  }
  assert.throws(() => filterProductionSbom(sbom, tree), /Ambiguous physical production locations: prod@1\.0\.0/)
})

test('production SBOM requires a complete dependency graph', async () => {
  const { filterProductionSbom } = await helpers()
  const { sbom, tree } = fixture()
  sbom.dependencies = sbom.dependencies.filter((entry) => entry.ref !== 'optional@2.0.0')
  assert.throws(() => filterProductionSbom(sbom, tree), /dependency graph is incomplete/)
})
