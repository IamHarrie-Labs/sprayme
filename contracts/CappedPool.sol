// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice A pool with a fixed guest list. The host funds it, sets a cap,
/// and guests join by code until the cap is hit — after that, joining
/// locks. Whenever the host is ready, they trigger a single payout that
/// splits the pool equally among everyone who made it in. No claiming, no
/// racing: the host decides who's in and when everyone gets paid.
contract CappedPool {
    struct Pool {
        address host;
        uint128 amount;
        uint32 maxGuests;
        uint32 guestCount;
        bool paidOut;
        bool exists;
    }

    uint256 public poolCount;

    mapping(uint256 => Pool) private _pools;
    mapping(uint256 => address[]) private _guests;
    mapping(uint256 => mapping(address => bool)) public hasJoined;

    /// @dev keccak256 of the upper-cased code => pool id + 1 (0 means unused)
    mapping(bytes32 => uint256) private _codeLookup;

    event PoolCreated(
        uint256 indexed poolId,
        address indexed host,
        string code,
        string title,
        uint256 amount,
        uint32 maxGuests,
        uint64 timestamp
    );

    event GuestJoined(
        uint256 indexed poolId,
        address indexed guest,
        string name,
        uint32 guestCount,
        uint32 maxGuests,
        uint64 timestamp
    );

    event PaidOut(
        uint256 indexed poolId,
        uint256 perGuest,
        uint32 guestCount,
        uint64 timestamp
    );

    error CodeTaken();
    error NoSuchPool();
    error PoolFull();
    error AlreadyJoined();
    error NotHost();
    error AlreadyPaidOut();
    error NoGuestsYet();
    error ZeroGuests();
    error ZeroValue();
    error PayoutFailed();

    /// @notice Fund a pool and cap it to `maxGuests` people.
    function createPool(string calldata code, string calldata title, uint32 maxGuests) external payable returns (uint256 poolId) {
        if (maxGuests == 0) revert ZeroGuests();
        if (msg.value == 0) revert ZeroValue();

        bytes32 key = keccak256(bytes(code));
        if (_codeLookup[key] != 0) revert CodeTaken();

        poolId = ++poolCount;
        _codeLookup[key] = poolId;

        _pools[poolId] = Pool({
            host: msg.sender,
            amount: uint128(msg.value),
            maxGuests: maxGuests,
            guestCount: 0,
            paidOut: false,
            exists: true
        });

        emit PoolCreated(poolId, msg.sender, code, title, msg.value, maxGuests, uint64(block.timestamp));
    }

    /// @notice Join a pool by code. Reverts once the cap is reached.
    function join(string calldata code, string calldata name) external {
        uint256 poolId = _codeLookup[keccak256(bytes(code))];
        if (poolId == 0) revert NoSuchPool();

        Pool storage p = _pools[poolId];
        if (p.paidOut) revert AlreadyPaidOut();
        if (hasJoined[poolId][msg.sender]) revert AlreadyJoined();
        if (p.guestCount >= p.maxGuests) revert PoolFull();

        hasJoined[poolId][msg.sender] = true;
        _guests[poolId].push(msg.sender);
        p.guestCount += 1;

        emit GuestJoined(poolId, msg.sender, name, p.guestCount, p.maxGuests, uint64(block.timestamp));
    }

    /// @notice Host-only. Splits the pool equally among everyone who joined.
    /// @dev Integer division can leave a few wei behind as dust — negligible
    /// at spray-sized amounts, same tradeoff as GiftDrop.
    function payOut(uint256 poolId) external {
        Pool storage p = _pools[poolId];
        if (!p.exists) revert NoSuchPool();
        if (msg.sender != p.host) revert NotHost();
        if (p.paidOut) revert AlreadyPaidOut();
        if (p.guestCount == 0) revert NoGuestsYet();

        p.paidOut = true;
        uint256 perGuest = p.amount / p.guestCount;
        address[] storage guests = _guests[poolId];

        for (uint256 i = 0; i < guests.length; i++) {
            (bool sent, ) = guests[i].call{value: perGuest}("");
            if (!sent) revert PayoutFailed();
        }

        emit PaidOut(poolId, perGuest, p.guestCount, uint64(block.timestamp));
    }

    // ---------------------------------------------------------------- views

    function poolByCode(string calldata code) external view returns (uint256) {
        uint256 id = _codeLookup[keccak256(bytes(code))];
        if (id == 0) revert NoSuchPool();
        return id;
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        if (!_pools[poolId].exists) revert NoSuchPool();
        return _pools[poolId];
    }

    function getGuests(uint256 poolId) external view returns (address[] memory) {
        return _guests[poolId];
    }
}
