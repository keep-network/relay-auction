import {ethers} from '@nomiclabs/buidler';
import {Signer, BigNumber} from 'ethers';
import chai from 'chai';
import {solidity} from 'ethereum-waffle';
import {expandTo18Decimals, concatenateHexStrings} from './shared/utilities';
import REGULAR_CHAIN from './headers.json';
import {MockRelay} from '../typechain/MockRelay';
import {MockRelayFactory} from '../typechain/MockRelayFactory';
import {MockErc20} from '../typechain/MockErc20';
import {MockErc20Factory} from '../typechain/MockErc20Factory';
import {RelayAuction} from '../typechain/RelayAuction';
import {RelayAuctionFactory} from '../typechain/RelayAuctionFactory';

chai.use(solidity);
const {expect} = chai;
const rewardAmount = expandTo18Decimals(2);

describe('Extra RelayAuction', () => {
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

    it('early slot snapping', async () => {
        // Alice places a bid.
        const aliceAddr = await alice.getAddress();
        await auctionToken.connect(alice).approve(auction.address, expandTo18Decimals(200));
        await auction.connect(alice).bid(144, expandTo18Decimals(4));

        // Check Alice placed best bid.
        let bestBid = await auction.bestBid(144);
        expect(bestBid).to.eq(aliceAddr);

        // Prepare chain at height 144.
        const {chain, genesis} = REGULAR_CHAIN;
        await relay.addHeader(genesis.digest_le, 144);

        // Move into next round which starts at slot 144.
        // Also, mark the last added header (index 4) as the new best. Note that
        // current best digest (genesis), NOT the new best digest, should be passed
        // as ancestor.
        const headerHex = chain.map((header) => header.hex);
        let headers = concatenateHexStrings(headerHex.slice(0, 5)); // five headers
        await auction.addHeaders(genesis.hex, headers);
        let tx = await auction
            .connect(alice)
            .markNewHeaviest(genesis.digest_le, genesis.hex, chain[4].hex, 6);

        // Check new round state.
        let currentRound = await auction.currentRound();
        expect(currentRound.slotWinner).to.eq(aliceAddr);
        expect(currentRound.startBlock).to.eq(144);

        // Bob snaps the slot by adding only one header and calling `markNewHeaviest`.
        headers = concatenateHexStrings(headerHex.slice(5, 6)); // one header
        await auction.connect(bob).addHeaders(chain[4].hex, headers);
        tx = await auction
            .connect(bob)
            .markNewHeaviest(chain[4].digest_le, chain[4].hex, chain[5].hex, 1);

        // Check round state again.
        const bobAddr = await bob.getAddress();
        currentRound = await auction.currentRound();
        expect(currentRound.slotWinner).to.eq(bobAddr);
        expect(currentRound.startBlock).to.eq(144);
    });
});
