import { Address, BigDecimal, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { NetworkConfigs } from "../../../../configurations/configure";
import {
  Account,
  ActiveAccount,
  DexAmmProtocol,
  LiquidityPool,
  Token,
  _HelperStore,
} from "../../../../generated/schema";
import {
  BIGDECIMAL_ZERO,
  BIGINT_ZERO,
  DEFAULT_DECIMALS,
  INT_ONE,
  INT_TWO,
  INT_ZERO,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
  UsageType,
} from "./constants";
import {
  getLiquidityPool,
  getLiquidityPoolAmounts,
  getLiquidityPoolFee,
  getOrCreateFinancialsDailySnapshot,
  getOrCreateLiquidityPoolDailySnapshot,
  getOrCreateLiquidityPoolHourlySnapshot,
  getOrCreateProtocol,
  getOrCreateToken,
  getOrCreateTokenWhitelist,
  getOrCreateUsageMetricDailySnapshot,
  getOrCreateUsageMetricHourlySnapshot,
} from "./getters";
import { convertTokenToDecimal, percToDec } from "./utils/utils";

// Update FinancialsDailySnapshots entity
// Updated on Swap, Burn, and Mint events.
export function updateFinancials(event: ethereum.Event): void {
  const financialMetricsDaily = getOrCreateFinancialsDailySnapshot(event);

  const protocol = getOrCreateProtocol();

  // Update the block number and timestamp to that of the last transaction of that day
  financialMetricsDaily.blockNumber = event.block.number;
  financialMetricsDaily.timestamp = event.block.timestamp;
  financialMetricsDaily.totalValueLockedUSD = protocol.totalValueLockedUSD;
  financialMetricsDaily.cumulativeVolumeUSD = protocol.cumulativeVolumeUSD;

  financialMetricsDaily.save();
}

// Update usage metrics entities
// Updated on Swap, Burn, and Mint events.
export function updateUsageMetrics(
  event: ethereum.Event,
  fromAddress: Address,
  usageType: string
): void {
  const from = fromAddress.toHexString();

  const usageMetricsDaily = getOrCreateUsageMetricDailySnapshot(event);
  const usageMetricsHourly = getOrCreateUsageMetricHourlySnapshot(event);

  const protocol = getOrCreateProtocol();

  // Update the block number and timestamp to that of the last transaction of that day
  usageMetricsDaily.blockNumber = event.block.number;
  usageMetricsDaily.timestamp = event.block.timestamp;
  usageMetricsDaily.dailyTransactionCount += INT_ONE;

  usageMetricsHourly.blockNumber = event.block.number;
  usageMetricsHourly.timestamp = event.block.timestamp;
  usageMetricsHourly.hourlyTransactionCount += INT_ONE;

  if (usageType == UsageType.DEPOSIT) {
    usageMetricsDaily.dailyDepositCount += INT_ONE;
    usageMetricsHourly.hourlyDepositCount += INT_ONE;
  } else if (usageType == UsageType.WITHDRAW) {
    usageMetricsDaily.dailyWithdrawCount += INT_ONE;
    usageMetricsHourly.hourlyWithdrawCount += INT_ONE;
  } else if (usageType == UsageType.SWAP) {
    usageMetricsDaily.dailySwapCount += INT_ONE;
    usageMetricsHourly.hourlySwapCount += INT_ONE;
  }

  // Number of days since Unix epoch
  const day = event.block.timestamp.toI32() / SECONDS_PER_DAY;
  const hour = event.block.timestamp.toI32() / SECONDS_PER_HOUR;

  const dayId = day.toString();
  const hourId = hour.toString();

  // Combine the id and the user address to generate a unique user id for the day
  const dailyActiveAccountId = from.concat("-").concat(dayId);
  let dailyActiveAccount = ActiveAccount.load(dailyActiveAccountId);
  if (!dailyActiveAccount) {
    dailyActiveAccount = new ActiveAccount(dailyActiveAccountId);
    usageMetricsDaily.dailyActiveUsers += INT_ONE;
    dailyActiveAccount.save();
  }

  const hourlyActiveAccountId = from.concat("-").concat(hourId);
  let hourlyActiveAccount = ActiveAccount.load(hourlyActiveAccountId);
  if (!hourlyActiveAccount) {
    hourlyActiveAccount = new ActiveAccount(hourlyActiveAccountId);
    usageMetricsHourly.hourlyActiveUsers += INT_ONE;
    hourlyActiveAccount.save();
  }

  let account = Account.load(from);
  if (!account) {
    account = new Account(from);
    protocol.cumulativeUniqueUsers += INT_ONE;
    account.save();
  }
  usageMetricsDaily.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
  usageMetricsHourly.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;

  usageMetricsDaily.save();
  usageMetricsHourly.save();
  protocol.save();
}

// Update UsagePoolDailySnapshot entity
// Updated on Swap, Burn, and Mint events.
export function updatePoolMetrics(event: ethereum.Event): void {
  // get or create pool metrics
  const poolMetricsDaily = getOrCreateLiquidityPoolDailySnapshot(event);
  const poolMetricsHourly = getOrCreateLiquidityPoolHourlySnapshot(event);

  const pool = getLiquidityPool(event.address.toHexString());

  // Update the block number and timestamp to that of the last transaction of that day
  poolMetricsDaily.totalValueLockedUSD = pool.totalValueLockedUSD;
  poolMetricsDaily.cumulativeVolumeUSD = pool.cumulativeVolumeUSD;
  poolMetricsDaily.inputTokenBalances = pool.inputTokenBalances;
  poolMetricsDaily.inputTokenWeights = pool.inputTokenWeights;
  poolMetricsDaily.outputTokenSupply = pool.outputTokenSupply;
  poolMetricsDaily.outputTokenPriceUSD = pool.outputTokenPriceUSD;
  poolMetricsDaily.blockNumber = event.block.number;
  poolMetricsDaily.timestamp = event.block.timestamp;
  poolMetricsDaily.rewardTokenEmissionsAmount = pool.rewardTokenEmissionsAmount;
  poolMetricsDaily.rewardTokenEmissionsUSD = pool.rewardTokenEmissionsUSD;
  poolMetricsDaily.stakedOutputTokenAmount = pool.stakedOutputTokenAmount;
  poolMetricsDaily.cumulativeTotalRevenueUSD = pool.cumulativeTotalRevenueUSD;
  poolMetricsDaily.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  poolMetricsDaily.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;

  poolMetricsHourly.totalValueLockedUSD = pool.totalValueLockedUSD;
  poolMetricsHourly.cumulativeVolumeUSD = pool.cumulativeVolumeUSD;
  poolMetricsHourly.inputTokenBalances = pool.inputTokenBalances;
  poolMetricsHourly.inputTokenWeights = pool.inputTokenWeights;
  poolMetricsHourly.outputTokenSupply = pool.outputTokenSupply;
  poolMetricsHourly.outputTokenPriceUSD = pool.outputTokenPriceUSD;
  poolMetricsHourly.blockNumber = event.block.number;
  poolMetricsHourly.timestamp = event.block.timestamp;
  poolMetricsHourly.rewardTokenEmissionsAmount =
    pool.rewardTokenEmissionsAmount;
  poolMetricsHourly.rewardTokenEmissionsUSD = pool.rewardTokenEmissionsUSD;
  poolMetricsHourly.stakedOutputTokenAmount = pool.stakedOutputTokenAmount;
  poolMetricsHourly.cumulativeTotalRevenueUSD = pool.cumulativeTotalRevenueUSD;
  poolMetricsHourly.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  poolMetricsHourly.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;

  poolMetricsDaily.save();
  poolMetricsHourly.save();
}

// These whiteslists are used to track what pools the tokens are a part of. Used in price calculations.
// Updated at the time of pool created (poolCreated event)
export function updateTokenWhitelists(
  token0: Token,
  token1: Token,
  poolAddress: string
): void {
  const tokenWhitelist0 = getOrCreateTokenWhitelist(token0.id);
  const tokenWhitelist1 = getOrCreateTokenWhitelist(token1.id);

  // update white listed pools
  if (NetworkConfigs.getWhitelistTokens().includes(tokenWhitelist0.id)) {
    const newPools = tokenWhitelist1.whitelistPools;
    newPools.push(poolAddress);
    tokenWhitelist1.whitelistPools = newPools;
    tokenWhitelist1.save();
  }

  if (NetworkConfigs.getWhitelistTokens().includes(tokenWhitelist1.id)) {
    const newPools = tokenWhitelist0.whitelistPools;
    newPools.push(poolAddress);
    tokenWhitelist0.whitelistPools = newPools;
    tokenWhitelist0.save();
  }
}

// Upate token balances based on reserves emitted from the Sync event.
export function updateInputTokenBalances(
  event: ethereum.Event,
  poolAddress: string,
  reserve0: BigInt,
  reserve1: BigInt
): void {
  const pool = getLiquidityPool(poolAddress);
  const poolAmounts = getLiquidityPoolAmounts(poolAddress);

  const token0 = getOrCreateToken(event, pool.inputTokens[INT_ZERO]);
  const token1 = getOrCreateToken(event, pool.inputTokens[INT_ONE]);

  const tokenDecimal0 = convertTokenToDecimal(reserve0, token0.decimals);
  const tokenDecimal1 = convertTokenToDecimal(reserve1, token1.decimals);

  poolAmounts.inputTokenBalances = [tokenDecimal0, tokenDecimal1];
  pool.inputTokenBalances = [reserve0, reserve1];

  poolAmounts.save();
  pool.save();
}

// Update tvl an token prices in the Sync event.
export function updateTvlAndTokenPrices(
  event: ethereum.Event,
  poolAddress: string
): void {
  const pool = getLiquidityPool(poolAddress);

  const protocol = getOrCreateProtocol();

  const token0 = getOrCreateToken(event, pool.inputTokens[0]);
  const token1 = getOrCreateToken(event, pool.inputTokens[1]);

  // Subtract the old pool tvl
  protocol.totalValueLockedUSD = protocol.totalValueLockedUSD.minus(
    pool.totalValueLockedUSD
  );

  const inputToken0 = convertTokenToDecimal(
    pool.inputTokenBalances[0],
    token0.decimals
  );
  const inputToken1 = convertTokenToDecimal(
    pool.inputTokenBalances[1],
    token1.decimals
  );

  // Get new tvl
  const newTvl = token0
    .lastPriceUSD!.times(inputToken0)
    .plus(token1.lastPriceUSD!.times(inputToken1));

  // Add the new pool tvl
  pool.totalValueLockedUSD = newTvl;
  protocol.totalValueLockedUSD = protocol.totalValueLockedUSD.plus(newTvl);

  const outputTokenSupply = convertTokenToDecimal(
    pool.outputTokenSupply!,
    DEFAULT_DECIMALS
  );

  // Update LP token prices
  if (pool.outputTokenSupply! == BIGINT_ZERO) {
    pool.outputTokenPriceUSD = BIGDECIMAL_ZERO;
  } else {
    pool.outputTokenPriceUSD = newTvl.div(outputTokenSupply);
  }

  pool.save();
  protocol.save();
  token0.save();
  token1.save();
}

// Update the volume and fees from financial metrics snapshot, pool metrics snapshot, protocol, and pool entities.
// Updated on Swap event.
export function updateVolumeAndFees(
  event: ethereum.Event,
  protocol: DexAmmProtocol,
  pool: LiquidityPool,
  trackedAmountUSD: BigDecimal[],
  inTokenIndex: i32,
  token0Amount: BigInt,
  token1Amount: BigInt
): void {
  const financialMetrics = getOrCreateFinancialsDailySnapshot(event);
  const poolMetricsDaily = getOrCreateLiquidityPoolDailySnapshot(event);
  const poolMetricsHourly = getOrCreateLiquidityPoolHourlySnapshot(event);

  // Append token index to pool fees to handle directional fees
  const supplyFee = getLiquidityPoolFee(
    pool.fees[INT_ZERO].concat(`-${inTokenIndex}`)
  );
  const protocolFee = getLiquidityPoolFee(
    pool.fees[INT_ONE].concat(`-${inTokenIndex}`)
  );

  // Update volume occurred during swaps
  poolMetricsDaily.dailyVolumeByTokenUSD = [
    poolMetricsDaily.dailyVolumeByTokenUSD[INT_ZERO].plus(
      trackedAmountUSD[INT_ZERO]
    ),
    poolMetricsDaily.dailyVolumeByTokenUSD[INT_ONE].plus(
      trackedAmountUSD[INT_ONE]
    ),
  ];
  poolMetricsDaily.dailyVolumeByTokenAmount = [
    poolMetricsDaily.dailyVolumeByTokenAmount[INT_ZERO].plus(token0Amount),
    poolMetricsDaily.dailyVolumeByTokenAmount[INT_ONE].plus(token1Amount),
  ];
  poolMetricsHourly.hourlyVolumeByTokenUSD = [
    poolMetricsHourly.hourlyVolumeByTokenUSD[INT_ZERO].plus(
      trackedAmountUSD[INT_ZERO]
    ),
    poolMetricsHourly.hourlyVolumeByTokenUSD[INT_ONE].plus(
      trackedAmountUSD[INT_ONE]
    ),
  ];
  poolMetricsHourly.hourlyVolumeByTokenAmount = [
    poolMetricsHourly.hourlyVolumeByTokenAmount[INT_ZERO].plus(token0Amount),
    poolMetricsHourly.hourlyVolumeByTokenAmount[INT_ONE].plus(token1Amount),
  ];

  poolMetricsDaily.dailyVolumeUSD = poolMetricsDaily.dailyVolumeUSD.plus(
    trackedAmountUSD[INT_TWO]
  );
  poolMetricsHourly.hourlyVolumeUSD = poolMetricsHourly.hourlyVolumeUSD.plus(
    trackedAmountUSD[INT_TWO]
  );

  financialMetrics.dailyVolumeUSD = financialMetrics.dailyVolumeUSD.plus(
    trackedAmountUSD[INT_TWO]
  );
  pool.cumulativeVolumeUSD = pool.cumulativeVolumeUSD.plus(
    trackedAmountUSD[INT_TWO]
  );
  protocol.cumulativeVolumeUSD = protocol.cumulativeVolumeUSD.plus(
    trackedAmountUSD[INT_TWO]
  );

  const supplyFeeAmountUSD = trackedAmountUSD[inTokenIndex].times(
    percToDec(supplyFee.feePercentage!)
  );
  const protocolFeeAmountUSD = trackedAmountUSD[inTokenIndex].times(
    percToDec(protocolFee.feePercentage!)
  );
  const tradingFeeAmountUSD = supplyFeeAmountUSD.plus(protocolFeeAmountUSD);

  // Update fees collected during swaps
  // Protocol
  protocol.cumulativeTotalRevenueUSD =
    protocol.cumulativeTotalRevenueUSD.plus(tradingFeeAmountUSD);
  protocol.cumulativeSupplySideRevenueUSD =
    protocol.cumulativeSupplySideRevenueUSD.plus(supplyFeeAmountUSD);
  protocol.cumulativeProtocolSideRevenueUSD =
    protocol.cumulativeProtocolSideRevenueUSD.plus(protocolFeeAmountUSD);

  // Pool
  pool.cumulativeTotalRevenueUSD =
    pool.cumulativeTotalRevenueUSD.plus(tradingFeeAmountUSD);
  pool.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD.plus(supplyFeeAmountUSD);
  pool.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD.plus(protocolFeeAmountUSD);

  // Daily Financials
  financialMetrics.dailyTotalRevenueUSD =
    financialMetrics.dailyTotalRevenueUSD.plus(tradingFeeAmountUSD);
  financialMetrics.dailySupplySideRevenueUSD =
    financialMetrics.dailySupplySideRevenueUSD.plus(supplyFeeAmountUSD);
  financialMetrics.dailyProtocolSideRevenueUSD =
    financialMetrics.dailyProtocolSideRevenueUSD.plus(protocolFeeAmountUSD);

  financialMetrics.cumulativeTotalRevenueUSD =
    protocol.cumulativeTotalRevenueUSD;
  financialMetrics.cumulativeSupplySideRevenueUSD =
    protocol.cumulativeSupplySideRevenueUSD;
  financialMetrics.cumulativeProtocolSideRevenueUSD =
    protocol.cumulativeProtocolSideRevenueUSD;

  // Daily Pool Metrics
  poolMetricsDaily.dailyTotalRevenueUSD =
    poolMetricsDaily.dailyTotalRevenueUSD.plus(tradingFeeAmountUSD);
  poolMetricsDaily.dailySupplySideRevenueUSD =
    poolMetricsDaily.dailySupplySideRevenueUSD.plus(supplyFeeAmountUSD);
  poolMetricsDaily.dailyProtocolSideRevenueUSD =
    poolMetricsDaily.dailyProtocolSideRevenueUSD.plus(protocolFeeAmountUSD);

  poolMetricsDaily.cumulativeTotalRevenueUSD = pool.cumulativeTotalRevenueUSD;
  poolMetricsDaily.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  poolMetricsDaily.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;

  // Hourly Pool Metrics
  poolMetricsHourly.hourlyTotalRevenueUSD =
    poolMetricsHourly.hourlyTotalRevenueUSD.plus(tradingFeeAmountUSD);
  poolMetricsHourly.hourlySupplySideRevenueUSD =
    poolMetricsHourly.hourlySupplySideRevenueUSD.plus(supplyFeeAmountUSD);
  poolMetricsHourly.hourlyProtocolSideRevenueUSD =
    poolMetricsHourly.hourlyProtocolSideRevenueUSD.plus(protocolFeeAmountUSD);

  poolMetricsHourly.cumulativeTotalRevenueUSD = pool.cumulativeTotalRevenueUSD;
  poolMetricsHourly.cumulativeSupplySideRevenueUSD =
    pool.cumulativeSupplySideRevenueUSD;
  poolMetricsHourly.cumulativeProtocolSideRevenueUSD =
    pool.cumulativeProtocolSideRevenueUSD;

  financialMetrics.save();
  poolMetricsDaily.save();
  poolMetricsHourly.save();
  protocol.save();
  pool.save();
}

// Update store that tracks the deposit count per pool
export function updateDepositHelper(poolAddress: Address): void {
  const poolDeposits = _HelperStore.load(poolAddress.toHexString())!;
  poolDeposits.valueInt = poolDeposits.valueInt + INT_ONE;
  poolDeposits.save();
}
