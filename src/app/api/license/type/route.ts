export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

// GET /api/license/type — returns the current license type from cookie
export async function GET() {
  const jar = await cookies()
  const licenseType = jar.get('gf_license_type')?.value ?? 'trial'
  return NextResponse.json({ licenseType })
}
