/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts'
import { Market, Comptroller } from '../types/schema'
import { PriceOracle } from '../types/templates/CToken/PriceOracle'
import { ERC20 } from '../types/templates/CToken/ERC20'
import { AccrueInterest, CToken } from '../types/templates/CToken/CToken'

import {
  exponentToBigDecimal,
  mantissaFactor,
  mantissaFactorBD,
  cTokenDecimalsBD,
  zeroBD,
} from './helpers'

// Used for all cERC20 contracts
function getTokenPrice(eventAddress: Address, underlyingDecimals: i32): BigDecimal {
  let comptroller = Comptroller.load('1')
  let oracleAddress = comptroller.priceOracle as Address
  let underlyingPrice: BigDecimal

  let mantissaDecimalFactor = 18 - underlyingDecimals + 18
  let bdFactor = exponentToBigDecimal(mantissaDecimalFactor)
  let oracle = PriceOracle.bind(oracleAddress)
  underlyingPrice = oracle
    .getUnderlyingPrice(eventAddress)
    .toBigDecimal()
    .div(bdFactor)

  return underlyingPrice
}

export function createMarket(marketAddress: string): Market {
  let market: Market
  let contract = CToken.bind(Address.fromString(marketAddress))

  market = new Market(marketAddress)
  market.underlyingAddress = contract.underlying()
  let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
  market.underlyingDecimals = underlyingContract.decimals()
  market.underlyingName = underlyingContract.name()
  market.underlyingSymbol = underlyingContract.symbol()
  market.underlyingPriceUSD = zeroBD
  market.underlyingPrice = zeroBD

  market.totalInterestAccumulatedExact = BigInt.fromI32(0)
  market.totalInterestAccumulated = zeroBD

  let interestRateModelAddress = contract.try_interestRateModel()
  let reserveFactor = contract.try_reserveFactorMantissa()

  market.borrowRate = zeroBD
  market.cash = zeroBD
  market.collateralFactor = zeroBD
  market.exchangeRate = zeroBD
  market.interestRateModelAddress = interestRateModelAddress.reverted
    ? Address.fromString('0x0000000000000000000000000000000000000000')
    : interestRateModelAddress.value
  market.name = contract.name()
  market.reserves = zeroBD
  market.supplyRate = zeroBD
  market.symbol = contract.symbol()
  market.totalBorrows = zeroBD
  market.totalSupply = zeroBD

  market.accrualBlockNumber = 0
  market.blockTimestamp = 0
  market.borrowIndex = zeroBD
  market.reserveFactor = reserveFactor.reverted ? BigInt.fromI32(0) : reserveFactor.value

  return market
}

export function updateMarket(event: AccrueInterest): Market {
  let marketAddress = event.address
  let blockNumber = event.block.number.toI32()
  let blockTimestamp = event.block.timestamp.toI32()

  let marketID = marketAddress.toHexString()
  let market = Market.load(marketID)
  if (market == null) {
    market = createMarket(marketID)
  }

  // Only updateMarket if it has not been updated this block
  if (market.accrualBlockNumber != blockNumber) {
    let contractAddress = Address.fromString(market.id)
    let contract = CToken.bind(contractAddress)

    let tokenPrice = market.underlyingPrice
    // update price every 10 minutes (300 blocks)
    if (tokenPrice.equals(zeroBD) || blockNumber - market.accrualBlockNumber > 300) {
      tokenPrice = getTokenPrice(contractAddress, market.underlyingDecimals)
    }
    market.underlyingPrice = tokenPrice.truncate(market.underlyingDecimals)
    market.underlyingPriceUSD = tokenPrice.truncate(market.underlyingDecimals)

    market.totalSupply = contract
      .totalSupply()
      .toBigDecimal()
      .div(cTokenDecimalsBD)

    /* Exchange rate explanation
       In Practice
        - If you call the cDAI contract on etherscan it comes back (2.0 * 10^26)
        - If you call the cUSDC contract on etherscan it comes back (2.0 * 10^14)
        - The real value is ~0.02. So cDAI is off by 10^28, and cUSDC 10^16
       How to calculate for tokens with different decimals
        - Must div by tokenDecimals, 10^market.underlyingDecimals
        - Must multiply by ctokenDecimals, 10^8
        - Must div by mantissa, 10^18
     */

    // Only update if it has not been updated in 300 blocks to speed up syncing process
    if (
      market.exchangeRate.equals(zeroBD) ||
      blockNumber - market.accrualBlockNumber > 300
    ) {
      market.exchangeRate = contract
        .exchangeRateStored()
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .times(cTokenDecimalsBD)
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)
    }

    market.borrowIndex = event.params.borrowIndex
      .toBigDecimal()
      .div(mantissaFactorBD)
      .truncate(mantissaFactor)

    // Only update if it has not been updated in 300 blocks to speed up syncing process
    if (blockNumber - market.accrualBlockNumber > 300) {
      market.reserves = contract
        .totalReserves()
        .toBigDecimal()
        .div(exponentToBigDecimal(market.underlyingDecimals))
        .truncate(market.underlyingDecimals)
    }

    market.totalBorrows = event.params.totalBorrows
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)
    market.cash = event.params.cashPrior
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)

    // Only update if it has not been updated in 300 blocks to speed up syncing process
    if (blockNumber - market.accrualBlockNumber > 300) {
      // Must convert to BigDecimal, and remove 10^18 that is used for Exp in Compound Solidity
      market.borrowRate = contract
        .borrowRatePerBlock()
        .toBigDecimal()
        .times(BigDecimal.fromString('15768000'))
        .div(mantissaFactorBD)
        .truncate(mantissaFactor)

      // This fails on only the first call to cZRX. It is unclear why, but otherwise it works.
      // So we handle it like this.
      let supplyRatePerBlock = contract.try_supplyRatePerBlock()
      if (supplyRatePerBlock.reverted) {
        log.info('***CALL FAILED*** : cERC20 supplyRatePerBlock() reverted', [])
        market.supplyRate = zeroBD
      } else {
        market.supplyRate = supplyRatePerBlock.value
          .toBigDecimal()
          .times(BigDecimal.fromString('15768000'))
          .div(mantissaFactorBD)
          .truncate(mantissaFactor)
      }
    }

    market.accrualBlockNumber = blockNumber
    market.blockTimestamp = blockTimestamp

    market.totalInterestAccumulatedExact = market.totalInterestAccumulatedExact.plus(
      event.params.interestAccumulated,
    )
    market.totalInterestAccumulated = market.totalInterestAccumulatedExact
      .toBigDecimal()
      .div(exponentToBigDecimal(market.underlyingDecimals))
      .truncate(market.underlyingDecimals)

    market.save()
  }
  return market as Market
}
