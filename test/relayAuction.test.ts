import {ethers} from '@nomiclabs/buidler';
import {Signer, Contract, Wallet, BigNumber} from 'ethers';
import chai from 'chai';
import {expandTo18Decimals} from './shared/utilities';
import {deployContract, solidity} from 'ethereum-waffle';
import {MockRelay} from '../typechain/MockRelay';
import {MockRelayFactory} from '../typechain/MockRelayFactory';
import {MockErc20} from '../typechain/MockErc20';
import {MockErc20Factory} from '../typechain/MockErc20Factory';
import {RelayAuction} from '../typechain/RelayAuction';
import {RelayAuctionFactory} from '../typechain/RelayAuctionFactory';

chai.use(solidity);
const {expect} = chai;
const BYTES32_0 = '0x0000000000000000000000000000000000000000000000000000000000000000';

describe('RelayAuction', () => {
  let signers: Signer[];
  let relay: MockRelay;
  let rewardToken: MockErc20;
  let auctionToken: MockErc20;
  let auction: RelayAuction;

  before(async () => {
    signers = await ethers.getSigners();

    relay = await new MockRelayFactory(signers[0]).deploy(BYTES32_0, 210, BYTES32_0, 211);

    rewardToken = await new MockErc20Factory(signers[0]).deploy(
      expandTo18Decimals(10000)
    );

    auctionToken = await new MockErc20Factory(signers[0]).deploy(
      expandTo18Decimals(10000)
    );

    // deploy auction
    auction = await new RelayAuctionFactory(signers[0]).deploy(
      relay.address,
      rewardToken.address,
      expandTo18Decimals(100),
      auctionToken.address
    );
  });

  it('update', async () => {
    await auction.updateRound();

  });
});
