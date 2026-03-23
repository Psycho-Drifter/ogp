# Civic Identity — Soulbound NFT System (XRPL)

Soulbound civic identity NFTs for decentralized governance. Built on XRPL XLS-20.

---

## How soulbound enforcement works

On XRPL, an NFT is made non-transferable by **not setting the `tfTransferable` flag** during minting. This is enforced at the **protocol level** — every validator on the network rejects transfer attempts. It is not application-layer enforcement that can be bypassed.

Additionally:
- `tfBurnable` IS set → the issuing authority can revoke compromised identities
- One-per-citizen is enforced by checking for existing NFTs in our taxon before minting
- ZK commitments provide a second uniqueness layer (duplicate biometrics = same hash)

---

## Prerequisites

- **Node.js 20+** → https://nodejs.org  
  Verify: `node --version`

- **npm 10+** (comes with Node)  
  Verify: `npm --version`

That's it. No blockchain node to run — we connect to XRPL's hosted testnet.

---

## Stage 1: Install dependencies

```bash
# Clone / navigate to the project
cd civic-id

# Install packages
npm install
```

---

## Stage 2: Configure environment

```bash
# Copy the example config
cp .env.example .env
```

Leave `.env` mostly empty for now — `setup-issuer` will fill in the wallet credentials.

---

## Stage 3: Set up the issuer account

The issuer account is the government/authority wallet that signs all identity NFTs.

```bash
npm run setup:issuer
```

This will:
1. Generate a new XRPL wallet
2. Fund it from the testnet faucet (free test XRP)
3. Configure it with `RequireAuth` (controlled issuance)
4. Print your `ISSUER_ADDRESS` and `ISSUER_SECRET`

**Copy those values into your `.env` file before proceeding.**

---

## Stage 4: Run the soulbound test suite

This is the most important step — it proves that soulbound enforcement is real:

```bash
npm run test:soulbound
```

Expected output:
```
✅ Soulbound: transfer rejected at protocol level
✅ One-per-citizen: duplicate mint blocked
✅ Revocation: issuer burn confirmed
```

---

## Stage 5: Mint a real identity NFT

```bash
npm run mint:identity
```

This mints a test identity to a freshly funded testnet wallet and prints the NFTokenID.

---

## Verifying on the XRPL explorer

Every transaction is publicly visible:

```
https://testnet.xrpl.org/accounts/<ISSUER_ADDRESS>
https://testnet.xrpl.org/transactions/<TX_HASH>
```

---

## Project structure

```
civic-id/
├── src/
│   ├── xrpl-client.ts      # Shared client, config, NFT flag constants
│   ├── types.ts            # TypeScript interfaces for identity metadata
│   ├── setup-issuer.ts     # Configure the authority wallet (run once)
│   ├── mint-identity.ts    # Core minting engine
│   ├── revoke-identity.ts  # Revocation (NFTokenBurn)
│   ├── verify-identity.ts  # Lookup and validate citizen identity
│   └── test-soulbound.ts   # Full test suite
├── .env.example
├── package.json
└── tsconfig.json
```

---

## Production considerations

Before going to mainnet:

1. **Multi-sig issuer account** — replace the single `ISSUER_SECRET` with a
   multi-signature setup so no single key can mint or revoke unilaterally.

2. **ZK commitment pipeline** — integrate real biometric hashing and a
   ZK proof library (e.g. snarkjs + circom) before the `mintCivicIdentity` call.

3. **Metadata API** — build and deploy the `METADATA_BASE_URI` service.
   This API returns `CivicIdentityMetadata` JSON and must be highly available.

4. **Key management** — use a HSM (hardware security module) or cloud KMS
   for the issuer private key in production. Never store it in a `.env` file.

5. **Batch minting** — for large populations, batch NFTokenMint transactions
   using XRPL's transaction queuing. XRPL handles ~1500 TPS.

6. **Cross-chain bridge** — the `nftTokenId` from XRPL becomes the credential
   that the Polygon voting contract verifies via an oracle or bridge.

---

## Next layer: Quadratic voting contracts (Polygon)

Once identity is minting correctly, the next component is the Solidity
voting contract on Polygon that accepts XRPL identity proofs and issues
voice credits. See `/contracts/QuadraticVoting.sol` (coming next).
