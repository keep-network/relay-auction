import {ethers} from '@nomiclabs/buidler';
import {Signer, Contract, Wallet, BigNumber} from 'ethers';
import chai from 'chai';
import {ecsign} from 'ethereumjs-util';
import {deployContract, solidity, MockProvider} from 'ethereum-waffle';
import {expandTo18Decimals, concatenateHexStrings, getApprovalDigest} from './shared/utilities';
import REGULAR_CHAIN from './headers.json';
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
const MAX = ethers.constants.MaxUint256;

describe('RelayAuction', () => {
  let dev: Signer;
  let alice: Signer;
  let bob: Signer;
  let relay: MockRelay;
  let rewardToken: MockErc20;
  let auctionToken: MockErc20;
  let auction: RelayAuction;
  let roundGas: BigNumber;
  let snapGas: BigNumber;

  before(async () => {
    [dev, alice, bob] = await ethers.getSigners();

    const {chain, genesis} = REGULAR_CHAIN;
    relay = await new MockRelayFactory(dev).deploy(genesis.digest_le, 143, genesis.digest_le, 143);

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

    // try to withdraw before round over
    await expect(auction.connect(bob).withdrawBid(288)).to.be.revertedWith(
      'can not withdraw from future rounds'
    );

    // try direct call to update Round
    await relay.markNewHeaviest(chain[5].digest_le, chain[2].hex, chain[5].hex, 3);
    await auction.updateRound();

    // check earnings of relayer
    const aliceRewardBal = await rewardToken.balanceOf(aliceAddr);
    expect(aliceRewardBal).to.eq(rewardAmount);
    const aliceBalAfter = await auctionToken.balanceOf(aliceAddr);
    expect(aliceBalAfter.sub(aliceBalBefore)).to.eq(expandTo18Decimals(2));

    // bob getting into next round
    await auction.connect(bob).bid(432, expandTo18Decimals(4));

    // bob to withdraw lost bid
    const bobBalBefore = await auctionToken.balanceOf(bobAddr);
    await auction.connect(bob).withdrawBid(288);
    const bobBalAfter = await auctionToken.balanceOf(bobAddr);
    expect(bobBalAfter.sub(bobBalBefore)).to.eq(expandTo18Decimals(4));

    // prepare chain at height 431
    await relay.addHeader(chain[5].digest_le, 431);
    headers = concatenateHexStrings(headerHex.slice(6, 9));
    await auction.connect(bob).addHeaders(chain[5].hex, headers);

    // move round forward
    tx = await auction
      .connect(alice)
      .markNewHeaviest(chain[8].digest_le, chain[5].hex, chain[8].hex, 3);
    roundGas = (await tx.wait(1)).gasUsed;
  });

  it('slot snapping', async () => {
    // check round state
    const bobAddr = await bob.getAddress();
    let currentRound = await auction.currentRound();
    expect(currentRound.slotWinner).to.eq(bobAddr);
    expect(currentRound.startBlock).to.eq(432);
    const la = await auction.lastAncestor();

    // prepare chain at height 434
    const {chain, genesis} = REGULAR_CHAIN;
    const headerHex = chain.map((header) => header.hex);
    let headers = concatenateHexStrings(headerHex.slice(9, 14));
    await auction.connect(alice).addHeaders(chain[8].hex, headers);
    const tx = await auction
      .connect(alice)
      .markNewHeaviest(chain[13].digest_le, chain[8].hex, chain[13].hex, 6);
    snapGas = (await tx.wait(1)).gasUsed;

    // check state again
    const aliceAddr = await alice.getAddress();
    currentRound = await auction.currentRound();
    expect(currentRound.slotWinner).to.eq(aliceAddr);
    expect(currentRound.startBlock).to.eq(432);
  });

  it('test permit', async () => {
    const priv = '0x043a569345b08ead19d1d4ba3462b30632feba623a2a85a3b000eb97f709f09f';
    const provider = new MockProvider({
      ganacheOptions: {
        accounts: [{balance: '100', secretKey: priv}],
      },
    });
    const [wallet] = provider.getWallets();

    const nonce = await auctionToken.nonces(wallet.address);
    const deadline = MAX;
    const digest = await getApprovalDigest(
      auctionToken,
      {owner: wallet.address, spender: auction.address, value: MAX},
      nonce,
      deadline
    );
    const {v, r, s} = ecsign(
      Buffer.from(digest.slice(2), 'hex'),
      Buffer.from(priv.replace('0x', ''), 'hex')
    );

    await auction.bidWithPermit(576, expandTo18Decimals(4), deadline, v, r, s);

    const bestBid = await auction.bestBid(576);
    const devAddr = await dev.getAddress();
    expect(bestBid).to.eq(devAddr);
  });

  it('gas tests', async () => {
    // do relay within slot
    const {chain, genesis} = REGULAR_CHAIN;
    const headerHex = chain.map((header) => header.hex);
    let headers = concatenateHexStrings(headerHex.slice(14, 17));
    await auction.connect(alice).addHeaders(chain[13].hex, headers);
    let tx = await auction
      .connect(alice)
      .markNewHeaviest(chain[16].digest_le, chain[13].hex, chain[16].hex, 3);
    const simpleMarkGas = (await tx.wait(1)).gasUsed;
    expect(simpleMarkGas).to.be.lt(66000);
    expect(snapGas).to.be.lt(77000);
    expect(roundGas).to.be.lt(120000);
  });
});
