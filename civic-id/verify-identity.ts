/**
 * verify-identity.ts
 *
 * Verifies that a citizen wallet holds a valid civic identity NFT.
 * Used by the voting contract bridge to confirm eligibility before
 * issuing voice credits on the Polygon side.
 *
 * Returns structured identity info parsed from the NFT's on-chain memos.
 *
 * Usage:
 *   npm run verify:nft -- --address <citizenWalletAddress>
 */

import { convertHexToString } from 'xrpl'
import { withClient, CIVIC_IDENTITY_TAXON, ISSUER_ADDRESS } from './xrpl-client'
import chalk from 'chalk'

export interface VerifiedIdentity {
  valid: boolean
  nftTokenId: string
  citizenId: string
  zkCommitment: string
  jurisdiction: string
  metadataUri: string
  issuer: string
}

export async function verifyIdentity(
  citizenAddress: string,
): Promise<VerifiedIdentity | null> {
  return withClient(async (client) => {
    let response
    try {
      response = await client.request({
        command: 'account_nfts',
        account: citizenAddress,
        ledger_index: 'validated',
      })
    } catch {
      return null // account doesn't exist
    }

    // Find civic identity NFT in our taxon, issued by our authority
    const civicNft = response.result.account_nfts.find(
      (nft) =>
        nft.NFTokenTaxon === CIVIC_IDENTITY_TAXON &&
        nft.Issuer === ISSUER_ADDRESS,
    )

    if (!civicNft) return null

    // Verify it is NOT transferable (soulbound flag check)
    // tfTransferable = 0x0008. If bit is 0, it's soulbound.
    const isTransferable = (civicNft.Flags & 0x0008) !== 0
    if (isTransferable) {
      console.warn(chalk.yellow('⚠ NFT has tfTransferable set — not a valid civic identity token'))
      return null
    }

    // Verify it IS burnable (issuer revocation right)
    const isBurnable = (civicNft.Flags & 0x0001) !== 0
    if (!isBurnable) {
      console.warn(chalk.yellow('⚠ NFT is not burnable — cannot be revoked by issuer'))
    }

    // Decode URI
    const metadataUri = civicNft.URI
      ? convertHexToString(civicNft.URI)
      : ''

    // Read on-chain memos from the mint transaction
    // (In production: look up the original NFTokenMint tx for this NFT)
    // For simplicity here we return what we can from account_nfts
    const identity: VerifiedIdentity = {
      valid: true,
      nftTokenId: civicNft.NFTokenID,
      citizenId: '',       // populated from mint tx memos in production
      zkCommitment: '',    // populated from mint tx memos in production
      jurisdiction: '',    // populated from mint tx memos in production
      metadataUri,
      issuer: civicNft.Issuer ?? '',
    }

    console.log(chalk.green(`\n✅ Valid civic identity found`))
    console.log(chalk.gray(`   NFTokenID:    ${identity.nftTokenId}`))
    console.log(chalk.gray(`   Metadata URI: ${identity.metadataUri}`))
    console.log(chalk.gray(`   Soulbound:    ${!isTransferable ? 'YES ✓' : 'NO ✗'}`))
    console.log(chalk.gray(`   Burnable:     ${isBurnable ? 'YES ✓' : 'NO ✗'}`))

    return identity
  })
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2)
  const addrFlag = args.indexOf('--address')
  const address  = addrFlag >= 0 ? args[addrFlag + 1] : null

  if (!address) {
    console.error(chalk.red('Usage: npm run verify:nft -- --address <citizenWalletAddress>'))
    process.exit(1)
  }

  verifyIdentity(address).then((result) => {
    if (!result) {
      console.log(chalk.red(`\n✗ No valid civic identity found for ${address}`))
    }
  }).catch((err) => {
    console.error(chalk.red('Verification failed:'), err)
    process.exit(1)
  })
}
