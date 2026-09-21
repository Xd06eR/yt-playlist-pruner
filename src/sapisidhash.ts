/**
 * Computes the SAPISIDHASH Authorization header that YouTube's web client sends
 * on authenticated InnerTube mutations: SHA-1 of "<unixSeconds> <SAPISID> <origin>".
 * Pure function: the caller supplies the timestamp so the output is deterministic.
 */
export async function sapisidhash(sapisid: string, origin: string, nowSeconds: number): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${nowSeconds} ${sapisid} ${origin}`))
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `SAPISIDHASH ${hex}`
}
