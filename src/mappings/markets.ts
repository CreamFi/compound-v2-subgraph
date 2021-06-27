/* eslint-disable prefer-const */ // to satisfy AS compiler

// For each division by 10, add one to exponent to truncate one significant figure
import { Address, BigInt, dataSource } from '@graphprotocol/graph-ts'
import { Market } from '../types/schema'
import { ERC20 } from '../types/templates/CToken/ERC20'
import { CToken } from '../types/templates/CToken/CToken'

import { zeroBD } from './helpers'

let network = dataSource.network()

let cETHAddress: string =
  network == 'mainnet'
    ? '0xd06527d5e56a3495252a528c4987003b712860ee' // mainnet
    : '0x1ffe17b99b439be0afc831239ddecda2a790ff3a' // bsc

export function createMarket(marketAddress: string): Market {
  let market: Market
  let contract = CToken.bind(Address.fromString(marketAddress))

  // It is CETH, which has a slightly different interface
  if (marketAddress == cETHAddress) {
    market = new Market(marketAddress)
    market.underlyingAddress = Address.fromString(
      '0x0000000000000000000000000000000000000000',
    )
    market.underlyingDecimals = 18

    if (network == 'mainnet') {
      market.underlyingName = 'Ether'
      market.underlyingSymbol = 'ETH'
    } else {
      market.underlyingName = 'Binance Coin'
      market.underlyingSymbol = 'BNB'
    }
    // It is all other CERC20 contracts
  } else {
    market = new Market(marketAddress)
    market.underlyingAddress = contract.underlying()
    let underlyingContract = ERC20.bind(market.underlyingAddress as Address)
    market.underlyingDecimals = underlyingContract.decimals()
    market.underlyingName = underlyingContract.name()
    market.underlyingSymbol = underlyingContract.symbol()
  }

  market.totalInterestAccumulatedExact = BigInt.fromI32(0)
  market.totalInterestAccumulated = zeroBD

  let interestRateModelAddress = contract.try_interestRateModel()
  let reserveFactor = contract.try_reserveFactorMantissa()

  market.cash = zeroBD
  market.collateralFactor = zeroBD
  market.exchangeRate = zeroBD
  market.interestRateModelAddress = interestRateModelAddress.reverted
    ? Address.fromString('0x0000000000000000000000000000000000000000')
    : interestRateModelAddress.value
  market.name = contract.name()
  market.symbol = contract.symbol()
  market.totalBorrows = zeroBD
  market.totalSupply = zeroBD

  market.accrualBlockNumber = 0
  market.blockTimestamp = 0
  market.borrowIndex = zeroBD
  market.reserveFactor = reserveFactor.reverted ? BigInt.fromI32(0) : reserveFactor.value

  return market
}
