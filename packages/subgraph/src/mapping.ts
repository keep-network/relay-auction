import { BigInt, Address } from '@graphprotocol/graph-ts';
import { Contract, Bid, NewRound, Snap } from '../generated/Contract/Contract';
import { Round, BidItem, Snapped } from '../generated/schema';

export function handleBid(event: Bid): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let bid = new BidItem(event.transaction.hash.toHex());
  bid.amount = event.params.amount;
  bid.time = event.block.timestamp.times(BigInt.fromI32(1000));
  bid.slotStartBlock = event.params.slotStartBlock;
  bid.relayer = event.params.relayer;

  // Entities can be written to the store with `.save()`
  bid.save();

  // Note: If a handler doesn't require existing field values, it is faster
  // _not_ to load the entity from the store. Instead, create it fresh with
  // `new Entity(...)`, set the fields that should be updated and save the
  // entity back to the store. Fields that were not set or unset remain
  // unchanged, allowing for partial updates to be applied.

  // It is also possible to access smart contracts from mappings. For
  // example, the contract that has emitted the event can be connected to
  // with:
  //
  // let contract = Contract.bind(event.address)
  //
  // The following functions can then be called on this contract to access
  // state variables and other data:
  //
  // - contract.addHeaders(...)
  // - contract.addHeadersWithRetarget(...)
  // - contract.bestBid(...)
  // - contract.currentRound(...)
  // - contract.markNewHeaviest(...)
}

export function handleNewRound(event: NewRound): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let round = new Round(event.transaction.hash.toHex());

  round.slotStartBlock = event.params.slotStartBlock;
  round.slotWinner = event.params.slotWinner;
  round.amount = event.params.amount;

  // Entities can be written to the store with `.save()`
  round.save();
}

export function handleSnap(event: Snap): void {
  let snap = new Snapped(event.transaction.hash.toHex());
  snap.slotStartBlock = event.params.slotStartBlock;
  snap.oldWinner = event.params.oldWinner;
  snap.newWinner = event.params.newWinner;
  snap.save();
}
