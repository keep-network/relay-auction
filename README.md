# Relay Auction

The [relay contract](https://etherscan.io/address/0x1531b6e3d51bf80f634957df81a990b92da4b154) implements a light client for the Bitcoin blockchain on Ethereum. If it is regularly fed with block headers, the canonical chain can be determined, and the block hashes stored on chain. Based on the stored block hashes and the knowledge of the canonical chain, inclusion proofs for transaction can be verified on chain, enabling a variety of use cases. The enabled use cases include bridges that migrate BTC between the chains and financial contracts like futures without requiring an intermediary.

## Tragedy of the Commons

The operation of the relay by submitting headers and marking the heaviest tip is not quite cheap. at ~ 144 blocks per day and a gas price of 500 gwei the relay can cost around 300 ETH a month. Even though multiple projects might use the relay for its operation, there is no way to coordinate between them. If the current relaying party stops submittings blocks, it hurts its own service, and hence has no leverage on the other market participant to chip in.

## Other coordination problems

Let's say a single party would incentivise the relay so as to decentralize operations. A token would be given out for every new relay to the sender of the transaction. The following problems would arise:
- relayers would rush to submit blocks, often submitting the same block simultaneously. This would waste gas and create a margin cost of being front run on top of the gas.
- relayers would compete in gas, effectively giving the difference between the cost and the reward to the miners.

## Creating a relay market through Relay Auctions

A smart contract holds a highest-bidder auction every day for the right to submit blocks the following day. The party holding the right for the current day is called slot-owner. At the close of the auction all but the winner receive their bids back. The price the winner paid is half burned, and half used as a stake for doing it's job during the auctioned period.

### Slot snapping

There is always the chance that a slot owner does not live up to its promise to submit blocks. Even though there is no game-theoretic incentive, hardware failure or misconfiguration can lead to missing blocks. The following process can be used by any-one to prove misbehaviour by the slot owner and the take over the current slot:
- provide 6 blocks and mark the new heaviest in 1 transaction.
- receive the stake of the previous slot owner.
- get the right to submit until the end of the slot instead of the previous owner.

### Market Equilibrium

The relayers have to estimate the cost of gas for the next 24 hours and anticipate the reward token price. The parties doing the best estimate will be successful in the long run, and the setup will generate the optimal price, without overpaying. Once miners enter the game, they can effectively push out other relayers, and make the relay even cheaper. 

## Proposal

- To set up a small website displaying:
  - the current and next slot. 
  - ongoing auction
  - offset from tip of Bitcoin chain

- The strudel team to develop the auction contract
  - the Keep team to review the auction contract
  - review assumptions: current relay can continue as it is, no changes needed

- To fund the process equally with 50% $TRDL and KEEP