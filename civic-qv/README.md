# Civic Quadratic Voting — Smart Contract Layer (Polygon)

Quadratic voting, quadratic funding, and emergency oversight contracts for decentralized civic governance.

---

## Architecture overview

```
CivicIdentityVerifier      — XRPL identity bridge (Merkle root oracle)
QuadraticVoting            — Core QV engine with ZK ballot privacy
QuadraticFunding           — CLR matching for democratic budget allocation
circuits/vote.circom       — ZK-PLONK circuit for private ballots
Mocks.sol                  — MockVoteVerifier + MockERC20 for local testing
```

---

## Prerequisites

- **Node.js 20+**
- **Hardhat** (installed via npm)
- For ZK circuit compilation (production only): `circom`, `snarkjs`

---

## Stage 1: Install and compile

```bash
cd civic-qv
npm install
npx hardhat compile
```

Expected output: 5 contracts compiled with no warnings.

---

## Stage 2: Run tests on local network

```bash
# Terminal 1 — start a local Hardhat node
npx hardhat node

# Terminal 2 — run the test suite
npx hardhat test
```

The test suite covers:
- ✅ Identity root publishing and Merkle proof verification
- ✅ Double-claim prevention per cycle
- ✅ Full proposal lifecycle: Draft → AI Review → Active → Executed
- ✅ AI briefing requirement enforcement
- ✅ ZK ballot submission and nullifier double-vote prevention
- ✅ Quadratic math enforcement (credits must be a perfect square)
- ✅ Emergency veto by oversight panel
- ✅ QF round creation and CLR matching setup

---

## Stage 3: Deploy to Polygon Mumbai (testnet)

```bash
# Set up .env
cp .env.example .env
# Fill in: DEPLOYER_PRIVATE_KEY, ALCHEMY_MUMBAI_URL, POLYGONSCAN_API_KEY

npx hardhat run scripts/deploy.ts --network mumbai
```

Copy the deployed addresses printed at the end into your `.env`.

---

## The Proposal Lifecycle

Every proposal on this system follows this exact path:

```
1. DRAFTED       — Proposer submits title + IPFS description
2. AI REVIEW     — AI oracle attaches risk analysis + plain-language briefing
                   Citizens can read the briefing on IPFS before voting opens
3. ACTIVE        — Oversight panel approves briefing, voting window opens
                   Citizens claim voice credits via XRPL identity proof
                   Citizens cast ZK ballots (private, verifiable)
4. TALLYING      — Voting closes, veto window begins (48 hours)
                   Oversight panel reviews results, can veto if warranted
5. EXECUTED      — Veto window passes, tally revealed, result enacted
   or VETOED     — Oversight panel triggered veto (permanent)
   or REJECTED   — Failed quorum or threshold
```

---

## Quadratic voting mechanics

Voice credits per citizen: **100 per proposal** (equal allocation, regardless of wealth or status)

| Votes cast | Credits spent | % of budget |
|-----------|--------------|-------------|
| 1         | 1            | 1%          |
| 2         | 4            | 4%          |
| 3         | 9            | 9%          |
| 5         | 25           | 25%         |
| 7         | 49           | 49%         |
| 10        | 100          | 100%        |

Expressing strong conviction is possible but costly — it uses your entire budget on one issue.

---

## ZK ballot privacy (production setup)

The `vote.circom` circuit must be compiled before deploying to testnet/mainnet:

```bash
# Install Circom
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
cargo install circom

# Install snarkjs
npm install -g snarkjs

# Download Powers of Tau (phase 1 — use Hermez ceremony for production)
wget https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_15.ptau -O pot15.ptau

# Compile the circuit
circom circuits/vote.circom --r1cs --wasm --sym --c -o circuits/build

# Phase 2 ceremony
snarkjs plonk setup circuits/build/vote.r1cs pot15.ptau circuits/build/vote.zkey

# Export verification key
snarkjs zkey export verificationkey circuits/build/vote.zkey circuits/build/verification_key.json

# Generate Solidity verifier (replaces MockVoteVerifier in production)
snarkjs zkey export solidityverifier circuits/build/vote.zkey contracts/VoteVerifier.sol
```

---

## Production checklist

Before deploying to Polygon mainnet:

1. **Replace mock ZK verifier** — compile `vote.circom` and use the generated verifier
2. **Multi-sig admin** — replace `deployer.address` admin with a Gnosis Safe multi-sig
3. **Oracle multi-sig** — the XRPL identity oracle should be 3-of-5 multi-sig minimum
4. **Formal audit** — these contracts handle governance at scale; a professional security audit is mandatory
5. **Upgrade proxy** — consider wrapping in OpenZeppelin TransparentUpgradeableProxy
6. **Mainnet MATIC** — ensure deployer has sufficient MATIC for deployment gas
7. **Funding token** — set `FUNDING_TOKEN_ADDRESS` in `.env` (USDC or governance token)

---

## Connection to XRPL identity layer

This contract layer connects to the soulbound NFT identity system (civic-id) via:

1. **Off-chain oracle** reads current valid identity NFTs from XRPL
2. Builds a Merkle tree of `(citizenAddress, jurisdiction, voiceCredits)` leaves
3. Posts the Merkle root to `CivicIdentityVerifier.publishIdentityRoot()`
4. Citizens prove membership with `verifyAndGetCredits()` using a Merkle proof
5. The proof links to the ZK ballot circuit — identity is verified inside the ZK proof

In v2, the oracle will be replaced by a trustless ZK light-client proof of XRPL state.

---

## Next layer: AI advisory layer

The AI advisory module (coming next) is responsible for:
- Generating the AI briefing attached to each proposal
- Running risk analysis and outcome simulation
- Translating proposals into plain language (multilingual)
- Posting the briefing to IPFS and calling `attachAIBriefing()`
- The oversight panel then reviews before voting opens
