
const CurveAMM = require('../../utils/curve_amm');
const { absoluteValue } = require('./utils');



/**
 * Simulate sell transaction analysis
 * @param {string} mint - Token address
 * @param {bigint|string|number} sellTokenAmount - Token amount to sell (u64 format, precision 10^6)
 * @returns {Promise<Object>} Sell analysis result
 */
async function simulateSell(mint, sellTokenAmount) {
    try {
        // 1. Parameter validation
        if (!mint || typeof mint !== 'string') {
            return {
                success: false,
                errorCode: 'PARAM_ERROR',
                errorMessage: 'Token address must be a valid string',
                data: null
            };
        }

        if (sellTokenAmount === undefined || sellTokenAmount === null) {
            return {
                success: false,
                errorCode: 'PARAM_ERROR',
                errorMessage: 'Sell token amount cannot be empty',
                data: null
            };
        }

        // Convert to bigint
        let sellTokenAmountU64;
        try {
            sellTokenAmountU64 = typeof sellTokenAmount === 'bigint' ? sellTokenAmount : BigInt(sellTokenAmount);
            if (sellTokenAmountU64 <= 0n) {
                throw new Error('Amount must be greater than 0');
            }
        } catch (error) {
            return {
                success: false,
                errorCode: 'PARAM_ERROR',
                errorMessage: `Invalid token amount: ${error.message}`,
                data: null
            };
        }


        let currentPriceU64;
        try {
            const priceString = await this.sdk.data.price(mint);
            currentPriceU64 = BigInt(priceString);
        } catch (error) {
            return {
                success: false,
                errorCode: 'API_ERROR',
                errorMessage: `Failed to get price info: ${error.message}`,
                data: null
            };
        }

        // Get long order list (down_orders)
        let ordersData;
        try {
            ordersData = await this.sdk.data.orders(mint, {
                type: 'down_orders',
                limit: 500
            });
            if (!ordersData.success) {
                return {
                    success: false,
                    errorCode: 'API_ERROR',
                    errorMessage: 'Cannot get long order data',
                    data: null
                };
            }
        } catch (error) {
            return {
                success: false,
                errorCode: 'API_ERROR',
                errorMessage: `Failed to get order data: ${error.message}`,
                data: null
            };
        }

        // Convert order data format
        const longOrderList = ordersData.data.orders.map(order => ({
            ...order,
            lockLpStartPrice: order.lock_lp_start_price,
            lockLpEndPrice: order.lock_lp_end_price,
            lockLpSolAmount: BigInt(order.lock_lp_sol_amount),
            lockLpTokenAmount: BigInt(order.lock_lp_token_amount)
        }));

        // If no orders, add null to represent no limit
        if (longOrderList.length === 0) {
            longOrderList.push(null);
        }

        // Start AMM calculation
        // Calculate ideal SOL amount without slippage
        const idealTradeResult = CurveAMM.sellFromPriceWithTokenInput(currentPriceU64, sellTokenAmountU64);
        let idealSolAmount = 0n;
        if (idealTradeResult) {
            idealSolAmount = idealTradeResult[1];
        }
        const idealTokenAmount = sellTokenAmountU64;

        // Initialize price range and liquidity related variables
        let totalPriceSpan = 0n;
        let totalLiquiditySolAmount = 0n;
        let totalLiquidityTokenAmount = 0n;
        let targetReachedAtSegmentIndex = -1;
        let minAllowedPrice = 0n;

        // Build price segment analysis list
        const priceSegmentAnalysisList = new Array(longOrderList.length);

        // Iterate orders and calculate parameters for each price segment
        for (let segmentIndex = 0; segmentIndex < longOrderList.length; segmentIndex++) {
            let segmentStartPrice, segmentEndPrice;

            // Determine start and end prices based on segment position
            if (segmentIndex === 0) {
                // First segment: start from current price (sell downward)
                segmentStartPrice = currentPriceU64;

                if (longOrderList[0] === null) {
                    // If first order is null, no orders exist
                    segmentEndPrice = CurveAMM.MIN_U128_PRICE; // Minimum price
                    minAllowedPrice = CurveAMM.MIN_U128_PRICE; // Unrestricted to minimum price
                } else {
                    // To one unit before first order start price
                    segmentEndPrice = BigInt(longOrderList[0].lockLpStartPrice);
                    minAllowedPrice = BigInt(longOrderList[0].lockLpStartPrice);
                }
            } else if (longOrderList[segmentIndex] === null) {
                // Current iteration reaches null (chain ends)
                segmentStartPrice = BigInt(longOrderList[segmentIndex - 1].lockLpEndPrice);
                segmentEndPrice = CurveAMM.MIN_U128_PRICE; // To minimum price
            } else {
                // Normal case: gap between two orders
                segmentStartPrice = BigInt(longOrderList[segmentIndex - 1].lockLpEndPrice);
                segmentEndPrice = BigInt(longOrderList[segmentIndex].lockLpStartPrice);
            }

            // Validate price segment validity
            if (segmentStartPrice < segmentEndPrice) {
                // Invalid price segment, skip (for sell, start price should be higher than end price)
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    obtainedSolAmount: null,
                    consumedTokenAmount: null,
                    isValid: false
                };
                continue;
            }

            if (segmentStartPrice === segmentEndPrice) {
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    obtainedSolAmount: 0n,
                    consumedTokenAmount: 0n,
                    isValid: true
                };
                continue;
            }

            // Use AMM to calculate transaction parameters for this segment (sell: from high to low price)
            const segmentTradeResult = CurveAMM.sellFromPriceToPrice(segmentStartPrice, segmentEndPrice);

            if (!segmentTradeResult) {
                // AMM calculation failed
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    obtainedSolAmount: null,
                    consumedTokenAmount: null,
                    isValid: false
                };
            } else {
                // Calculation successful, save result
                const [consumedTokenAmount, obtainedSolAmount] = segmentTradeResult;
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    obtainedSolAmount,
                    consumedTokenAmount,
                    isValid: true
                };
            }
        }

        // Accumulate total liquidity depth
        for (let i = 0; i < priceSegmentAnalysisList.length; i++) {
            const segment = priceSegmentAnalysisList[i];

            if (segment.isValid && segment.obtainedSolAmount !== null && segment.consumedTokenAmount !== null) {
                totalLiquiditySolAmount += BigInt(segment.obtainedSolAmount);
                totalLiquidityTokenAmount += BigInt(segment.consumedTokenAmount);

                // Token input: check if cumulative token amount has reached target
                if (totalLiquidityTokenAmount >= sellTokenAmountU64 && targetReachedAtSegmentIndex === -1) {
                    targetReachedAtSegmentIndex = i;
                }
            }
        }

        // Calculate actual transaction parameters
        let actualObtainedSolAmount = 0n;
        let actualConsumedTokenAmount = 0n;
        let transactionCompletionRate = 0.0;

        if (targetReachedAtSegmentIndex !== -1) {
            // Can complete 100% of transaction
            transactionCompletionRate = 100.0;

            for (let i = 0; i <= targetReachedAtSegmentIndex; i++) {
                const currentSegment = priceSegmentAnalysisList[i];

                if (i === targetReachedAtSegmentIndex) {
                    // Last segment: may only need partial transaction
                    // Token input: calculate remaining token to sell
                    const remainingTokenToSell = sellTokenAmountU64 - actualConsumedTokenAmount;
                    const partialTradeResult = CurveAMM.sellFromPriceWithTokenInput(
                        currentSegment.startPrice,
                        remainingTokenToSell
                    );

                    if (partialTradeResult) {
                        const [finalPrice, obtainedSolForPartial] = partialTradeResult;
                        actualObtainedSolAmount += obtainedSolForPartial;
                        actualConsumedTokenAmount += remainingTokenToSell;
                        totalPriceSpan += absoluteValue(currentSegment.startPrice - finalPrice) + 1n;
                    }
                } else {
                    // Use this segment completely
                    actualObtainedSolAmount += currentSegment.obtainedSolAmount;
                    actualConsumedTokenAmount += currentSegment.consumedTokenAmount;
                    totalPriceSpan += absoluteValue(currentSegment.startPrice - currentSegment.endPrice) + 1n;
                }
            }
        } else {
            // Cannot complete transaction fully, use all available liquidity
            for (let i = 0; i < priceSegmentAnalysisList.length; i++) {
                const segment = priceSegmentAnalysisList[i];
                if (segment.isValid) {
                    actualObtainedSolAmount += segment.obtainedSolAmount;
                    actualConsumedTokenAmount += segment.consumedTokenAmount;
                    totalPriceSpan += absoluteValue(segment.startPrice - segment.endPrice) + 1n;
                }
            }

            // Calculate transaction completion rate
            if (sellTokenAmountU64 > 0n) {
                transactionCompletionRate = parseFloat(
                    CurveAMM.u64ToTokenDecimal(actualConsumedTokenAmount)
                        .div(CurveAMM.u64ToTokenDecimal(sellTokenAmountU64))
                        .mul(100)
                        .toFixed(2)
                );
            }

            // Recalculate theoretical parameters (based on actual obtainable amount)
            const theoreticalTradeResult = CurveAMM.sellFromPriceWithTokenInput(currentPriceU64, actualConsumedTokenAmount);
            if (theoreticalTradeResult) {
                const [, theoreticalSolObtained] = theoreticalTradeResult;
                // Update theoretical SOL amount
            }
        }

        // Calculate minimum slippage percentage
        const minimumSlippagePercentage = Math.abs(
            100.0 * (
                CurveAMM.u64ToSolDecimal(idealSolAmount)
                    .minus(CurveAMM.u64ToSolDecimal(actualObtainedSolAmount))
                    .div(CurveAMM.u64ToSolDecimal(idealSolAmount))
                    .toNumber()
            )
        );

        // Return analysis result
        return {
            success: true,
            errorCode: null,
            errorMessage: null,
            data: {
                inputType: 'token',
                inputAmount: sellTokenAmountU64,
                minAllowedPrice: minAllowedPrice,
                totalPriceSpan: totalPriceSpan,
                transactionCompletionRate: transactionCompletionRate,
                idealSolAmount: idealSolAmount,
                idealTokenAmount: idealTokenAmount,
                actualObtainedSolAmount: actualObtainedSolAmount,
                actualConsumedTokenAmount: actualConsumedTokenAmount,
                theoreticalSolAmount: idealSolAmount,
                minimumSlippagePercentage: minimumSlippagePercentage,
                totalLiquiditySolAmount: totalLiquiditySolAmount,
                totalLiquidityTokenAmount: totalLiquidityTokenAmount
            }
        };

    } catch (error) {
        return {
            success: false,
            errorCode: 'DATA_ERROR',
            errorMessage: `Error during calculation: ${error.message}`,
            data: null
        };
    }
}


module.exports = {
    simulateSell
};