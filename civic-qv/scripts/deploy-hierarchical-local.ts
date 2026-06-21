/**
 * deploy-hierarchical-local.ts
 *
 * Deploys the full Phase 1 contract suite to a local Hardhat node
 * forking Polygon. Deployment order is fixed by dependency:
 *
 *   1. AuthorityRegistry      — no dependencies
 *   2. RevocationRegistry     — depends on AuthorityRegistry address
 *   3. HierarchicalIdentityVerifier — depends on RevocationRegistry address
 *                                     (and any existing dependencies it had)
 *
 * After deployment, registers a test KYC authority (TIER_3) so that the
 * Hardhat test suite can call revokeToken() without a separate setup step.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-hierarchical-local.ts --network localhost
 *
 * Prerequisites:
 *   - Local Hardhat node running: npx hardhat node
 *   - .env contains DEPLOYER_PRIVATE_KEY (or Hardhat default signers are used)
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("=============================================================");
  console.log("OGP Phase 1 — Local deployment");
  console.log("=============================================================");
  console.log(`Deployer address : ${deployer.address}`);
  console.log(`Deployer balance : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  console.log("");

  // ---------------------------------------------------------------------------
  // 1. AuthorityRegistry
  // ---------------------------------------------------------------------------
  // isProduction = false  →  TIER_3 test authorities are permitted
  // governanceAddr        →  deployer for PoC; must be a governance multi-sig
  //                          in production
  // ---------------------------------------------------------------------------
  console.log("1. Deploying AuthorityRegistry...");

  const AuthorityRegistryFactory = await ethers.getContractFactory("AuthorityRegistry");
  const authorityRegistry = await AuthorityRegistryFactory.deploy(
    false,            // isProduction — false for PoC / local development
    deployer.address  // governanceAddr — deployer EOA for PoC
  );
  await authorityRegistry.waitForDeployment();
  const authorityRegistryAddress = await authorityRegistry.getAddress();

  console.log(`   AuthorityRegistry deployed to: ${authorityRegistryAddress}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // 2. RevocationRegistry
  // ---------------------------------------------------------------------------
  // authorityRegistryAddress →  immutable reference set here, never changeable
  // requiredSignatures       →  2 for PoC (2-of-3); use 3 for production (3-of-5)
  // governanceAddr           →  deployer for PoC; governance multi-sig in production
  // ---------------------------------------------------------------------------
  console.log("2. Deploying RevocationRegistry...");

  const RevocationRegistryFactory = await ethers.getContractFactory("RevocationRegistry");
  const revocationRegistry = await RevocationRegistryFactory.deploy(
    authorityRegistryAddress,  // immutable AuthorityRegistry reference
    2,                         // requiredSignatures — 2 for PoC, 3 for production
    deployer.address           // governanceAddr — deployer EOA for PoC
  );
  await revocationRegistry.waitForDeployment();
  const revocationRegistryAddress = await revocationRegistry.getAddress();

  console.log(`   RevocationRegistry deployed to: ${revocationRegistryAddress}`);
  console.log(`   AuthorityRegistry reference  : ${await revocationRegistry.authorityRegistry()} (immutable)`);
  console.log(`   Required signatures          : ${await revocationRegistry.requiredSignatures()}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // 3. HierarchicalIdentityVerifier
  // ---------------------------------------------------------------------------
  // Add revocationRegistryAddress as the last constructor argument.
  // All existing constructor arguments stay in the same positions.
  //
  // NOTE: Update the argument list below to match the existing constructor
  // signature in HierarchicalIdentityVerifier.sol. The revocationRegistryAddress
  // is appended as the final argument.
  // ---------------------------------------------------------------------------
  console.log("3. Deploying HierarchicalIdentityVerifier...");

  const HierarchicalIdentityVerifierFactory = await ethers.getContractFactory(
    "HierarchicalIdentityVerifier"
  );

  // TODO: replace the spread below with your existing constructor arguments
  // in the same order they currently appear, then append revocationRegistryAddress.
  // Example if existing constructor takes (address _admin, uint256 _depth):
  //
  //   const verifier = await HierarchicalIdentityVerifierFactory.deploy(
  //     deployer.address,        // _admin (existing)
  //     64,                      // _depth (existing — depth-64 per architecture)
  //     revocationRegistryAddress // _revocationRegistry (new — Phase 1)
  //   );
  //
  // Placeholder deployment (adjust before running):
  const verifier = await HierarchicalIdentityVerifierFactory.deploy(
    // ← INSERT YOUR EXISTING CONSTRUCTOR ARGUMENTS HERE
    revocationRegistryAddress   // _revocationRegistry — appended last
  );
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();

  console.log(`   HierarchicalIdentityVerifier deployed to: ${verifierAddress}`);
  console.log(`   RevocationRegistry reference           : ${await verifier.revocationRegistry()} (immutable)`);
  console.log("");

  // ---------------------------------------------------------------------------
  // 4. Register a test KYC authority in AuthorityRegistry
  // ---------------------------------------------------------------------------
  // For PoC / Hardhat tests: register the deployer address as a TIER_3
  // test authority so the test suite can call revokeToken() immediately.
  //
  // In production this step is replaced by a governance transaction that
  // registers real multi-sig KYC authority addresses as TIER_1 or TIER_2.
  // ---------------------------------------------------------------------------
  console.log("4. Registering deployer as TIER_3 test KYC authority...");

  // Dummy description hash — represents an off-chain accreditation document.
  // Replace with a real keccak256 hash of an actual document in production.
  const testDescriptionHash = ethers.keccak256(ethers.toUtf8Bytes("OGP_POC_TEST_AUTHORITY_V1"));

  const AuthorityTier = { TIER_1: 0, TIER_2: 1, TIER_3: 2 };

  const registerTx = await authorityRegistry.registerAuthority(
    deployer.address,
    AuthorityTier.TIER_3,
    testDescriptionHash
  );
  await registerTx.wait();

  const authorityInfo = await authorityRegistry.getAuthorityInfo(deployer.address);
  console.log(`   Test authority registered     : ${deployer.address}`);
  console.log(`   Tier                          : TIER_3 (test only)`);
  console.log(`   Active                        : ${authorityInfo.active}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("=============================================================");
  console.log("Deployment complete. Contract addresses:");
  console.log("=============================================================");
  console.log(`  AuthorityRegistry            : ${authorityRegistryAddress}`);
  console.log(`  RevocationRegistry           : ${revocationRegistryAddress}`);
  console.log(`  HierarchicalIdentityVerifier : ${verifierAddress}`);
  console.log("");
  console.log("Add these to your .env or test setup as needed:");
  console.log(`  AUTHORITY_REGISTRY_ADDRESS=${authorityRegistryAddress}`);
  console.log(`  REVOCATION_REGISTRY_ADDRESS=${revocationRegistryAddress}`);
  console.log(`  VERIFIER_ADDRESS=${verifierAddress}`);
  console.log("=============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Deployment failed:", error);
    process.exit(1);
  });
