import { expect, it } from 'vitest'
import { JsonResponseError, readJsonObject } from '../bounded-json-response'

it('decodes a split UTF8 codepoint once and returns only JSON objects', async () => {
  const bytes = new TextEncoder().encode('{"ok":true,"name":"Réparation 🚗"}')
  const cut = bytes.length - 4
  const response = new Response(new ReadableStream({ start(controller) {
    controller.enqueue(bytes.slice(0, cut)); controller.enqueue(bytes.slice(cut)); controller.close()
  } }))
  expect(await readJsonObject(response, { maxBytes: 1024 })).toEqual({ ok: true, name: 'Réparation 🚗' })
})
it.each(['[]', 'true', '123', 'null', '"text"', '{', '<html>unavailable</html>'])('rejects non-object/malformed body %s', async text => {
  await expect(readJsonObject(new Response(text), { maxBytes: 1024 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('cancels an announced oversized body before reading it', async () => {
  let canceled = false
  const response = new Response(new ReadableStream({ cancel() { canceled = true } }), { headers: { 'content-length': '9999' } })
  await expect(readJsonObject(response, { maxBytes: 32 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  expect(canceled).toBe(true)
})
it('counts actual bytes even if Content-Length is absent or false', async () => {
  const headerSets: HeadersInit[] = [{}, { 'content-length': '1' }]
  for (const headers of headerSets) {
    await expect(readJsonObject(new Response('{"data":"' + 'x'.repeat(100) + '"}', { headers }), { maxBytes: 32 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  }
})
it('bounds chunk overhead and cancels rather than accepting an incomplete prefix', async () => {
  let canceled = false
  const response = new Response(new ReadableStream({ start(controller) {
    for (const text of ['{', '"ok":true', '}']) controller.enqueue(new TextEncoder().encode(text))
  }, cancel() { canceled = true } }))
  await expect(readJsonObject(response, { maxBytes: 1024, maxChunks: 2 })).rejects.toMatchObject({ code: 'RESPONSE_TOO_FRAGMENTED' })
  expect(canceled).toBe(true)
})
it('abort cancels a pending reader without depending on the fetch mock to reject', async () => {
  let canceled = false
  const signal = new AbortController()
  const response = new Response(new ReadableStream({ cancel() { canceled = true } }))
  const reading = readJsonObject(response, { maxBytes: 1024, signal: signal.signal })
  signal.abort()
  await expect(reading).rejects.toMatchObject({ code: 'TIMEOUT' })
  expect(canceled).toBe(true)
})
it('refuses invalid UTF8 rather than silently replacing bytes', async () => {
  const prefix = new TextEncoder().encode('{"value":"'), suffix = new TextEncoder().encode('"}')
  const bytes = new Uint8Array([...prefix, 0xff, ...suffix])
  await expect(readJsonObject(new Response(bytes), { maxBytes: 1024 })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
})
it('rejects invalid budgets and pre-aborted input with controlled errors', async () => {
  await expect(readJsonObject(new Response('{}'), { maxBytes: -1 })).rejects.toBeInstanceOf(JsonResponseError)
  const signal = new AbortController(); signal.abort()
  await expect(readJsonObject(new Response('{}'), { maxBytes: 100, signal: signal.signal })).rejects.toMatchObject({ code: 'TIMEOUT' })
})
