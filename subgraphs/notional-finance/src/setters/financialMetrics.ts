import {
  BigDecimal,
  BigInt,
  Address,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import { ERC20 } from "../../generated/Notional/ERC20";
import { Notional } from "../../generated/Notional/Notional";
import {
  BIGDECIMAL_ZERO,
  NOTIONAL_SUPPLY_SIDE_REVENUE_SHARE,
  NOTIONAL_PROTOCOL_SIDE_REVENUE_SHARE,
  TransactionType,
  NOTIONAL_TRADE_FEES,
  PROTOCOL_ID,
} from "../common/constants";
import { bigIntToBigDecimal } from "../common/numbers";
import { getTokenFromCurrency } from "../common/util";
import { getOrCreateFinancialsDailySnapshot } from "../getters/financialMetrics";
import {
  getMarketsWithStatus,
  getOrCreateMarket,
  getOrCreateMarketDailySnapshot,
  getOrCreateMarketHourlySnapshot,
} from "../getters/market";
import { getOrCreateLendingProtocol } from "../getters/protocol";
import { getOrCreateToken } from "../getters/token";

export function updateFinancials(
  event: ethereum.Event,
  amountUSD: BigDecimal,
  marketId: string
): void {
  const financialsDailySnapshots = getOrCreateFinancialsDailySnapshot(event);
  const marketHourlySnapshot = getOrCreateMarketHourlySnapshot(event, marketId);
  const marketDailySnapshot = getOrCreateMarketDailySnapshot(event, marketId);
  const protocol = getOrCreateLendingProtocol();
  const market = getOrCreateMarket(event, marketId);

  // fees and revenue amounts
  const feesUSD = amountUSD.times(NOTIONAL_TRADE_FEES);
  const totalRevenueUSD = feesUSD;
  const supplySideRevenueUSD = feesUSD.times(
    NOTIONAL_SUPPLY_SIDE_REVENUE_SHARE
  );
  const protocolSideRevenueUSD = feesUSD.times(
    NOTIONAL_PROTOCOL_SIDE_REVENUE_SHARE
  );

  // market cumulatives
  market.cumulativeTotalRevenueUSD =
    market.cumulativeTotalRevenueUSD.plus(totalRevenueUSD);
  market.cumulativeSupplySideRevenueUSD =
    market.cumulativeSupplySideRevenueUSD.plus(supplySideRevenueUSD);
  market.cumulativeProtocolSideRevenueUSD =
    market.cumulativeProtocolSideRevenueUSD.plus(protocolSideRevenueUSD);
  market.save();

  // protocol cumulatives
  protocol.cumulativeTotalRevenueUSD =
    protocol.cumulativeTotalRevenueUSD.plus(totalRevenueUSD);
  protocol.cumulativeSupplySideRevenueUSD =
    protocol.cumulativeSupplySideRevenueUSD.plus(supplySideRevenueUSD);
  protocol.cumulativeProtocolSideRevenueUSD =
    protocol.cumulativeProtocolSideRevenueUSD.plus(protocolSideRevenueUSD);

  // financials daily - daily revenues
  financialsDailySnapshots.dailyTotalRevenueUSD =
    financialsDailySnapshots.dailyTotalRevenueUSD.plus(totalRevenueUSD);
  financialsDailySnapshots.dailySupplySideRevenueUSD =
    financialsDailySnapshots.dailySupplySideRevenueUSD.plus(
      supplySideRevenueUSD
    );
  financialsDailySnapshots.dailyProtocolSideRevenueUSD =
    financialsDailySnapshots.dailyProtocolSideRevenueUSD.plus(
      protocolSideRevenueUSD
    );

  // financials daily - cumulative revenues
  financialsDailySnapshots.cumulativeTotalRevenueUSD =
    protocol.cumulativeTotalRevenueUSD;
  financialsDailySnapshots.cumulativeSupplySideRevenueUSD =
    protocol.cumulativeSupplySideRevenueUSD;
  financialsDailySnapshots.cumulativeProtocolSideRevenueUSD =
    protocol.cumulativeProtocolSideRevenueUSD;

  // market daily - daily revenues
  marketDailySnapshot.dailyTotalRevenueUSD =
    marketDailySnapshot.dailyTotalRevenueUSD.plus(totalRevenueUSD);
  marketDailySnapshot.dailySupplySideRevenueUSD =
    marketDailySnapshot.dailySupplySideRevenueUSD.plus(supplySideRevenueUSD);
  marketDailySnapshot.dailyProtocolSideRevenueUSD =
    marketDailySnapshot.dailyProtocolSideRevenueUSD.plus(
      protocolSideRevenueUSD
    );

  // market daily - cumulative revenues
  marketDailySnapshot.cumulativeTotalRevenueUSD =
    market.cumulativeTotalRevenueUSD;
  marketDailySnapshot.cumulativeSupplySideRevenueUSD =
    market.cumulativeSupplySideRevenueUSD;
  marketDailySnapshot.cumulativeProtocolSideRevenueUSD =
    market.cumulativeProtocolSideRevenueUSD;

  // market hourly - hourly revenues
  marketHourlySnapshot.hourlyTotalRevenueUSD =
    marketHourlySnapshot.hourlyTotalRevenueUSD.plus(totalRevenueUSD);
  marketHourlySnapshot.hourlySupplySideRevenueUSD =
    marketHourlySnapshot.hourlySupplySideRevenueUSD.plus(supplySideRevenueUSD);
  marketHourlySnapshot.hourlyProtocolSideRevenueUSD =
    marketHourlySnapshot.hourlyProtocolSideRevenueUSD.plus(
      protocolSideRevenueUSD
    );

  // market hourly - cumulative revenues
  marketHourlySnapshot.cumulativeTotalRevenueUSD =
    market.cumulativeTotalRevenueUSD;
  marketHourlySnapshot.cumulativeSupplySideRevenueUSD =
    market.cumulativeSupplySideRevenueUSD;
  marketHourlySnapshot.cumulativeProtocolSideRevenueUSD =
    market.cumulativeProtocolSideRevenueUSD;

  // cannot associate liquidation event with a market without maturity info
  financialsDailySnapshots.cumulativeLiquidateUSD =
    protocol.cumulativeLiquidateUSD;

  financialsDailySnapshots.save();
  marketDailySnapshot.save();
  marketHourlySnapshot.save();
  protocol.save();
}

export function updateTVLAndBalances(event: ethereum.Event): void {
  const protocol = getOrCreateLendingProtocol();
  const financialsDailySnapshot = getOrCreateFinancialsDailySnapshot(event);

  const currencyIds = [1, 2, 3, 4];
  const notional = Notional.bind(Address.fromString(PROTOCOL_ID));
  let protocolTotalValueLockedUSD = BIGDECIMAL_ZERO;

  for (let i = 0; i < currencyIds.length; i++) {
    const assetToken = getTokenFromCurrency(event, currencyIds[i].toString());
    const erc20 = ERC20.bind(Address.fromString(assetToken.id));

    const currencyAndRatesCallResult = notional.try_getCurrencyAndRates(
      currencyIds[i]
    );

    if (currencyAndRatesCallResult.reverted) {
      log.error("[updateTVLAndBalances] getCurrencyAndRates reverted", []);
    } else {
      const assetRateParams = currencyAndRatesCallResult.value.getAssetRate();
      const underlyingAssetToken = getOrCreateToken(
        currencyAndRatesCallResult.value.getUnderlyingToken().tokenAddress,
        event.block.number
      );

      const assetTokenBalance = erc20.balanceOf(
        Address.fromString(PROTOCOL_ID)
      );
      const underlyingAssetTokenBalance = bigIntToBigDecimal(
        assetRateParams.rate
          .times(assetTokenBalance)
          .div(BigInt.fromI32(10).pow(10))
          .div(assetRateParams.underlyingDecimals),
        8
      );

      protocolTotalValueLockedUSD = protocolTotalValueLockedUSD.plus(
        underlyingAssetTokenBalance.times(underlyingAssetToken.lastPriceUSD!)
      );
    }
  }

  let protocolTotalDepositBalanceUSD = BIGDECIMAL_ZERO;
  let protocolTotalBorrowBalanceUSD = BIGDECIMAL_ZERO;
  const activeMarkets = getMarketsWithStatus(event).activeMarkets;
  for (let i = 0; i < activeMarkets.length; i++) {
    const market = getOrCreateMarket(event, activeMarkets[i]);
    protocolTotalDepositBalanceUSD = protocolTotalDepositBalanceUSD.plus(
      market.totalDepositBalanceUSD
    );
    protocolTotalBorrowBalanceUSD = protocolTotalBorrowBalanceUSD.plus(
      market.totalBorrowBalanceUSD
    );
  }

  financialsDailySnapshot.totalValueLockedUSD = protocolTotalValueLockedUSD;
  protocol.totalValueLockedUSD = protocolTotalValueLockedUSD;

  financialsDailySnapshot.totalDepositBalanceUSD =
    protocolTotalDepositBalanceUSD;
  protocol.totalDepositBalanceUSD = protocolTotalDepositBalanceUSD;

  financialsDailySnapshot.totalBorrowBalanceUSD = protocolTotalBorrowBalanceUSD;
  protocol.totalBorrowBalanceUSD = protocolTotalBorrowBalanceUSD;

  financialsDailySnapshot.blockNumber = event.block.number;
  financialsDailySnapshot.timestamp = event.block.timestamp;

  financialsDailySnapshot.save();
  protocol.save();
}

export function updateMarket(
  marketId: string,
  transactionType: string,
  cTokenAmount: BigInt,
  amountUSD: BigDecimal,
  event: ethereum.Event
): void {
  const market = getOrCreateMarket(event, marketId);
  const protocol = getOrCreateLendingProtocol();

  const marketHourlySnapshot = getOrCreateMarketHourlySnapshot(
    event,
    market.id
  );
  const marketDailySnapshot = getOrCreateMarketDailySnapshot(event, market.id);
  const financialsDailySnapshot = getOrCreateFinancialsDailySnapshot(event);

  // amount in USD
  const amount = cTokenAmount;
  const token = getOrCreateToken(
    Address.fromString(market.inputToken),
    event.block.number
  );
  const priceUSD = token.lastPriceUSD!;

  // last updated block number and timestamp
  marketHourlySnapshot.blockNumber = event.block.number;
  marketHourlySnapshot.timestamp = event.block.timestamp;
  marketDailySnapshot.blockNumber = event.block.number;
  marketDailySnapshot.timestamp = event.block.timestamp;
  financialsDailySnapshot.blockNumber = event.block.number;
  financialsDailySnapshot.timestamp = event.block.timestamp;

  if (transactionType == TransactionType.DEPOSIT) {
    // tvl in market
    const inputTokenBalance = market.inputTokenBalance.plus(amount);
    market.inputTokenBalance = inputTokenBalance;
    market.totalValueLockedUSD = bigIntToBigDecimal(
      inputTokenBalance,
      token.decimals
    ).times(priceUSD);

    // update total deposit amount
    market.totalDepositBalanceUSD = bigIntToBigDecimal(
      inputTokenBalance,
      token.decimals
    ).times(priceUSD);

    // update deposit amounts
    market.cumulativeDepositUSD = market.cumulativeDepositUSD.plus(amountUSD);
    marketHourlySnapshot.cumulativeDepositUSD =
      marketHourlySnapshot.cumulativeDepositUSD.plus(amountUSD);
    marketDailySnapshot.cumulativeDepositUSD =
      marketDailySnapshot.cumulativeDepositUSD.plus(amountUSD);
    financialsDailySnapshot.cumulativeDepositUSD =
      financialsDailySnapshot.cumulativeDepositUSD.plus(amountUSD);
    protocol.cumulativeDepositUSD =
      protocol.cumulativeDepositUSD.plus(amountUSD);
    marketHourlySnapshot.hourlyDepositUSD =
      marketHourlySnapshot.hourlyDepositUSD.plus(amountUSD);
    marketDailySnapshot.dailyDepositUSD =
      marketDailySnapshot.dailyDepositUSD.plus(amountUSD);
    financialsDailySnapshot.dailyDepositUSD =
      financialsDailySnapshot.dailyDepositUSD.plus(amountUSD);
  } else if (transactionType == TransactionType.WITHDRAW) {
    // tvl in market
    const inputTokenBalance = market.inputTokenBalance.minus(amount);
    market.inputTokenBalance = inputTokenBalance;
    market.totalValueLockedUSD = bigIntToBigDecimal(
      inputTokenBalance,
      token.decimals
    ).times(priceUSD);

    // update total deposit amount
    market.totalDepositBalanceUSD = bigIntToBigDecimal(
      inputTokenBalance,
      token.decimals
    ).times(priceUSD);

    // update withdraw amounts
    marketDailySnapshot.dailyWithdrawUSD =
      marketDailySnapshot.dailyWithdrawUSD.plus(amountUSD);
    financialsDailySnapshot.dailyWithdrawUSD =
      financialsDailySnapshot.dailyWithdrawUSD.plus(amountUSD);
  } else if (transactionType == TransactionType.BORROW) {
    // update total borrow amount
    // take add/sub approach since we don't have fCash supply info available
    market.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD.plus(amountUSD);

    // update borrow amounts
    market.cumulativeBorrowUSD = market.cumulativeBorrowUSD.plus(amountUSD);
    marketHourlySnapshot.cumulativeBorrowUSD =
      marketHourlySnapshot.cumulativeBorrowUSD.plus(amountUSD);
    marketDailySnapshot.cumulativeBorrowUSD =
      marketDailySnapshot.cumulativeBorrowUSD.plus(amountUSD);
    financialsDailySnapshot.cumulativeBorrowUSD =
      financialsDailySnapshot.cumulativeBorrowUSD.plus(amountUSD);
    protocol.cumulativeBorrowUSD = protocol.cumulativeBorrowUSD.plus(amountUSD);
    marketHourlySnapshot.hourlyBorrowUSD =
      marketHourlySnapshot.hourlyBorrowUSD.plus(amountUSD);
    marketDailySnapshot.dailyBorrowUSD =
      marketDailySnapshot.dailyBorrowUSD.plus(amountUSD);
    financialsDailySnapshot.dailyBorrowUSD =
      financialsDailySnapshot.dailyBorrowUSD.plus(amountUSD);
  } else if (transactionType == TransactionType.REPAY) {
    // update total borrow amount
    // take add/sub approach since we don't have fCash supply info available
    market.totalBorrowBalanceUSD =
      market.totalBorrowBalanceUSD.minus(amountUSD);

    // update repay amounts
    marketDailySnapshot.dailyRepayUSD =
      marketDailySnapshot.dailyRepayUSD.plus(amountUSD);
    financialsDailySnapshot.dailyRepayUSD =
      financialsDailySnapshot.dailyRepayUSD.plus(amountUSD);
  }

  // requires market and protocol to be udpated before snapshots
  market.save();
  protocol.save();
  financialsDailySnapshot.save();

  // update hourly snapshot
  marketHourlySnapshot.protocol = protocol.id;
  marketHourlySnapshot.market = market.id;
  marketHourlySnapshot.rates = market.rates;
  marketHourlySnapshot.totalValueLockedUSD = market.totalValueLockedUSD;
  marketHourlySnapshot.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  marketHourlySnapshot.cumulativeDepositUSD = market.cumulativeDepositUSD;
  marketHourlySnapshot.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  marketHourlySnapshot.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  marketHourlySnapshot.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  marketHourlySnapshot.inputTokenBalance = market.inputTokenBalance;
  marketHourlySnapshot.inputTokenPriceUSD = market.inputTokenPriceUSD;
  marketHourlySnapshot.outputTokenSupply = market.outputTokenSupply;
  marketHourlySnapshot.outputTokenPriceUSD = market.outputTokenPriceUSD;
  marketHourlySnapshot.blockNumber = event.block.number;
  marketHourlySnapshot.timestamp = event.block.timestamp;

  // update daily snapshot
  marketDailySnapshot.protocol = protocol.id;
  marketDailySnapshot.market = market.id;
  marketDailySnapshot.rates = market.rates;
  marketDailySnapshot.totalValueLockedUSD = market.totalValueLockedUSD;
  marketDailySnapshot.totalDepositBalanceUSD = market.totalDepositBalanceUSD;
  marketDailySnapshot.cumulativeDepositUSD = market.cumulativeDepositUSD;
  marketDailySnapshot.totalBorrowBalanceUSD = market.totalBorrowBalanceUSD;
  marketDailySnapshot.cumulativeBorrowUSD = market.cumulativeBorrowUSD;
  marketDailySnapshot.cumulativeLiquidateUSD = market.cumulativeLiquidateUSD;
  marketDailySnapshot.inputTokenBalance = market.inputTokenBalance;
  marketDailySnapshot.inputTokenPriceUSD = market.inputTokenPriceUSD;
  marketDailySnapshot.outputTokenSupply = market.outputTokenSupply;
  marketDailySnapshot.outputTokenPriceUSD = market.outputTokenPriceUSD;
  marketDailySnapshot.blockNumber = event.block.number;
  marketDailySnapshot.timestamp = event.block.timestamp;

  marketHourlySnapshot.save();
  marketDailySnapshot.save();
}
