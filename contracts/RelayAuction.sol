// SPDX-License-Identifier: MPL-2.0

pragma solidity 0.6.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// todo: make ownable
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./mocks/MockERC20.sol";
import {TypedMemView} from "./summa-tx/TypedMemView.sol";
import {ViewBTC} from "./summa-tx/ViewBTC.sol";
import {ViewSPV} from "./summa-tx/ViewSPV.sol";
import {IRelay} from "./summa-tx/IRelay.sol";

contract RelayAuction {
  using SafeMath for uint256;
  using TypedMemView for bytes;
  using TypedMemView for bytes29;
  using ViewBTC for bytes29;
  using ViewSPV for bytes29;

  uint256 internal constant MAX_UINT = uint256(-1);
  uint256 constant SLOT_LENGTH = 144;
  // number of blocks for active relayer to be behind, before some-one else can take over
  uint256 constant SNAP_THRESHOLD = 4;

  event NewRound(uint256 indexed startBlock, address indexed slotWinner, uint256 betAmount);
  event Bid(uint256 indexed slotStartBlock, address indexed relayer, uint256 amount);

  IERC20 rewardToken;
  uint256 rewardAmount;
  MockERC20 auctionToken;
  IRelay relay;

  struct Slot {
    address slotWinner;
    uint256 startBlock;
  }

  struct Bids {
    mapping(address => uint256) amounts;
    address bestBidder;
    uint256 bestAmount;
  }

  Slot public currentRound;
  bytes32 lastAncestor;

  // mapping from slotStartBlock and address to bet amount
  mapping(uint256 => Bids) private bids;

  constructor(
    address _relay,
    address _rewardToken,
    uint256 _rewardAmount,
    address _auctionToken
  ) public {
    relay = IRelay(_relay);
    rewardToken = IERC20(_rewardToken);
    rewardAmount = _rewardAmount;
    auctionToken = MockERC20(_auctionToken);
  }

  function bestBid(uint256 slotStartBlock) external view returns (address) {
    return bids[slotStartBlock].bestBidder;
  }

  function _bid(uint256 slotStartBlock, uint256 amount) internal {
    require(slotStartBlock % SLOT_LENGTH == 0, "not a start block");
    // check that betting for next round
    require(slotStartBlock > currentRound.startBlock, "can not bet for running rounds");
    uint256 prevBet = bids[slotStartBlock].amounts[msg.sender];
    require(amount > prevBet, "can not bet lower");
    // pull the funds
    auctionToken.transferFrom(msg.sender, address(this), amount.sub(prevBet));
    emit Bid(slotStartBlock, msg.sender, amount);
    bids[slotStartBlock].amounts[msg.sender] = amount;
    if (amount > bids[slotStartBlock].bestAmount) {
      bids[slotStartBlock].bestBidder = msg.sender;
      bids[slotStartBlock].bestAmount = amount;
    }
  }

  function bid(uint256 slotStartBlock, uint256 amount) external {
    _bid(slotStartBlock, amount);
  }

  function bidWithPermit(
    uint256 slotStartBlock,
    uint256 amount,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external {
    auctionToken.permit(msg.sender, address(this), MAX_UINT, deadline, v, r, s);
    _bid(slotStartBlock, amount);
  }

  function withdrawBid(uint256 slotStartBlock) external {
    require(slotStartBlock % SLOT_LENGTH == 0, "not a start block");
    require(slotStartBlock < currentRound.startBlock, "can not withdraw from future rounds");
    require(
      auctionToken.transfer(msg.sender, bids[slotStartBlock].amounts[msg.sender]),
      "could not transfer"
    );
    bids[slotStartBlock].amounts[msg.sender] = 0;
  }

  function _updateRound(uint256 _currentBestHeight) internal {
    // if we have gone into the next round
    Slot memory round = currentRound;
    if (round.startBlock + SLOT_LENGTH <= _currentBestHeight) {
      if (round.slotWinner != address(0)) {
        // pay out old slot owner
        rewardToken.transfer(round.slotWinner, rewardAmount);
        auctionToken.transfer(round.slotWinner, bids[round.startBlock].bestAmount / 2);
      }

      // find new height
      uint256 newCurrent = (_currentBestHeight / SLOT_LENGTH) * SLOT_LENGTH;
      // find new winner
      address newWinner = bids[newCurrent].bestBidder;

      // set new current Round
      currentRound = Slot(newWinner, newCurrent);
      emit NewRound(newCurrent, newWinner, bids[newCurrent].amounts[newWinner]);

      if (newWinner != address(0)) {
        // burn auctionToken
        auctionToken.burn(bids[newCurrent].amounts[newWinner] / 2);
        // set bet to 0, so winner can not withdraw
        bids[newCurrent].amounts[newWinner] = 0;
      }
    }
  }

  function updateRound() public {
    bytes32 bestKnown = relay.getBestKnownDigest();
    uint256 currentBestHeight = relay.findHeight(bestKnown);
    _updateRound(currentBestHeight);
  }

  function _checkRound(bytes32 _ancestor) internal returns (uint256) {
    uint256 relayHeight = relay.findHeight(_ancestor);

    Slot memory round = currentRound;
    bool isActiveSlot = round.startBlock < relayHeight &&
      relayHeight < round.startBlock + SLOT_LENGTH;
    if (isActiveSlot) {
      if (
        msg.sender != round.slotWinner &&
        relayHeight.sub(relay.findHeight(lastAncestor)) >= SNAP_THRESHOLD
      ) {
        // snap the slot
        currentRound.slotWinner = msg.sender;
      }
      lastAncestor = _ancestor;
    }

    // if we have left the slot, or it is filling up, roll slots forward
    if (!isActiveSlot || relayHeight >= round.startBlock + SLOT_LENGTH) {
      _updateRound(relayHeight);
    }
  }

  function addHeaders(bytes calldata _anchor, bytes calldata _headers) external returns (bool) {
    require(relay.addHeaders(_anchor, _headers), "add header failed");
    return true;
  }

  function addHeadersWithRetarget(
    bytes calldata _oldPeriodStartHeader,
    bytes calldata _oldPeriodEndHeader,
    bytes calldata _headers
  ) external returns (bool) {
    require(
      relay.addHeadersWithRetarget(_oldPeriodStartHeader, _oldPeriodEndHeader, _headers),
      "add header with retarget failed"
    );
    return true;
  }

  function markNewHeaviest(
    bytes32 _ancestor,
    bytes calldata _currentBest,
    bytes calldata _newBest,
    uint256 _limit
  ) external returns (bool) {
    _checkRound(_ancestor);
    require(
      relay.markNewHeaviest(_ancestor, _currentBest, _newBest, _limit),
      "mark new heaviest failed"
    );
  }
}
