// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Spraying money at a Nigerian ceremony, on-chain.
///
/// A host opens a session with a short code. Guests join with that code and a
/// display name, then spray repeatedly — one transaction per spray, the way
/// spraying actually works. Payouts accumulate as balances and are settled at
/// the end rather than transferred on every spray, so the hot path stays cheap
/// and a single reverting recipient can never block the party.
///
/// This only behaves like spraying on a chain with sub-second blocks and fees
/// small enough that a 100 naira spray is not dwarfed by its own gas.
contract SpraySession {
    /// @dev Packed into two slots. `total` and `sprayCount` are updated on the
    /// hot path, so they share a slot with the flags to keep spraying to a
    /// single storage write for session state.
    struct Session {
        address host;
        uint64 createdAt;
        bool open;
        uint128 total;
        uint64 sprayCount;
        uint64 giftCount;
    }

    struct Split {
        address recipient;
        uint16 bps; // basis points of every spray, must total 10_000
    }

    uint256 public sessionCount;

    mapping(uint256 => Session) private _sessions;
    mapping(uint256 => string) public title;
    mapping(uint256 => string) public code;
    mapping(uint256 => Split[]) private _splits;
    mapping(uint256 => uint256) public minSpray;

    /// @dev keccak256 of the upper-cased code => session id + 1 (0 means unused)
    mapping(bytes32 => uint256) private _codeLookup;

    /// @dev Display name per guest per session. Set once on join so the spray
    /// path never has to carry a string.
    mapping(uint256 => mapping(address => string)) public guestName;

    /// @dev Running total per guest, for the leaderboard.
    mapping(uint256 => mapping(address => uint256)) public sprayedBy;

    /// @dev Pull-payment balances. Credited on spray, paid out on settle.
    mapping(address => uint256) public owed;

    event SessionOpened(
        uint256 indexed sessionId,
        address indexed host,
        string code,
        string title,
        uint256 minSpray,
        uint64 timestamp
    );

    event Joined(
        uint256 indexed sessionId,
        address indexed guest,
        string name,
        uint64 timestamp
    );

    event Sprayed(
        uint256 indexed sessionId,
        address indexed guest,
        uint256 amount,
        uint256 guestTotal,
        uint256 sessionTotal,
        uint64 sprayIndex,
        uint64 timestamp
    );

    /// @notice The envelope: a gift recorded without the leaderboard theatre.
    /// @dev The amount is still visible on-chain like any transfer — "private"
    /// here means the wall does not display it, not that it is hidden.
    event Gifted(
        uint256 indexed sessionId,
        address indexed guest,
        uint256 amount,
        uint64 timestamp
    );

    /// @notice One line of MC commentary, written by the agent watching the session.
    event Hyped(
        uint256 indexed sessionId,
        address indexed agent,
        string line,
        uint64 timestamp
    );

    event SessionClosed(uint256 indexed sessionId, uint256 total, uint64 timestamp);
    event Settled(uint256 indexed sessionId, address indexed recipient, uint256 amount);

    error CodeTaken();
    error NoSuchSession();
    error SessionNotOpen();
    error NotHost();
    error SplitsMustTotal10000();
    error NoSplits();
    error BelowMinimum();
    error NotJoined();
    error NothingOwed();
    error PayoutFailed();

    modifier onlyHost(uint256 sessionId) {
        if (_sessions[sessionId].host != msg.sender) revert NotHost();
        _;
    }

    /// @notice Open a session. `sessionCode` should already be upper-cased by
    /// the caller; lookups are exact so the front end normalises before sending.
    /// @param splits who receives each spray, in basis points totalling 10000
    function openSession(
        string calldata sessionCode,
        string calldata sessionTitle,
        uint256 minimumSpray,
        Split[] calldata splits
    ) external returns (uint256 sessionId) {
        if (splits.length == 0) revert NoSplits();

        uint256 totalBps;
        for (uint256 i = 0; i < splits.length; i++) {
            totalBps += splits[i].bps;
        }
        if (totalBps != 10_000) revert SplitsMustTotal10000();

        bytes32 key = keccak256(bytes(sessionCode));
        if (_codeLookup[key] != 0) revert CodeTaken();

        sessionId = ++sessionCount;
        _codeLookup[key] = sessionId;

        _sessions[sessionId] = Session({
            host: msg.sender,
            createdAt: uint64(block.timestamp),
            open: true,
            total: 0,
            sprayCount: 0,
            giftCount: 0
        });

        title[sessionId] = sessionTitle;
        code[sessionId] = sessionCode;
        minSpray[sessionId] = minimumSpray;

        for (uint256 i = 0; i < splits.length; i++) {
            _splits[sessionId].push(splits[i]);
        }

        emit SessionOpened(
            sessionId,
            msg.sender,
            sessionCode,
            sessionTitle,
            minimumSpray,
            uint64(block.timestamp)
        );
    }

    /// @notice Claim a display name for this session. Called once; spraying
    /// afterwards costs no extra calldata.
    function join(uint256 sessionId, string calldata name) external {
        if (!_sessions[sessionId].open) revert SessionNotOpen();
        guestName[sessionId][msg.sender] = name;
        emit Joined(sessionId, msg.sender, name, uint64(block.timestamp));
    }

    /// @notice Spray. The hot path: no external calls, no string arguments.
    function spray(uint256 sessionId) external payable {
        Session storage s = _sessions[sessionId];
        if (s.host == address(0)) revert NoSuchSession();
        if (!s.open) revert SessionNotOpen();
        if (msg.value < minSpray[sessionId]) revert BelowMinimum();
        if (bytes(guestName[sessionId][msg.sender]).length == 0) revert NotJoined();

        _credit(sessionId, msg.value);

        uint256 guestTotal = sprayedBy[sessionId][msg.sender] + msg.value;
        sprayedBy[sessionId][msg.sender] = guestTotal;

        uint128 newTotal = s.total + uint128(msg.value);
        uint64 index = s.sprayCount + 1;
        s.total = newTotal;
        s.sprayCount = index;

        emit Sprayed(
            sessionId,
            msg.sender,
            msg.value,
            guestTotal,
            newTotal,
            index,
            uint64(block.timestamp)
        );
    }

    /// @notice The envelope. Same money, no leaderboard.
    function gift(uint256 sessionId) external payable {
        Session storage s = _sessions[sessionId];
        if (s.host == address(0)) revert NoSuchSession();
        if (!s.open) revert SessionNotOpen();

        _credit(sessionId, msg.value);

        s.total += uint128(msg.value);
        s.giftCount += 1;

        emit Gifted(sessionId, msg.sender, msg.value, uint64(block.timestamp));
    }

    /// @dev Split `amount` across the session's recipients. The last recipient
    /// absorbs the rounding remainder so credited value always equals msg.value.
    function _credit(uint256 sessionId, uint256 amount) private {
        Split[] storage splits = _splits[sessionId];
        uint256 n = splits.length;
        uint256 distributed;

        for (uint256 i = 0; i < n - 1; i++) {
            uint256 share = (amount * splits[i].bps) / 10_000;
            owed[splits[i].recipient] += share;
            distributed += share;
        }
        owed[splits[n - 1].recipient] += amount - distributed;
    }

    /// @notice Record a line of MC commentary against the session.
    /// @dev Deliberately open to any caller: the agent runs from its own wallet,
    /// and a session can have more than one voice without a permission dance.
    function hype(uint256 sessionId, string calldata line) external {
        if (_sessions[sessionId].host == address(0)) revert NoSuchSession();
        emit Hyped(sessionId, msg.sender, line, uint64(block.timestamp));
    }

    function closeSession(uint256 sessionId) external onlyHost(sessionId) {
        Session storage s = _sessions[sessionId];
        if (!s.open) revert SessionNotOpen();
        s.open = false;
        emit SessionClosed(sessionId, s.total, uint64(block.timestamp));
    }

    /// @notice Pay out what an address is owed. Callable by anyone for anyone,
    /// so the MC agent can settle the whole party without holding the funds.
    function settle(uint256 sessionId, address recipient) public {
        uint256 amount = owed[recipient];
        if (amount == 0) revert NothingOwed();

        owed[recipient] = 0;
        (bool sent, ) = recipient.call{value: amount}("");
        if (!sent) revert PayoutFailed();

        emit Settled(sessionId, recipient, amount);
    }

    /// @notice Settle every recipient of a session in one transaction.
    function settleAll(uint256 sessionId) external {
        Split[] storage splits = _splits[sessionId];
        for (uint256 i = 0; i < splits.length; i++) {
            if (owed[splits[i].recipient] > 0) {
                settle(sessionId, splits[i].recipient);
            }
        }
    }

    // ---------------------------------------------------------------- views

    function sessionByCode(string calldata sessionCode) external view returns (uint256) {
        uint256 id = _codeLookup[keccak256(bytes(sessionCode))];
        if (id == 0) revert NoSuchSession();
        return id;
    }

    function getSession(uint256 sessionId) external view returns (Session memory) {
        if (_sessions[sessionId].host == address(0)) revert NoSuchSession();
        return _sessions[sessionId];
    }

    function getSplits(uint256 sessionId) external view returns (Split[] memory) {
        return _splits[sessionId];
    }
}
