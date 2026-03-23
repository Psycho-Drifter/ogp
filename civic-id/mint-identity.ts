/**
 * mint-identity.ts
 *
 * Mints a soulbound civic identity NFT to a verified citizen's wallet.
 *
 * Soulbound enforcement on XRPL (XLS-20):
 *   The NFTokenMint transaction does NOT set the tfTransferable flag.
 *   Without that flag, the XRPL ledger itself enforces non-transferability —
 *   any NFTokenCreateOffer or NFTokenAcceptOffer from the holder will be
 *   rejected at the protocol level. This is NOT application-layer enforcement;
 *   it is enforced by every validator on the network.
 *
 *   The tfBurnable flag IS set, allowing the issuing authority to revoke
 *   a compromised or fraudulent identity via NFTokenBurn.
 *
 * One-per-citizen enforcement:
 *   Before minting, this script checks that the citizen address does not
 *   already hold an NFT with our CIVIC_IDENTITY_TAXON. The ZK commitment
 *   also provides a second layer: duplicate biometrics will produce the
 *   same commitment hash, which can be checked off-chain before minting.
 *
 * Usage:
 *   Standalone test:  npm run mint:identity
 *   As a module:      import { mintCivicIdentity } from './mint-identity'
 */

import { Wallet, NFTokenMint, convertStringToHex } from 'xrpl'
import * as crypto from 'crypto'
import {
  withClient,
  ISSUER_SECRET,
  CIVIC_IDENTITY_TAXON,
  CIVIC_NFT_FLAGS,
  NFT_TRANSFER_FEE,
  METADATA_BASE_URI,
} from './xrpl-client'
import type { MintIdentityRequest, MintIdentityResult, CivicIdentityMetadata } from './types'
import chalk from 'chalk'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateCitizenId(): string {
  return crypto.randomUUID()
}

function buildMetadataUri(citizenId: string): string {
  const base = METADATA_BASE_URI || 'https://id.example-civic.org/v1/identity/'
  return `${base}${citizenId}`
}

function encodeUri(uri: string): string {
  // XRPL NFT URI field must be hex-encoded
  return convertStringToHex(uri)
}

// ─── One-per-citizen check ────────────────────────────────────────────────────

async function hasCivicIdentity(
  client: import('xrpl').Client,
  address: string,
): Promise<string | null> {
  try {
    const response = await client.request({
      command: 'account_nfts',
      account: address,
      ledger_index: 'validated',
    })

    const existing = response.result.account_nfts.find(
      (nft) => nft.NFTokenTaxon === CIVIC_IDENTITY_TAXON,
    )

    return existing ? existing.NFTokenID : null
  } catch {
    // account_nfts throws if account doesn't exist yet (unfunded wallet)
    // That's fine — they can't have an existing identity
    return null
  }
}

// ─── Core mint function ───────────────────────────────────────────────────────

export async function mintCivicIdentity(
  request: MintIdentityRequest,
): Promise<MintIdentityResult> {
  const {
    citizenAddress,
    zkCommitment,
    jurisdiction,
    governanceScope,
    voiceCredits = 100,
  } = request

  console.log(chalk.bold('\n🪪  Minting civic identity NFT'))
  console.log(chalk.gray(`Citizen: ${citizenAddress}`))
  console.log(chalk.gray(`Jurisdiction: ${jurisdiction}`))

  return withClient(async (client) => {
    const issuerWallet = Wallet.fromSecret(ISSUER_SECRET)

    // ── Guard: one identity per citizen ──────────────────────────────────────
    const existingId = await hasCivicIdentity(client, citizenAddress)
    if (existingId) {
      throw new Error(
        `Citizen ${citizenAddress} already holds a civic identity NFT: ${existingId}. ` +
          'Revoke the existing identity before re-issuing.',
      )
    }

    // ── Build off-chain metadata ──────────────────────────────────────────────
    const citizenId = generateCitizenId()
    const now = new Date()
    const expiresAt = new Date(now)
    expiresAt.setFullYear(now.getFullYear() + 1) // 1-year default cycle

    const metadata: CivicIdentityMetadata = {
      citizenId,
      jurisdiction,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      schemaVersion: '1.0',
      zkCommitment,
      governanceScope,
      voiceCredits,
    }

    // In production: POST metadata to your secure API before minting.
    // The NFT URI will then resolve to this metadata record.
    console.log(chalk.gray('\nMetadata to persist off-chain:'))
    console.log(chalk.gray(JSON.stringify(metadata, null, 2)))

    const metadataUri = buildMetadataUri(citizenId)

    // ── Construct the NFTokenMint transaction ─────────────────────────────────
    //
    // Key decisions:
    //
    // Flags = tfBurnable (1) only.
    //   tfTransferable is deliberately ABSENT — this makes the token soulbound
    //   at the protocol level. The XRPL ledger will reject any transfer attempt.
    //
    // TransferFee = 0
    //   No royalty. Civic identity is not a financial instrument.
    //
    // Taxon = CIVIC_IDENTITY_TAXON
    //   Groups all civic identity NFTs in a queryable namespace.
    //
    // URI = hex-encoded metadata endpoint
    //   Points to off-chain JSON describing the identity (jurisdiction, expiry, etc.)
    //   The URI is immutable once minted — update the metadata server, not the NFT.
    //
    // Memos:
    //   On-chain record of the ZK commitment hash and citizen ID.
    //   The ZK commitment lets anyone verify uniqueness without revealing PII.
    //
    const mintTx: NFTokenMint = {
      TransactionType: 'NFTokenMint',
      Account: issuerWallet.address,
      NFTokenTaxon: CIVIC_IDENTITY_TAXON,
      Flags: CIVIC_NFT_FLAGS,            // burnable, NOT transferable
      TransferFee: NFT_TRANSFER_FEE,     // 0
      URI: encodeUri(metadataUri),
      Memos: [
        {
          Memo: {
            MemoType: convertStringToHex('civic-identity/citizen-id'),
            MemoData: convertStringToHex(citizenId),
          },
        },
        {
          Memo: {
            MemoType: convertStringToHex('civic-identity/zk-commitment'),
            MemoData: convertStringToHex(zkCommitment),
          },
        },
        {
          Memo: {
            MemoType: convertStringToHex('civic-identity/jurisdiction'),
            MemoData: convertStringToHex(jurisdiction),
          },
        },
      ],
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    console.log(chalk.cyan('\nSubmitting NFTokenMint…'))
    const prepared = await client.autofill(mintTx)
    const signed   = issuerWallet.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    const txResult =
      result.result.meta && typeof result.result.meta !== 'string'
        ? result.result.meta.TransactionResult
        : 'unknown'

    if (txResult !== 'tesSUCCESS') {
      throw new Error(`NFTokenMint failed: ${txResult}`)
    }

    // ── Extract the NFTokenID ─────────────────────────────────────────────────
    let nftTokenId = ''
    if (result.result.meta && typeof result.result.meta !== 'string') {
      const nodes = result.result.meta.AffectedNodes ?? []
      for (const node of nodes) {
        const created = 'CreatedNode' in node ? node.CreatedNode : null
        if (created?.LedgerEntryType === 'NFTokenPage') {
          // The new NFT is the last entry in the newly created page
          const nfts = (created.NewFields as { NFTokens?: Array<{ NFToken: { NFTokenID: string } }> })?.NFTokens ?? []
          if (nfts.length > 0) {
            nftTokenId = nfts[nfts.length - 1].NFToken.NFTokenID
          }
        }
      }
    }

    const mintResult: MintIdentityResult = {
      txHash: result.result.hash,
      nftTokenId,
      citizenAddress,
      citizenId,
      ledgerIndex: result.result.ledger_index ?? 0,
    }

    console.log(chalk.green('\n✅ Civic identity NFT minted successfully'))
    console.log(chalk.gray(`   TX hash:     ${mintResult.txHash}`))
    console.log(chalk.gray(`   NFTokenID:   ${mintResult.nftTokenId}`))
    console.log(chalk.gray(`   Citizen ID:  ${mintResult.citizenId}`))
    console.log(chalk.gray(`   Ledger:      ${mintResult.ledgerIndex}`))
    console.log(
      chalk.gray(`   Explorer:    https://testnet.xrpl.org/transactions/${mintResult.txHash}`),
    )

    return mintResult
  })
}

// ─── CLI entrypoint (npm run mint:identity) ───────────────────────────────────

async function main() {
  // Demo: mint a test identity to a freshly funded testnet wallet
  const { Client, Wallet: XrplWallet } = await import('xrpl')
  const { XRPL_NETWORK } = await import('./xrpl-client')

  console.log(chalk.gray('Generating a test citizen wallet on testnet…'))
  const tempClient = new Client(XRPL_NETWORK)
  await tempClient.connect()
  const { wallet: citizenWallet } = await tempClient.fundWallet()
  await tempClient.disconnect()
  console.log(chalk.gray(`Test citizen wallet: ${citizenWallet.address}\n`))

  await mintCivicIdentity({
    citizenAddress: citizenWallet.address,
    zkCommitment:   '0x' + crypto.randomBytes(32).toString('hex'), // placeholder — real ZK commitment in prod
    jurisdiction:   'CA',
    governanceScope: ['federal', 'provincial-bc'],
    voiceCredits:   100,
  })
}

// Only run main() when executed directly
if (require.main === module) {
  const crypto = require('crypto')
  main().catch((err) => {
    console.error(chalk.red('Mint failed:'), err)
    process.exit(1)
  })
}
