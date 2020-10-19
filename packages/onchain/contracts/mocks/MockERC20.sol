pragma solidity 0.6.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
  constructor(uint256 supply) public ERC20("name", "SYM") {
    _mint(msg.sender, supply);
  }

  function burn(uint256 amount) public returns (bool) {
    _burn(msg.sender, amount);
  }

  function permit(
    address owner,
    address spender,
    uint256 value,
    uint256 deadline,
    uint8 v,
    bytes32 r,
    bytes32 s
  ) external {
    // mock
  }
}
