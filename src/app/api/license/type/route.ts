import { licenseApiBoundary } from '@/lib/license/api-boundary'
export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

// GET /api/license/type — returns the current license type from cookie
async function handleGET() {
  const jar = await cookies()
  const licenseType = jar.get('gf_license_type')?.value ?? 'trial'
  return NextResponse.json({ licenseType })
}

export async function GET() {
  return licenseApiBoundary(() => handleGET())
}
