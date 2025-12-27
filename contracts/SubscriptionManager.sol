// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title SubscriptionManager
 * @dev Hardened protocol for handling recurring "pull" payments on Arc Network.
 * Phase 8: Security Hardening & Protocol Robustness.
 */
contract SubscriptionManager is ReentrancyGuard, AccessControl, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    
    IERC20 public immutable USDC;

    struct Tier {
        string name;
        uint256 amount;     // In USDC (6 decimals)
        uint256 frequency;  // In seconds
        bool active;
    }

    struct Subscription {
        address subscriber;
        uint256 tierId;
        uint256 amount;     // Snapshotted price at signup
        uint256 frequency;  // Snapshotted frequency at signup
        uint256 lastPaid;
        bool active;
    }

    Tier[] public tiers;
    mapping(bytes32 => Subscription) public subscriptions;
    mapping(address => bytes32[]) public userSubscriptions;

    event TierAdded(uint256 indexed tierId, string name, uint256 amount, uint256 frequency);
    event TierStatusChanged(uint256 indexed tierId, bool active);
    event SubscriptionCreated(bytes32 indexed subId, address indexed subscriber, uint256 tierId);
    event SubscriptionPaid(bytes32 indexed subId, uint256 amount, uint256 timestamp);
    event SubscriptionCancelled(bytes32 indexed subId);

    constructor(address _usdc) {
        require(_usdc != address(0), "Invalid USDC address");
        USDC = IERC20(_usdc);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MANAGER_ROLE, msg.sender);
    }

    /**
     * @dev Adds a new subscription tier. Only managers can call this.
     */
    function addTier(string memory _name, uint256 _amount, uint256 _frequency) external onlyRole(MANAGER_ROLE) {
        tiers.push(Tier({
            name: _name,
            amount: _amount,
            frequency: _frequency,
            active: true
        }));
        emit TierAdded(tiers.length - 1, _name, _amount, _frequency);
    }

    function toggleTierActive(uint256 _tierId, bool _active) external onlyRole(MANAGER_ROLE) {
        require(_tierId < tiers.length, "Invalid tier");
        tiers[_tierId].active = _active;
        emit TierStatusChanged(_tierId, _active);
    }

    /**
     * @dev Creates a subscription and takes the first payment immediately.
     * Snapshots the current tier price and frequency to prevent retroactive changes.
     */
    function createSubscription(uint256 _tierId) external nonReentrant whenNotPaused returns (bytes32) {
        require(_tierId < tiers.length, "Invalid tier");
        require(tiers[_tierId].active, "Tier not active");

        Tier storage tier = tiers[_tierId];
        
        // Take first payment immediately
        USDC.safeTransferFrom(msg.sender, address(this), tier.amount);

        // Include nonce (array length) to prevent ID collisions in same block
        bytes32 subId = keccak256(abi.encodePacked(
            msg.sender, 
            _tierId, 
            block.timestamp, 
            userSubscriptions[msg.sender].length
        ));
        
        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            tierId: _tierId,
            amount: tier.amount,
            frequency: tier.frequency,
            lastPaid: block.timestamp,
            active: true
        });

        userSubscriptions[msg.sender].push(subId);

        emit SubscriptionCreated(subId, msg.sender, _tierId);
        emit SubscriptionPaid(subId, tier.amount, block.timestamp);
        return subId;
    }

    /**
     * @dev Executes a subscription payment.
     * Restricted to RELAYER_ROLE to prevent griefing.
     */
    function executePayment(bytes32 _subId) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        Subscription storage sub = subscriptions[_subId];
        
        // AUDIT: Existence check
        require(sub.subscriber != address(0), "Subscription does not exist");
        require(sub.active, "Subscription is not active");
        
        // AUDIT: Use snapshotted values
        require(block.timestamp >= sub.lastPaid + sub.frequency, "Too early for next payment");

        USDC.safeTransferFrom(sub.subscriber, address(this), sub.amount);
        
        sub.lastPaid = block.timestamp;

        emit SubscriptionPaid(_subId, sub.amount, block.timestamp);
    }

    function cancelSubscription(bytes32 _subId) external {
        require(subscriptions[_subId].subscriber == msg.sender, "Only subscriber can cancel");
        subscriptions[_subId].active = false;
        emit SubscriptionCancelled(_subId);
    }

    function pause() external onlyRole(MANAGER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(MANAGER_ROLE) {
        _unpause();
    }

    /**
     * @dev Withdraws collected funds to an admin/treasury address.
     */
    function withdrawUSDC(address _to, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        USDC.safeTransfer(_to, _amount);
    }

    /**
     * @dev Returns all subscription details for a specific subscriber.
     */
    function getSubscriptionsBySubscriber(address _subscriber) external view returns (Subscription[] memory) {
        bytes32[] memory ids = userSubscriptions[_subscriber];
        Subscription[] memory result = new Subscription[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            result[i] = subscriptions[ids[i]];
        }
        return result;
    }

    function getTierCount() external view returns (uint256) {
        return tiers.length;
    }

    // ===========================================
    // PRORATION: Fair billing when switching plans
    // ===========================================
    
    event SubscriptionSwitched(
        bytes32 indexed oldSubId, 
        bytes32 indexed newSubId, 
        int256 proratedAmount // Positive = charge, Negative = credit
    );

    /**
     * @dev Switches a subscription to a new tier with prorated billing.
     * Calculates unused credit from old plan and prorated cost for new plan.
     * @param _oldSubId The subscription to switch from
     * @param _newTierId The tier to switch to
     * @return newSubId The ID of the newly created subscription
     */
    function switchSubscription(bytes32 _oldSubId, uint256 _newTierId) 
        external 
        nonReentrant 
        whenNotPaused 
        returns (bytes32 newSubId) 
    {
        Subscription storage oldSub = subscriptions[_oldSubId];
        
        // Validation
        require(oldSub.subscriber == msg.sender, "Only subscriber can switch");
        require(oldSub.active, "Subscription not active");
        require(_newTierId < tiers.length, "Invalid tier");
        require(tiers[_newTierId].active, "Tier not active");
        require(oldSub.tierId != _newTierId, "Already on this tier");

        Tier storage newTier = tiers[_newTierId];

        // Calculate time remaining in current billing cycle
        uint256 cycleEnd = oldSub.lastPaid + oldSub.frequency;
        uint256 timeRemaining = cycleEnd > block.timestamp ? cycleEnd - block.timestamp : 0;

        // Calculate prorated amounts (using 1e18 precision for division)
        // Credit from old plan (unused portion)
        uint256 oldCredit = (oldSub.amount * timeRemaining * 1e18) / oldSub.frequency / 1e18;
        
        // Cost for new plan (remaining portion)
        uint256 newCost = (newTier.amount * timeRemaining * 1e18) / newTier.frequency / 1e18;

        // Net amount (positive = user pays, negative = user gets credit)
        int256 netAmount = int256(newCost) - int256(oldCredit);

        // Handle payment/credit
        if (netAmount > 0) {
            // User owes money (upgrade)
            USDC.safeTransferFrom(msg.sender, address(this), uint256(netAmount));
        } else if (netAmount < 0) {
            // User gets credit (downgrade) - refund to user
            USDC.safeTransfer(msg.sender, uint256(-netAmount));
        }
        // If netAmount == 0, no transfer needed

        // Cancel old subscription
        oldSub.active = false;
        emit SubscriptionCancelled(_oldSubId);

        // Create new subscription (without initial payment - proration handles it)
        newSubId = keccak256(abi.encodePacked(
            msg.sender,
            _newTierId,
            block.timestamp,
            userSubscriptions[msg.sender].length
        ));

        subscriptions[newSubId] = Subscription({
            subscriber: msg.sender,
            tierId: _newTierId,
            amount: newTier.amount,
            frequency: newTier.frequency,
            lastPaid: oldSub.lastPaid, // Preserve billing cycle
            active: true
        });

        userSubscriptions[msg.sender].push(newSubId);

        emit SubscriptionCreated(newSubId, msg.sender, _newTierId);
        emit SubscriptionSwitched(_oldSubId, newSubId, netAmount);

        return newSubId;
    }

    /**
     * @dev Calculates the prorated amount for switching to a new tier.
     * @return netAmount Positive = user pays, Negative = user gets refund
     */
    function calculateProration(bytes32 _subId, uint256 _newTierId) 
        external 
        view 
        returns (int256 netAmount, uint256 oldCredit, uint256 newCost) 
    {
        Subscription memory sub = subscriptions[_subId];
        require(sub.subscriber != address(0), "Subscription does not exist");
        require(_newTierId < tiers.length, "Invalid tier");

        Tier memory newTier = tiers[_newTierId];

        uint256 cycleEnd = sub.lastPaid + sub.frequency;
        uint256 timeRemaining = cycleEnd > block.timestamp ? cycleEnd - block.timestamp : 0;

        oldCredit = (sub.amount * timeRemaining * 1e18) / sub.frequency / 1e18;
        newCost = (newTier.amount * timeRemaining * 1e18) / newTier.frequency / 1e18;
        netAmount = int256(newCost) - int256(oldCredit);
    }

    /**
     * @dev Optimized View for Relayers: Checks a list of IDs and returns only those due for payment.
     * This allows the Relayer to screen thousands of IDs in a single free RPC call.
     */
    function checkUpkeep(bytes32[] calldata _subIds) external view returns (bytes32[] memory upkeepNeeded) {
        uint256 count = 0;
        bytes32[] memory temp = new bytes32[](_subIds.length);

        for (uint256 i = 0; i < _subIds.length; i++) {
            Subscription memory sub = subscriptions[_subIds[i]];
            if (sub.active && sub.subscriber != address(0) && block.timestamp >= sub.lastPaid + sub.frequency) {
                temp[count] = _subIds[i];
                count++;
            }
        }

        upkeepNeeded = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            upkeepNeeded[i] = temp[i];
        }
    }
}
