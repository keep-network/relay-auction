pragma solidity 0.6.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
  constructor(
    uint256 supply
  ) ERC20("name", "SYM") public {
    _mint(msg.sender, supply);
  }
}
