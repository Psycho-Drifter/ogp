// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./interfaces/IVoteVerifier.sol";

/**
 * MockVoteVerifier — always returns true.
 * Used for local development only. Replace with the Circom-generated
 * Groth16Verifier on testnet/mainnet.
 */
contract MockVoteVerifier is IVoteVerifier {
    function verifyProof(
        bytes calldata,
        uint256[5] calldata
    ) external pure returns (bool) {
        return true;
    }
}

/**
 * MockERC20 — simple ERC20 for local testing of QuadraticFunding.
 */
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol, uint256 initialSupply)
        ERC20(name, symbol)
    {
        _mint(msg.sender, initialSupply);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
