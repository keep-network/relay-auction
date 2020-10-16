pragma solidity 0.6.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
  constructor(uint256 supply) public ERC20("name", "SYM") {
    _mint(msg.sender, supply);
  }

  function burn(uint256 amount) public returns (bool) {
    _burn(msg.sender, amount);
  }
}
