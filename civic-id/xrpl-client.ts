import { Client } from 'xrpl'
import * as dotenv from 'dotenv'

dotenv.config()

export const XRPL_NETWORK = process.env.XRPL_NETWORK ?? 'wss://s.altnet.rippletest.net:51233'
export const ISSUER_ADDRESS = process.env.ISSUER_ADDRESS ?? ''
export const ISSUER_SECRET  = process.env.ISSUER_SECRET  ?? ''
export const NFT_TRANSFER_FEE     = parseInt(process.env.NFT_TRANSFER_FEE    ?? '0', 10)
export const CIVIC_IDENTITY_TAXON = parseInt(process.env.CIVIC_IDENTITY_TAXON ?? '1000', 10)
export const METADATA_BASE_URI    = process.env.METADATA_BASE_URI ?? ''

// ─── NFT flags (XLS-20) ──────────────────────────────────────────────────────
// tfBurnable    (0x0001) — issuer CAN burn the token (allows revocation)
// tfOnlyXRP     (0x0002) — transfer only allowed in XRP (not relevant for soulbound)
// tfTransferable(0x0008) — if NOT set, the token is non-transferable (soulbound)
//
// For a soulbound civic identity NFT:
//   SET   tfBurnable     → issuing authority can revoke compromised identities
//   UNSET tfTransferable → holder cannot transfer or sell their identity token
export const NFT_FLAGS = {
  BURNABLE:     0x00000001,
  ONLY_XRP:     0x00000002,
  TRANSFERABLE: 0x00000008,
} as const

// Our civic identity NFTs are BURNABLE (issuer can revoke) but NOT TRANSFERABLE
export const CIVIC_NFT_FLAGS = NFT_FLAGS.BURNABLE  // = 1

export async function getClient(): Promise<Client> {
  const client = new Client(XRPL_NETWORK)
  await client.connect()
  return client
}

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await getClient()
  try {
    return await fn(client)
  } finally {
    await client.disconnect()
  }
}
