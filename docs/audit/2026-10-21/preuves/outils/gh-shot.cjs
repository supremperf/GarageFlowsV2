const { chromium } = require('/home/user/GarageFlowsV2/node_modules/@playwright/test')
;(async () => {
  const [,, url, out, w, h] = process.argv
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: Number(w || 1400), height: Number(h || 1000) }, locale: 'fr-FR' })
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(e => console.error('goto:', e.message))
  await page.waitForTimeout(2500)
  await page.screenshot({ path: out, fullPage: false })
  console.log('title:', await page.title())
  await browser.close()
})()
