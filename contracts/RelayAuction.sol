// SPDX-License-Identifier: MPL-2.0

pragma solidity 0.6.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20Burnable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
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

  uint256 constant SLOT_LENGTH = 144;

  event NewRound(uint256 indexed startBlock, address indexed slotWinner, uint256 betAmount);

  IERC20 rewardToken;
  uint256 rewardAmount;

  ERC20Burnable auctionToken;

  struct Slot {
    address slotWinner;
    uint256 startBlock;
  }

  Slot currentRound;
  IRelay relay;
  // mapping from slotStractBlock and address to bet amount
  mapping(uint256 => mapping(address => uint256)) bets;
  mapping(uint256 => address) bestBet;

  constructor(address _relay, address _rewardToken, uint256 _rewardAmount, address _auctionToken) public {
    relay = IRelay(_relay);
    rewardToken = IERC20(_rewardToken);
    rewardAmount = _rewardAmount;
    auctionToken = ERC20Burnable(_auctionToken);
  }

  function bet(uint256 slotStartBlock, uint256 amount) external {
    require(slotStartBlock % SLOT_LENGTH == 0, "not a start block");
    // check that betting for next round
    require(slotStartBlock > currentRound.startBlock, "can not bet for running rounds");
    uint256 prevBet = bets[slotStartBlock][msg.sender];
    require(amount > prevBet, "can not bet lower");
    // pull the funds
    auctionToken.transferFrom(msg.sender, address(this), amount.sub(prevBet));
    bets[slotStartBlock][msg.sender] = amount;
    if (amount > bets[slotStartBlock][bestBet[slotStartBlock]]) {
      bestBet[slotStartBlock] = msg.sender;
    }
  }

  function withdrawBet(uint256 slotStartBlock) external {
    require(slotStartBlock % SLOT_LENGTH == 0, "not a start block");
    require(slotStartBlock <= currentRound.startBlock, "can not withdraw from future rounds");
    require(auctionToken.transfer(msg.sender, bets[slotStartBlock][msg.sender]), "could not transfer");
    bets[slotStartBlock][msg.sender] = 0;
  }

  function _updateRound(uint256 _currentBestHeight) internal {
    // if we have gone into the next round
    if (currentRound.startBlock + SLOT_LENGTH <= _currentBestHeight) {
      Slot memory round = currentRound;
      if (round.slotWinner != address(0)) {
        // pay out old slot owner
        rewardToken.transfer(round.slotWinner, rewardAmount);
        auctionToken.transfer(round.slotWinner, bets[round.startBlock][bestBet[round.startBlock]] / 2);
      }

      // find new height
      uint256 newCurrent = (_currentBestHeight / SLOT_LENGTH) * SLOT_LENGTH;
      // find new winner
      address newWinner = bestBet[newCurrent];

      if (newWinner != address(0)) {
        // burn auctionToken
        auctionToken.burn(bets[newCurrent][newWinner] / 2);
        // set bet to 0, so winner can not withdraw
        bets[newCurrent][newWinner] = 0;

        // set new current Round
        currentRound = Slot(newWinner, newCurrent);
      }
    }
  }

  function updateRound() public {
    bytes32 bestKnown = relay.getBestKnownDigest();
    uint256 currentBestHeight = relay.findHeight(bestKnown);
    _updateRound(currentBestHeight);
  }

  function _checkRound(bytes29 _anchor, bytes29 _headers) internal returns (uint256) {
    uint256 relayHeight = relay.findHeight(_anchor.hash256());

    // should we check that it is not included yet?
    bytes29 _target = _headers.indexHeaderArray(0);
    try relay.findHeight(_target.hash256())  {
      revert("already included");
    } catch Error(string memory) {
      // not found, so it is a new block
    }
    
    bool isActiveSlot = currentRound.startBlock < relayHeight && relayHeight < currentRound.startBlock + SLOT_LENGTH;
    if (isActiveSlot) {
      require(msg.sender == currentRound.slotWinner, "not winner of current slot");
    }
    uint256 headerCount = _headers.length / 80;
    // if we have left the slot, or it is filling up, roll slots forward
    if (!isActiveSlot || relayHeight + headerCount >= currentRound.startBlock + SLOT_LENGTH) {
      _updateRound(relayHeight + headerCount);
    }
  }

  function addHeaders(bytes calldata _anchor, bytes calldata _headers) external returns (bool) {
    _checkRound(_anchor.ref(0).tryAsHeader(), _headers.ref(0).tryAsHeaderArray());
    require(relay.addHeaders(_anchor, _headers), "add header failed");
  }

  function addHeadersWithRetarget(
    bytes calldata _oldPeriodStartHeader,
    bytes calldata _oldPeriodEndHeader,
    bytes calldata _headers
  ) external returns (bool) {
    _checkRound(_oldPeriodEndHeader.ref(0).tryAsHeader(), _headers.ref(0).tryAsHeaderArray());
    require(
      relay.addHeadersWithRetarget(_oldPeriodStartHeader, _oldPeriodEndHeader, _headers),
      "add header with retarget failed"
    );
  }

  function markNewHeaviest(
    bytes32 _ancestor,
    bytes calldata _currentBest,
    bytes calldata _newBest,
    uint256 _limit
  ) external returns (bool) {
    // TODO: fix
    // _checkRound(_headers.ref(0).tryAsHeaderArray());
    require(
      relay.markNewHeaviest(_ancestor, _currentBest, _newBest, _limit),
      "mark new heaviest failed"
    );
  }

}
