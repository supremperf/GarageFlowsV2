'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('supplier production route fails closed instead of converting local cost data into quotes', () => {
  const route = read('src/app/api/suppliers/route.ts')
  assert.match(route, /SUPPLIER_INTEGRATION_REQUIRED/)
  assert.match(route, /NextResponse\.json\(SUPPLIER_INTEGRATION_UNAVAILABLE, \{ status: 501 \}\)/)
  assert.doesNotMatch(route, /StaticConnector|FallbackConnector|SupplierEngine|ASSUMED_AVAILABLE|DEFAULT_LEAD_TIME_DAYS|connectorsFromParts/)
  assert.doesNotMatch(route, /purchaseOrder\.create\(/)
  assert.match(route, /if \(body\.action === 'create-orders'\)/)
  assert.match(route, /where: \{ id: body\.orderId, garageId \}/)
})

test('supplier panel discloses the missing live integration and does not request fabricated quotes', () => {
  const panel = read('src/components/SuppliersPanel.tsx')
  assert.doesNotMatch(panel, /fetch\(['"]\/api\/suppliers['"]|action:\s*['"]create-orders['"]|supPrepare|supConfirmQ/)
  assert.match(panel, /supIntegrationTitle/)
  assert.match(panel, /supIntegrationBody/)
  assert.match(panel, /\/api\/purchase-orders/)
})

test('journal-only internal notifications are never marked configured or sent', () => {
  const channels = read('src/lib/notifications/channels.ts')
  const internal = channels.match(/export class InternalProvider[\s\S]*?\n}\n/)
  assert.ok(internal, 'InternalProvider must remain explicit until a recipient-visible inbox exists')
  assert.match(internal[0], /isConfigured\(\): boolean\s*\{\s*return false\s*\}/)
  assert.match(internal[0], /return \{ ok: false, error: 'not_configured' \}/)

  const route = read('src/app/api/notifications/dispatch/route.ts')
  assert.doesNotMatch(route, /MockProvider/)
  assert.match(route, /is not delivery to the named recipient/)
})
