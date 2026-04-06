/**
 * revoke-identity.ts
 *
 * Revokes (burns) a civic identity NFT.
 *
 * When to revoke:
 *  - Citizen's wallet is compromised
 *  - Identity fraud detected (duplicate biometric)
 *  - End of governance cycle (batch re-issuance)
 *  - Citizen requests removal
 *
 * Only the ISSUER can burn — tfBurnable grants this right to the minting account.
 * The citizen cannot burn their own identity token.
 *
 * After revocation, a new identity can be re-issued to a new wallet address.
 *
 * Usage:
 *   npm run revoke:identity -- --nftId <NFTokenID> --reason "<reason>"
 */

import { Wallet, NFTokenBurn, convertStringToHex } from 'xrpl'
import { withClient, ISSUER_SECRET } from './xrpl-client'
import chalk from 'chalk'

export async function revokeIdentity(
  nftTokenId: string,
  reason: string = 'unspecified',
): Promise<{ txHash: string; ledgerIndex: number }> {
  console.log(chalk.bold('\n🗑  Revoking civic identity NFT'))
  console.log(chalk.gray(`NFTokenID: ${nftTokenId}`))
  console.log(chalk.yellow(`Reason:    ${reason}`))

  return withClient(async (client) => {
    const issuerWallet = Wallet.fromSecret(ISSUER_SECRET)

    const burnTx: NFTokenBurn = {
      TransactionType: 'NFTokenBurn',
      Account: issuerWallet.address,
      NFTokenID: nftTokenId,
      Memos: [
        {
          Memo: {
            MemoType: convertStringToHex('civic-identity/revocation-reason'),
            MemoData: convertStringToHex(reason),
          },
        },
        {
          Memo: {
            MemoType: convertStringToHex('civic-identity/revoked-at'),
            MemoData: convertStringToHex(new Date().toISOString()),
          },
        },
      ],
    }

    const prepared = await client.autofill(burnTx)
    const signed   = issuerWallet.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    const txResult =
      result.result.meta && typeof result.result.meta !== 'string'
        ? result.result.meta.TransactionResult
        : 'unknown'

    if (txResult !== 'tesSUCCESS') {
      throw new Error(`NFTokenBurn failed: ${txResult}`)
    }

    console.log(chalk.green('\n✅ Identity NFT revoked'))
    console.log(chalk.gray(`   TX hash:   ${result.result.hash}`))
    console.log(chalk.gray(`   Ledger:    ${result.result.ledger_index}`))

    return {
      txHash: result.result.hash,
      ledgerIndex: result.result.ledger_index ?? 0,
    }
  })
}

// CLI entrypoint
if (require.main === module) {
  const args = process.argv.slice(2)
  const nftIdFlag  = args.indexOf('--nftId')
  const reasonFlag = args.indexOf('--reason')

  const nftId  = nftIdFlag  >= 0 ? args[nftIdFlag + 1]  : null
  const reason = reasonFlag >= 0 ? args[reasonFlag + 1] : 'admin revocation'

  if (!nftId) {
    console.error(chalk.red('Usage: npm run revoke:identity -- --nftId <NFTokenID> --reason "<reason>"'))
    process.exit(1)
  }

  revokeIdentity(nftId, reason).catch((err) => {
    console.error(chalk.red('Revocation failed:'), err)
    process.exit(1)
  })
}
