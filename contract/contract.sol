// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title EnergyAuditHash
/// @notice Minimal audit trail for off-chain energy trades:
///         - Frontend hashes a canonical JSON of the trade (SHA-256 → bytes32).
///         - This contract stores the hash by tradeId and emits an event.
///         - Auditors can recompute the hash off-chain and compare it to on-chain data.
contract EnergyAuditHash {
    /// @dev Emitted whenever a trade hash is logged/updated.
    /// @param tradeId  Off-chain trade ID from your database.
    /// @param dataHash SHA-256 hash of the canonical trade JSON (32 bytes).
    /// @param by       The wallet that called logTradeHash (buyer, seller, or app wallet).
    event TradeHashLogged(uint256 indexed tradeId, bytes32 indexed dataHash, address indexed by);

    // --- Optional on-chain storage (keeps latest value if re-logged) ---
    mapping (uint256 => bytes32) private _tradeHash; // tradeId => bytes32
    mapping (uint256 => address) public  loggedBy;   // tradeId => last msg.sender
    mapping (uint256 => uint256) public  loggedAt;   // tradeId => last block.timestamp

    /// @notice Log (or update) the hash for a trade ID and emit an event.
    /// @dev Keep the hashing in your frontend (SHA-256 of canonical JSON → bytes32 hex "0x…").
    /// @param _tradeId  Off-chain trade ID.
    /// @param _dataHash SHA-256 hash (bytes32). Example: 0x1234… (32 bytes).
    function logTradeHash(uint256 _tradeId, bytes32 _dataHash) external {
        _tradeHash[_tradeId] = _dataHash;
        loggedBy[_tradeId] = msg.sender;
        loggedAt[_tradeId] = block.timestamp;
        emit TradeHashLogged(_tradeId, _dataHash, msg.sender);
    }

    /// @notice Read the current stored hash for a trade.
    /// @param _tradeId Off-chain trade ID.
    /// @return dataHash The last stored bytes32 hash for this trade ID (0x0 if none).
    function getTradeHash(uint256 _tradeId) external view returns (bytes32 dataHash) {
        return _tradeHash[_tradeId];
    }

    /// @notice Convenience getter: returns all audit fields for a trade.
    /// @param _tradeId Off-chain trade ID.
    /// @return dataHash The stored hash.
    /// @return by       The address that last wrote this trade’s hash.
    /// @return at       The timestamp (block time) of the last write.
    function getAuditEntry(uint256 _tradeId)
        external
        view
        returns (bytes32 dataHash, address by, uint256 at)
    {
        return (_tradeHash[_tradeId], loggedBy[_tradeId], loggedAt[_tradeId]);
    }
}
