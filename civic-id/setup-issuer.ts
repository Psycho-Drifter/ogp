/**
 * setup-issuer.ts
 *
 * Run ONCE to create and configure the issuer (government authority) account.
 *
 * What this does:
 *   1. Generates a new XRPL wallet on testnet (or uses existing from .env)
 *   2. Funds it via the testnet faucet
 *   3. Configures AccountSet flags required for controlled NFT issuance:
 *      - asfRequireAuth  → the issuer must authorise every trustline (controlled issuance)
 *      - asfDisableMaster is NOT set here — keep master key active for now
 *   4. Prints credentials — copy these into your .env
 *
 * Usage:
 *   npm run setup:issuer
 */

import { Wallet, AccountSet, AccountSetAsfFlags } from 'xrpl'
import { withClient, ISSUER_ADDRESS, ISSUER_SECRET, XRPL_NETWORK } from './xrpl-client'
import chalk from 'chalk'

async function setupIssuer() {
  console.log(chalk.bold('\n🏛  Civic Identity — Issuer Account Setup'))
  console.log(chalk.gray(`Network: ${XRPL_NETWORK}\n`))

  await withClient(async (client) => {

    // ── Step 1: wallet ────────────────────────────────────────────────────────
    let issuerWallet: Wallet

    if (ISSUER_ADDRESS && ISSUER_SECRET) {
      console.log(chalk.yellow('Using existing issuer wallet from .env'))
      issuerWallet = Wallet.fromSecret(ISSUER_SECRET)
    } else {
      console.log(chalk.cyan('Generating new issuer wallet…'))
      const { wallet, balance } = await client.fundWallet()
      issuerWallet = wallet
      console.log(chalk.green(`✓ Wallet funded with ${balance} XRP (testnet faucet)`))
      console.log(chalk.bold('\n── Save these in your .env ──────────────────────'))
      console.log(`ISSUER_ADDRESS=${issuerWallet.address}`)
      console.log(`ISSUER_SECRET=${issuerWallet.seed}`)
      console.log(chalk.bold('─────────────────────────────────────────────────\n'))
    }

    // ── Step 2: account info ──────────────────────────────────────────────────
    const accountInfo = await client.request({
      command: 'account_info',
      account: issuerWallet.address,
      ledger_index: 'validated',
    })
    console.log(chalk.gray(`Account: ${issuerWallet.address}`))
    console.log(chalk.gray(`Balance: ${accountInfo.result.account_data.Balance} drops`))

    // ── Step 3: configure account flags ──────────────────────────────────────
    // asfRequireAuth (flag 2) — issuer must explicitly authorise trustlines.
    // This is the on-chain mechanism that ensures only this authority can
    // create civic identity NFTs. Citizens cannot self-mint.
    console.log(chalk.cyan('\nConfiguring issuer account flags…'))

    const accountSetTx: AccountSet = {
      TransactionType: 'AccountSet',
      Account: issuerWallet.address,
      // Set RequireAuth so only this issuer can authorise token holding
      SetFlag: AccountSetAsfFlags.asfRequireAuth,
      // Memo identifying this as a civic identity issuer account
      Memos: [
        {
          Memo: {
            MemoType: Buffer.from('civic-identity-issuer', 'utf8').toString('hex').toUpperCase(),
            MemoData: Buffer.from('v1.0.0', 'utf8').toString('hex').toUpperCase(),
          },
        },
      ],
    }

    const prepared = await client.autofill(accountSetTx)
    const signed   = issuerWallet.sign(prepared)
    const result   = await client.submitAndWait(signed.tx_blob)

    if (result.result.meta && typeof result.result.meta !== 'string') {
      const txResult = result.result.meta.TransactionResult
      if (txResult === 'tesSUCCESS') {
        console.log(chalk.green('✓ Account flags set — RequireAuth enabled'))
      } else {
        console.log(chalk.red(`✗ AccountSet failed: ${txResult}`))
        process.exit(1)
      }
    }

    // ── Step 4: verify ────────────────────────────────────────────────────────
    const verifyInfo = await client.request({
      command: 'account_info',
      account: issuerWallet.address,
      ledger_index: 'validated',
    })

    const flags = verifyInfo.result.account_data.Flags ?? 0
    const requireAuthSet = (flags & 0x00040000) !== 0 // lsfRequireAuth bitmask

    console.log(chalk.gray(`\nAccount flags: ${flags.toString(16)} (hex)`))
    console.log(requireAuthSet
      ? chalk.green('✓ lsfRequireAuth confirmed active')
      : chalk.red('✗ lsfRequireAuth not set — check transaction'))

    console.log(chalk.bold.green('\n✅ Issuer account ready for civic identity minting\n'))
  })
}

setupIssuer().catch((err) => {
  console.error(chalk.red('Setup failed:'), err)
  process.exit(1)
})
