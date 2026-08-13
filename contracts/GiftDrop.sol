// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A gift with a limited number of parcels, claimed first-come,
/// first-served by whoever has the code.
///
/// One person funds a drop and picks how many parcels it splits into. They
/// share one code with a few people. The first N of them to claim get an
/// equal share; everyone after that is too late. Claiming has to be
/// enforced on-chain, or two people racing for the same last parcel could
/// both end up thinking they won it.
contract GiftDrop {
    struct Drop {
        address creator;
        uint128 perClaim;
        uint32 maxClaims;
        uint32 claimsUsed;
        bool exists;
    }

    uint256 public dropCount;

    mapping(uint256 => Drop) private _drops;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    /// @dev keccak256 of the upper-cased code => drop id + 1 (0 means unused)
    mapping(bytes32 => uint256) private _codeLookup;

    event DropCreated(
        uint256 indexed dropId,
        address indexed creator,
        string code,
        uint256 perClaim,
        uint32 maxClaims,
        uint64 timestamp
    );

    event Claimed(
        uint256 indexed dropId,
        address indexed claimant,
        uint256 amount,
        uint32 claimsRemaining,
        uint64 timestamp
    );

    error CodeTaken();
    error NoSuchDrop();
    error AlreadyClaimed();
    error DropExhausted();
    error ZeroClaims();
    error ZeroValue();
    error PayoutFailed();

    /// @notice Fund a drop and split it into `maxClaims` equal parcels.
    /// @dev Integer division can leave a few wei unclaimed if the value
    /// doesn't divide evenly — negligible at spray-sized amounts, and left
    /// as dust rather than adding a refund path this doesn't need yet.
    function createDrop(string calldata code, uint32 maxClaims) external payable returns (uint256 dropId) {
        if (maxClaims == 0) revert ZeroClaims();
        if (msg.value == 0) revert ZeroValue();

        bytes32 key = keccak256(bytes(code));
        if (_codeLookup[key] != 0) revert CodeTaken();

        dropId = ++dropCount;
        _codeLookup[key] = dropId;

        _drops[dropId] = Drop({
            creator: msg.sender,
            perClaim: uint128(msg.value / maxClaims),
            maxClaims: maxClaims,
            claimsUsed: 0,
            exists: true
        });

        emit DropCreated(dropId, msg.sender, code, msg.value / maxClaims, maxClaims, uint64(block.timestamp));
    }

    /// @notice Claim one parcel of a drop. Each address can claim once.
    function claim(string calldata code) external {
        uint256 dropId = _codeLookup[keccak256(bytes(code))];
        if (dropId == 0) revert NoSuchDrop();

        Drop storage d = _drops[dropId];
        if (hasClaimed[dropId][msg.sender]) revert AlreadyClaimed();
        if (d.claimsUsed >= d.maxClaims) revert DropExhausted();

        hasClaimed[dropId][msg.sender] = true;
        d.claimsUsed += 1;

        (bool sent, ) = msg.sender.call{value: d.perClaim}("");
        if (!sent) revert PayoutFailed();

        emit Claimed(dropId, msg.sender, d.perClaim, d.maxClaims - d.claimsUsed, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------- views

    function dropByCode(string calldata code) external view returns (uint256) {
        uint256 id = _codeLookup[keccak256(bytes(code))];
        if (id == 0) revert NoSuchDrop();
        return id;
    }

    function getDrop(uint256 dropId) external view returns (Drop memory) {
        if (!_drops[dropId].exists) revert NoSuchDrop();
        return _drops[dropId];
    }
}
