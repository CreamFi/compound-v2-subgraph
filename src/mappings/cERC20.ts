import {log, BigDecimal} from '@graphprotocol/graph-ts'
import {
  Mint,
  Redeem,
  Borrow,
  RepayBorrow,
  LiquidateBorrow,
  Transfer,
  AccrueInterest,
  CErc20,
} from '../types/cREP/CErc20'

import {
  Market,
  User,
  CTokenInfo,
} from '../types/schema'

import {calculateLiquidty, updateMarket} from "./helpers";

/*  User supplies assets into market and receives cTokens in exchange
 *  Note - Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.mintAmount is the underlying asset
 *  event.mintTokens is the amount of cTokens minted
 *  event.minter is the user
 *  note - mints  originate from the cToken address, not 0x000000, which is typical of ERC-20s
 */
export function handleMint(event: Mint): void {
  updateMarket(event.address, event.block.number.toI32(), false)

  /********** User Below **********/
  let userID = event.params.minter.toHex()
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString("0")
    user.totalSupplyInEth = BigDecimal.fromString("0")
    user.hasBorrowed = false
    user.save()
  }

  let cTokenStatsID = event.address.toHexString().concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)
  if (cTokenStats == null) {
    cTokenStats = new CTokenInfo(cTokenStatsID)
    cTokenStats.user = event.params.minter.toHexString()
    cTokenStats.transactionHashes = []
    cTokenStats.transactionTimes = []
    cTokenStats.underlyingSupplied = BigDecimal.fromString("0")
    cTokenStats.underlyingRedeemed = BigDecimal.fromString("0")
    // cTokenStats.underlyingBalance =  BigDecimal.fromString("0")
    // cTokenStats.interestEarned =  BigDecimal.fromString("0")
    cTokenStats.cTokenBalance = BigDecimal.fromString("0")
    cTokenStats.totalBorrowed = BigDecimal.fromString("0")
    cTokenStats.totalRepaid = BigDecimal.fromString("0")
    // cTokenStats.borrowBalance = BigDecimal.fromString("0")
    // cTokenStats.borrowInterest =  BigDecimal.fromString("0")
    let market = Market.load(event.address.toHexString())
    cTokenStats.symbol = market.symbol
  }

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  // We use low level call here, since the function is not a view function.
  // However, it still works, but gives the stored state of the most recent block update
  let cTokenContract = CErc20.bind(event.address)
  // let underlyingBalance = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.minter)])
  // cTokenStats.underlyingBalance = underlyingBalance[0].toBigInt().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  // cTokenStats.interestEarned = cTokenStats.underlyingBalance.minus(cTokenStats.underlyingSupplied).plus(cTokenStats.underlyingRedeemed)

  cTokenStats.cTokenBalance = cTokenContract.balanceOf(event.params.minter).toBigDecimal().div(BigDecimal.fromString("100000000"))
  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  if (user.hasBorrowed == true) {
    calculateLiquidty(userID)
  }
}


/*  User supplies cTokens into market and receives underlying asset in exchange
 *  Note - Transfer event always also gets emitted. Leave cTokens state change to that event
 *  event.redeemAmount is the underlying asset
 *  event.redeemTokens is the cTokens
 *  event.redeemer is the user
 */
export function handleRedeem(event: Redeem): void {
  updateMarket(event.address, event.block.number.toI32(), false)

  let userID = event.params.redeemer.toHex()
  let cTokenStatsID = event.address.toHexString().concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  if (cTokenStats == null) {
    cTokenStats = new CTokenInfo(cTokenStatsID)
    cTokenStats.user = event.params.redeemer.toHexString()
    cTokenStats.transactionHashes = []
    cTokenStats.transactionTimes = []
    cTokenStats.underlyingSupplied = BigDecimal.fromString("0")
    cTokenStats.underlyingRedeemed = BigDecimal.fromString("0")
    // cTokenStats.underlyingBalance =  BigDecimal.fromString("0")
    // cTokenStats.interestEarned =  BigDecimal.fromString("0")
    cTokenStats.cTokenBalance = BigDecimal.fromString("0")
    cTokenStats.totalBorrowed = BigDecimal.fromString("0")
    cTokenStats.totalRepaid = BigDecimal.fromString("0")
    // cTokenStats.borrowBalance = BigDecimal.fromString("0")
    // cTokenStats.borrowInterest =  BigDecimal.fromString("0")
    let market = Market.load(event.address.toHexString())
    cTokenStats.symbol = market.symbol
  }

  /********** User Updates Below **********/ //
  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  // We use low level call here, since the function is not a view function.
  // However, it still works, but gives the stored state of the most recent block update
  let cTokenContract = CErc20.bind(event.address)
  // let underlyingBalance = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.redeemer)])
  // cTokenStats.underlyingBalance = underlyingBalance[0].toBigInt().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  // cTokenStats.interestEarned = cTokenStats.underlyingBalance.minus(cTokenStats.underlyingSupplied).plus(cTokenStats.underlyingRedeemed)
  cTokenStats.cTokenBalance = cTokenContract.balanceOf(event.params.redeemer).toBigDecimal().div(BigDecimal.fromString("100000000"))
  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString("0")
    user.totalSupplyInEth = BigDecimal.fromString("0")
    user.hasBorrowed = false
    user.save()
  }
  if (user.hasBorrowed == true) {
    calculateLiquidty(userID)
  }
}

/* Borrow assets from the protocol
 * event.params.totalBorrows = of the whole market
 * event.params.accountBorrows = total of the account
 * event.params.borrowAmount = that was added in this event
 * event.params.borrower = the user
 */
export function handleBorrow(event: Borrow): void {
  updateMarket(event.address, event.block.number.toI32(), false)

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let cTokenStatsID = event.address.toHexString().concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  // this is needed, since you could lend in one asset and borrow in another
  if (cTokenStats == null) {
    cTokenStats = new CTokenInfo(cTokenStatsID)
    cTokenStats.user = event.params.borrower.toHexString()
    cTokenStats.transactionHashes = []
    cTokenStats.transactionTimes = []
    cTokenStats.underlyingSupplied = BigDecimal.fromString("0")
    cTokenStats.underlyingRedeemed = BigDecimal.fromString("0")
    // cTokenStats.underlyingBalance =  BigDecimal.fromString("0")
    // cTokenStats.interestEarned =  BigDecimal.fromString("0")
    cTokenStats.cTokenBalance = BigDecimal.fromString("0")
    cTokenStats.totalBorrowed = BigDecimal.fromString("0")
    cTokenStats.totalRepaid = BigDecimal.fromString("0")
    // cTokenStats.borrowBalance = BigDecimal.fromString("0")
    // cTokenStats.borrowInterest =  BigDecimal.fromString("0")
    let market = Market.load(event.address.toHexString())
    cTokenStats.symbol = market.symbol
  }

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  let cTokenContract = CErc20.bind(event.address)
  // let borrowBalance = contract.call('borrowBalanceCurrent', [EthereumValue.fromAddress(event.params.borrower)])
  // cTokenStats.borrowBalance = borrowBalance[0].toBigInt().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  cTokenStats.totalBorrowed = cTokenStats.totalBorrowed.plus(event.params.borrowAmount.toBigDecimal().div(BigDecimal.fromString("1000000000000000000")))
  // cTokenStats.borrowInterest = cTokenStats.borrowBalance.minus(cTokenStats.totalBorrowed).plus(cTokenStats.totalRepaid)
  cTokenStats.cTokenBalance = cTokenContract.balanceOf(event.params.borrower).toBigDecimal().div(BigDecimal.fromString("100000000"))
  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString("0")
    user.totalSupplyInEth = BigDecimal.fromString("0")
    user.hasBorrowed = false
    user.save()
  }
  user.hasBorrowed = true
  user.save()
  calculateLiquidty(userID)

}

/* Repay some amount borrowed. Anyone can repay anyones balance
 * event.params.totalBorrows = of the whole market
 * event.params.accountBorrows = total of the account
 * event.params.repayAmount = that was added in this event
 * event.params.borrower = the borrower
 * event.params.payer = the payer
 */
export function handleRepayBorrow(event: RepayBorrow): void {
  updateMarket(event.address, event.block.number.toI32(), false)

  /********** User Updates Below **********/
  let userID = event.params.borrower.toHex()
  let cTokenStatsID = event.address.toHexString().concat('-').concat(userID)
  let cTokenStats = CTokenInfo.load(cTokenStatsID)

  let txHashes = cTokenStats.transactionHashes
  txHashes.push(event.transaction.hash)
  cTokenStats.transactionHashes = txHashes
  let txTimes = cTokenStats.transactionTimes
  txTimes.push(event.block.timestamp.toI32())
  cTokenStats.transactionTimes = txTimes
  cTokenStats.accrualBlockNumber = event.block.number

  let cTokenContract = CErc20.bind(event.address)
  // let borrowBalance = contract.call('borrowBalanceCurrent', [EthereumValue.fromAddress(event.params.borrower)])
  // cTokenStats.borrowBalance = borrowBalance[0].toBigInt().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  cTokenStats.totalRepaid = cTokenStats.totalRepaid.plus(event.params.repayAmount.toBigDecimal().div(BigDecimal.fromString("1000000000000000000")))
  // cTokenStats.borrowInterest = cTokenStats.borrowBalance.minus(cTokenStats.totalBorrowed).plus(cTokenStats.totalRepaid)
  cTokenStats.cTokenBalance = cTokenContract.balanceOf(event.params.borrower).toBigDecimal().div(BigDecimal.fromString("100000000"))
  cTokenStats.save()

  /********** Liquidity Calculations Below **********/
  let user = User.load(userID)
  if (user == null) {
    user = new User(userID)
    user.cTokens = []
    user.countLiquidated = 0
    user.countLiquidator = 0
    user.totalBorrowInEth = BigDecimal.fromString("0")
    user.totalSupplyInEth = BigDecimal.fromString("0")
    user.hasBorrowed = false
    user.save()
  }
  if (user.hasBorrowed == true) {
    calculateLiquidty(userID)
  }
}

/*
 * Note - when calling this function, event RepayBorrow, and event Transfer will be called
 * every single time too. this means we can ignore repayAmount. Seize tokens only changes state
 * of the ctokens, which is covered by transfer. therefore we don't really need to update
 * anything in this event. However, we will add a count of times liquidated and times liquidating
 *
 * event.params.borrower - the borrower who is getting liquidated of their cTokens
 * event.params.cTokenCollateral - the market ADDRESS of the ctoken being liquidated
 * event.params.liquidator - the liquidator
 * event.params.repayAmount - the amount of underlying to be repaid
 * event.params.seizeTokens - cTokens seized (transfer event should handle this)
*/

export function handleLiquidateBorrow(event: LiquidateBorrow): void {
  updateMarket(event.address, event.block.number.toI32(), false)

  /********** User Updates Below **********/
  let liquidatorID = event.params.liquidator.toHex()
  let liquidator = User.load(liquidatorID)
  if (liquidator == null) {
    liquidator = new User(liquidatorID)
    liquidator.countLiquidated = 0
    liquidator.countLiquidator = 0
    liquidator.cTokens = []
    liquidator.totalBorrowInEth = BigDecimal.fromString("0")
    liquidator.totalSupplyInEth = BigDecimal.fromString("0")
    liquidator.hasBorrowed = false
  }
  liquidator.countLiquidator = liquidator.countLiquidator + 1
  liquidator.save()

  let borrowerID = event.params.borrower.toHex()
  let borrower = User.load(borrowerID)
  if (borrower == null) {
    borrower = new User(borrowerID)
    borrower.cTokens = []
    borrower.countLiquidated = 0
    borrower.countLiquidator = 0
    borrower.totalBorrowInEth = BigDecimal.fromString("0")
    borrower.totalSupplyInEth = BigDecimal.fromString("0")
    borrower.hasBorrowed = false
    borrower.save()
  }
  borrower.countLiquidated = borrower.countLiquidated + 1
  borrower.save()

  // note - no liquidity calculations needed here. They are handled in Transfer event
  //        which is always triggered by a liquidation

}

/* Possible ways to emit Transfer:
 *    seize() - i.e. a Liquidation Transfer
 *    redeemFresh() - i.e. redeeming your cTokens for underlying asset
 *    mintFresh() - i.e. you are lending underlying assets to create ctokens
 *    transfer() - i.e. a basic transfer
 * This function must handle all 4 cases, since duplicate data is emitted in the back-to-back transfer
 * The simplest way to do this is call getAccountSnapshot, in here, and leave out any cTokenBalance
 * calculations in the other function. This way we never add or subtract and deviate from the true
 * value store in the smart contract
 */
export function handleTransfer(event: Transfer): void {
  /********** Market Updates Below **********/
  let marketID = event.address.toHex()
  let market = Market.load(marketID)
  let contract = CErc20.bind(event.address)

  // Since transfer does not effect any coins or cTokens, it just transfers cTokens, we only update
  // market values that are dependant on the block delta
  market.borrowIndex = contract.borrowIndex().toBigDecimal()

  // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
  market.perBlockBorrowInterest = contract.borrowRatePerBlock().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  market.perBlockSupplyInterest = contract.supplyRatePerBlock().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))

  market.save()

  // Calculate the exchange rate and amount of underlying being transferred
  let exchangeRate = contract.exchangeRateStored().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  let amountUnderlying = exchangeRate.times(event.params.amount.toBigDecimal())

  /********** User From Updates Below **********/
  let userFromID = event.params.from.toHex()
  let userFrom = User.load(userFromID)
  if (userFrom == null) {
    userFrom = new User(userFromID)
    userFrom.cTokens = []
    userFrom.countLiquidated = 0
    userFrom.countLiquidator = 0
    userFrom.totalBorrowInEth = BigDecimal.fromString("0")
    userFrom.totalSupplyInEth = BigDecimal.fromString("0")
    userFrom.hasBorrowed = false
    userFrom.save()
  }

  let cTokenStatsFromID = market.id.concat('-').concat(event.params.from.toHex())
  let cTokenStatsFrom = CTokenInfo.load(cTokenStatsFromID)

  let txHashesFrom = cTokenStatsFrom.transactionHashes
  txHashesFrom.push(event.transaction.hash)
  cTokenStatsFrom.transactionHashes = txHashesFrom
  let txTimesFrom = cTokenStatsFrom.transactionTimes
  txTimesFrom.push(event.block.timestamp.toI32())
  cTokenStatsFrom.transactionTimes = txTimesFrom
  cTokenStatsFrom.accrualBlockNumber = event.block.number


  let accountSnapshotFrom = contract.getAccountSnapshot(event.params.from)
  cTokenStatsFrom.cTokenBalance = accountSnapshotFrom.value1.toBigDecimal().div(BigDecimal.fromString("100000000"))
  // cTokenStatsFrom.borrowBalance = accountSnapshotFrom.value2.toBigDecimal().div(BigDecimal.fromString("1000000000000000000")) // might as well update this, as it depends on block number

  // let underlyingBalanceFrom = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.from)])
  cTokenStatsFrom.underlyingRedeemed = cTokenStatsFrom.underlyingRedeemed.minus(amountUnderlying)
  // cTokenStatsFrom.underlyingBalance = underlyingBalanceFrom[0].toBigInt().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  // cTokenStatsFrom.interestEarned = cTokenStatsFrom.underlyingBalance.minus(cTokenStatsFrom.underlyingSupplied).plus(cTokenStatsFrom.underlyingRedeemed)
  cTokenStatsFrom.save()

  /********** User To Updates Below **********/
    // We do the same for userTo as we did for userFrom, but check if user and cTokenStats entities are null
  let userToID = event.params.to.toHex()
  let userTo = User.load(userToID)
  if (userTo == null) {
    userTo = new User(userToID)
    userTo.cTokens = []
    userTo.countLiquidated = 0
    userTo.countLiquidator = 0
    userTo.totalBorrowInEth = BigDecimal.fromString("0")
    userTo.totalSupplyInEth = BigDecimal.fromString("0")
    userTo.hasBorrowed = false
    userTo.save()
  }

  let cTokenStatsToID = market.id.concat('-').concat(userToID)
  let cTokenStatsTo = CTokenInfo.load(cTokenStatsToID)
  if (cTokenStatsTo == null) {
    cTokenStatsTo = new CTokenInfo(cTokenStatsToID)
    cTokenStatsTo.user = event.params.to.toHexString()
    cTokenStatsTo.symbol = market.symbol
    cTokenStatsTo.transactionHashes = []
    cTokenStatsTo.transactionTimes = []
    cTokenStatsTo.underlyingSupplied = BigDecimal.fromString("0")
    cTokenStatsTo.underlyingRedeemed = BigDecimal.fromString("0")
    // cTokenStatsTo.underlyingBalance =  BigDecimal.fromString("0")
    // cTokenStatsTo.interestEarned =  BigDecimal.fromString("0")
    cTokenStatsTo.cTokenBalance = BigDecimal.fromString("0")
    cTokenStatsTo.totalBorrowed = BigDecimal.fromString("0")
    cTokenStatsTo.totalRepaid = BigDecimal.fromString("0")
    // cTokenStatsTo.borrowBalance = BigDecimal.fromString("0")
    // cTokenStatsTo.borrowInterest =  BigDecimal.fromString("0")
  }

  let txHashesTo = cTokenStatsTo.transactionHashes
  txHashesTo.push(event.transaction.hash)
  cTokenStatsTo.transactionHashes = txHashesTo
  let txTimesTo = cTokenStatsTo.transactionTimes
  txTimesTo.push(event.block.timestamp.toI32())
  cTokenStatsTo.transactionTimes = txTimesTo
  cTokenStatsTo.accrualBlockNumber = event.block.number

  let accountSnapshotTo = contract.getAccountSnapshot(event.params.to)
  cTokenStatsTo.cTokenBalance = accountSnapshotTo.value1.toBigDecimal().div(BigDecimal.fromString("100000000"))
  // cTokenStatsTo.borrowBalance = accountSnapshotTo.value2.toBigDecimal().div(BigDecimal.fromString("1000000000000000000")) // might as well update this, as it depends on block number

  // let underlyingBalanceTo = contract.call('balanceOfUnderlying', [EthereumValue.fromAddress(event.params.to)])
  // cTokenStatsTo.underlyingBalance = underlyingBalanceTo [0].toBigInt().toBigDecimal().div(BigDecimal.fromString("1000000000000000000"))
  cTokenStatsTo.underlyingSupplied = cTokenStatsTo.underlyingSupplied.plus(amountUnderlying)
  // cTokenStatsTo.interestEarned = cTokenStatsTo.underlyingBalance.minus(cTokenStatsTo.underlyingSupplied).plus(cTokenStatsTo.underlyingRedeemed)
  cTokenStatsTo.save()

  /********** Liquidation Updates Below **********/
  if (userFrom.hasBorrowed == true) {
    calculateLiquidty(userFromID)
  }
  calculateLiquidty(userToID)
}

export function handleAccrueInterest(event: AccrueInterest): void {
  updateMarket(event.address, event.block.number.toI32(), false)
}