import { afterEach, describe, expect, it, vi } from 'vitest'
import { AnthropicClassifier, DEFAULT_MODEL, __setLlmProvider, resolveLlmProvider } from '../provider'
import { understand } from '@/lib/copilot/conversation'
import type { SemanticRequest } from '@/lib/copilot/semantic'
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();__setLlmProvider(undefined)})
describe('zero-spend production gate, not a verified positive monetary cap',()=>{
 it('all three dispatch paths and direct callers deny without any transport even with server opt-in',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  vi.stubEnv('GARAGEFLOW_LLM','anthropic');vi.stubEnv('ANTHROPIC_API_KEY','synthetic-test-only');vi.stubEnv('GARAGEFLOW_LLM_MODEL',DEFAULT_MODEL)
  const p=resolveLlmProvider()
  if(!(p instanceof AnthropicClassifier)) throw new Error('Expected closed configured provider')
  expect(p.status().state).toBe('unavailable')
  const request: SemanticRequest={query:'synthetic',context:{topics:[],hasReference:false,referenceAmbiguous:false,hasVin:false,hasSymptom:false},tools:[],articles:[],recentTurns:[]}
  await p.classify('stock',[])
  await p.plan(request)
  await p.interpret(request)
  expect(p.lastAttempt()?.outcome).toBe('budget_blocked');expect(fetcher).not.toHaveBeenCalled()
 })
 it('concurrent calls, retries and a fresh instance cannot reset the closed gate',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  await Promise.all(Array.from({length:100},()=>new AnthropicClassifier('synthetic',DEFAULT_MODEL).classify('stock',[])))
  const p=new AnthropicClassifier('synthetic',DEFAULT_MODEL);await p.classify('stock',[]);await p.classify('stock',[])
  expect(fetcher).not.toHaveBeenCalled()
 })
 it('abort, missing/invalid config and local fallbacks never create a second billable path',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  const p=new AnthropicClassifier('synthetic',DEFAULT_MODEL),signal=AbortSignal.abort()
  const a=await understand({query:'Stock bas',history:[]},'OWNER',p,{signal})
  expect(a.type).toBe('clarify')
  const b=await understand({query:'Stock bas',history:[]},'OWNER',p)
  expect(b.resolver).toBe('low_stock');expect(b.planning?.source).toBe('local')
  for(const setting of ['off','invalid','anthropic']){vi.stubEnv('GARAGEFLOW_LLM',setting);vi.stubEnv('ANTHROPIC_API_KEY','');expect(resolveLlmProvider()).toBeNull()}
  expect(fetcher).not.toHaveBeenCalled()
 })
 it('rejects an explicitly supplied transport outside the test runtime',async()=>{
  vi.stubEnv('NODE_ENV','production')
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  const p=new AnthropicClassifier('synthetic-placeholder',DEFAULT_MODEL,fetcher)
  expect(await p.classify('synthetic',[])).toBeNull()
  expect(await p.plan({query:'synthetic',context:{topics:[],hasReference:false,referenceAmbiguous:false,hasVin:false,hasSymptom:false},tools:[],articles:[]})).toBeNull()
  expect(await p.interpret({query:'synthetic',context:{topics:[],hasReference:false,referenceAmbiguous:false,hasVin:false,hasSymptom:false},tools:[],articles:[],recentTurns:[]})).toBeNull()
  expect(p.status().state).toBe('unavailable');expect(fetcher).not.toHaveBeenCalled()
 })
 it('cannot install or reuse a test override in the production factory',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher)
  const fake={id:'simulation',name:'simulation',phrase:async()=>{fetcher();return 'simulation'}}
  __setLlmProvider(fake)
  vi.stubEnv('NODE_ENV','production');vi.stubEnv('GARAGEFLOW_LLM','anthropic');vi.stubEnv('ANTHROPIC_API_KEY','synthetic-placeholder')
  expect(()=>__setLlmProvider(fake)).toThrow('Test provider injection forbidden outside test runtime')
  const p=resolveLlmProvider();expect(p).not.toBe(fake)
  if(!(p instanceof AnthropicClassifier)) throw new Error('Expected closed production provider')
  expect(await p.classify('synthetic',[])).toBeNull();expect(fetcher).not.toHaveBeenCalled()
 })

})
