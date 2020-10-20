import {ethers} from '@nomiclabs/buidler';
import {Signer, Contract, Wallet, BigNumber} from 'ethers';
import chai from 'chai';
import REGULAR_CHAIN from './headers.json';
import {expandTo18Decimals, concatenateHexStrings} from './shared/utilities';
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
const rewardAmount = expandTo18Decimals(2);

describe('RelayAuction', () => {
  let dev: Signer;
  let alice: Signer;
  let bob: Signer;
  let relay: MockRelay;
  let rewardToken: MockErc20;
  let auctionToken: MockErc20;
  let auction: RelayAuction;

  before(async () => {
    [dev, alice, bob] = await ethers.getSigners();

    const {chain, genesis} = REGULAR_CHAIN;
    relay = await new MockRelayFactory(dev).deploy(genesis.digest_le, 143, BYTES32_0, 211);

    rewardToken = await new MockErc20Factory(dev).deploy(expandTo18Decimals(10000));

    auctionToken = await new MockErc20Factory(dev).deploy(expandTo18Decimals(10000));
    const aliceAddr = await alice.getAddress();
    await auctionToken.transfer(aliceAddr, expandTo18Decimals(500));
    const bobAddr = await bob.getAddress();
    await auctionToken.transfer(bobAddr, expandTo18Decimals(500));

    // deploy auction
    auction = await new RelayAuctionFactory(dev).deploy(
      relay.address,
      rewardToken.address,
      rewardAmount,
      auctionToken.address
    );
    await rewardToken.transfer(auction.address, expandTo18Decimals(200));
  });

  it('update', async () => {
    // place a bid
    const aliceAddr = await alice.getAddress();
    await auctionToken.connect(alice).approve(auction.address, expandTo18Decimals(200));
    await auction.connect(alice).bid(144, expandTo18Decimals(4));

    // check alice placed best bid
    let bestBid = await auction.bestBid(144);
    expect(bestBid).to.eq(aliceAddr);

    // prepare chain at height 143
    const {chain, genesis} = REGULAR_CHAIN;
    const headerHex = chain.map((header) => header.hex);
    let headers = concatenateHexStrings(headerHex.slice(0, 3));
    await relay.addHeader(genesis.digest_le, 143);

    // move into next round
    await auction.addHeaders(genesis.hex, headers);
    let tx = await auction
      .connect(alice)
      .markNewHeaviest(chain[2].digest_le, genesis.hex, chain[2].hex, 3);
    // const events = (await tx.wait(1)).events!;
    // console.log('events: ', events);

    // check new round state
    let currentRound = await auction.currentRound();
    expect(currentRound.slotWinner).to.eq(aliceAddr);
    expect(currentRound.startBlock).to.eq(144);

    // bet on next round
    const bobAddr = await bob.getAddress();
    await auctionToken.connect(bob).approve(auction.address, expandTo18Decimals(200));
    await auction.connect(bob).bid(288, expandTo18Decimals(4));

    // check bob has best bet
    bestBid = await auction.bestBid(288);
    expect(bestBid).to.eq(bobAddr);

    // alice to outbid bob
    await auction.connect(alice).bid(288, expandTo18Decimals(6));
    bestBid = await auction.bestBid(288);
    expect(bestBid).to.eq(aliceAddr);

    const aliceBalBefore = await auctionToken.balanceOf(aliceAddr);

    // prepare chain at height 287
    await relay.addHeader(chain[2].digest_le, 287);
    headers = concatenateHexStrings(headerHex.slice(3, 6));
    await auction.connect(bob).addHeaders(chain[2].hex, headers);
    await auction.connect(alice).markNewHeaviest(chain[5].digest_le, chain[2].hex, chain[5].hex, 3);

    // check earnings of relayer
    const aliceRewardBal = await rewardToken.balanceOf(aliceAddr);
    expect(aliceRewardBal).to.eq(rewardAmount);
    const aliceBalAfter = await auctionToken.balanceOf(aliceAddr);
    expect(aliceBalAfter.sub(aliceBalBefore)).to.eq(expandTo18Decimals(2));

    // bob getting into next round
    await auction.connect(bob).bid(432, expandTo18Decimals(4));

    // prepare chain at height 431
    await relay.addHeader(chain[5].digest_le, 431);
    headers = concatenateHexStrings(headerHex.slice(6, 9));
    await auction.connect(bob).addHeaders(chain[5].hex, headers);

    // try to withdraw before round over
    await expect(auction.connect(bob).withdrawBid(288)).to.be.revertedWith(
      'can not withdraw from future rounds'
    );

    // move round forward
    await auction.connect(alice).markNewHeaviest(chain[8].digest_le, chain[5].hex, chain[8].hex, 3);

    // bob to withdraw lost bid
    const bobBalBefore = await auctionToken.balanceOf(bobAddr);
    await auction.connect(bob).withdrawBid(288);
    const bobBalAfter = await auctionToken.balanceOf(bobAddr);
    expect(bobBalAfter.sub(bobBalBefore)).to.eq(expandTo18Decimals(4));
  });

  it('slot snapping', async () => {});

  it('test permit');
});
