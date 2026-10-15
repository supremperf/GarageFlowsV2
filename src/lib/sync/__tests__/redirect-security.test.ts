/** Real local HTTP redirect, no remote authority/provider, no authenticated production. */
import {afterEach,expect,it,vi} from 'vitest'
import http from 'node:http'
import {cloudPost} from '../cloud-client'
vi.mock('@/lib/db',()=>({isPostgresDatabase:()=>false}))
afterEach(()=>vi.unstubAllEnvs())
it('does not forward a synthetic private request body to a redirect recipient',async()=>{
 let recipients=0,origins=0
 const recipient=http.createServer((_req,res)=>{recipients++;res.end('{"ok":true}')})
 const origin=http.createServer((_req,res)=>{origins++;const address=recipient.address();if(!address||typeof address==='string')throw new Error('Expected fixture TCP port');res.writeHead(307,{location:`http://127.0.0.1:${address.port}/capture`});res.end()})
 try{
  await new Promise<void>(resolve=>recipient.listen(0,'127.0.0.1',resolve))
  await new Promise<void>(resolve=>origin.listen(0,'127.0.0.1',resolve))
  const address=origin.address();if(!address||typeof address==='string')throw new Error('Expected fixture TCP port')
  vi.stubEnv('GF_LICENSE_SERVER',`http://127.0.0.1:${address.port}`);vi.stubEnv('GF_ALLOW_INSECURE_SYNC','1')
  expect(await cloudPost('/synthetic',{privateFixture:'DO_NOT_FORWARD'})).toEqual({ok:false,code:'NETWORK'})
  expect(origins).toBe(1);expect(recipients).toBe(0)
 }finally{
  await Promise.all([new Promise<void>((resolve,reject)=>origin.close(e=>e?reject(e):resolve())),new Promise<void>((resolve,reject)=>recipient.close(e=>e?reject(e):resolve()))])
 }
})
