

const CurveAMM = require('../../utils/curve_amm');
const { convertApiOrdersFormat, absoluteValue } = require('./utils');

/**
 * Simulate buy transaction analysis
 * @param {string} mint - Token address
 * @param {bigint|string|number} buySolAmount - SOL amount to buy (u64 format, precision 10^9)
 * @returns {Promise<Object>} Buy analysis result
 */
async function simulateBuy(mint, buySolAmount) {
    // Initialize return result
    const result = {
        success: false,
        errorCode: null,
        errorMessage: null,
        data: null
    };

    try {
        // Parameter validation
        if (!mint || typeof mint !== 'string') {
            result.errorCode = 'PARAM_ERROR';
            result.errorMessage = 'Invalid mint parameter';
            return result;
        }

        if (buySolAmount === undefined || buySolAmount === null || buySolAmount <= 0) {
            result.errorCode = 'PARAM_ERROR';
            result.errorMessage = 'Invalid buySolAmount parameter';
            return result;
        }

        // Convert buySolAmount to bigint
        const buyingSolAmountU64 = typeof buySolAmount === 'bigint' ? buySolAmount : BigInt(buySolAmount);

        // Get current price
        let currentPrice;
        try {
            const priceString = await this.sdk.data.price(mint);
            currentPrice = BigInt(priceString);
            
        } catch (error) {
            result.errorCode = 'API_ERROR';
            result.errorMessage = `Failed to get token info: ${error.message}`;
            return result;
        }

        // Get short order list
        let shortOrderList;
        try {
            const ordersData = await this.sdk.data.orders(mint, { type: 'up_orders' });
            if (!ordersData.success || !ordersData.data || !ordersData.data.orders) {
                result.errorCode = 'API_ERROR';
                result.errorMessage = 'Unable to get order info';
                return result;
            }
            shortOrderList = convertApiOrdersFormat(ordersData.data.orders);
        } catch (error) {
            result.errorCode = 'API_ERROR';
            result.errorMessage = `Failed to get order info: ${error.message}`;
            return result;
        }

        // Handle empty order list
        if (shortOrderList.length === 0) {
            shortOrderList.push(null);
        }

        // Calculate ideal token amount without slippage
        const idealTradeResult = CurveAMM.buyFromPriceWithSolInput(currentPrice, buyingSolAmountU64);
        const idealTokenAmount = idealTradeResult ? idealTradeResult[1] : 0n;
        const idealSolAmount = buyingSolAmountU64;

        // Initialize price range and liquidity variables
        let maxAllowedPrice = 0n;
        let totalPriceSpan = 0n;
        let transactionCompletionRate = 0.0;
        let totalLiquiditySolAmount = 0n;
        let totalLiquidityTokenAmount = 0n;
        let targetReachedAtSegmentIndex = -1;

        // Build price segment analysis list
        const priceSegmentAnalysisList = new Array(shortOrderList.length);

        // Iterate through order list and calculate parameters for each price segment
        for (let segmentIndex = 0; segmentIndex < shortOrderList.length; segmentIndex++) {
            let segmentStartPrice, segmentEndPrice;

            // Determine start and end prices based on segment position
            if (segmentIndex === 0) {
                // First segment: start from current price
                segmentStartPrice = currentPrice;

                if (shortOrderList[0] === null) {
                    // If first order is null, no orders exist
                    segmentEndPrice = CurveAMM.MAX_U128_PRICE;
                    maxAllowedPrice = CurveAMM.MAX_U128_PRICE;
                } else {
                    // To one unit before first order start price
                    segmentEndPrice = BigInt(shortOrderList[0].lockLpStartPrice);
                    maxAllowedPrice = BigInt(shortOrderList[0].lockLpStartPrice);
                }
            } else if (shortOrderList[segmentIndex] === null) {
                // Current iteration reaches null (end of list)
                segmentStartPrice = BigInt(shortOrderList[segmentIndex - 1].lockLpEndPrice);
                segmentEndPrice = CurveAMM.MAX_U128_PRICE;
            } else {
                // Normal case: gap between two orders
                segmentStartPrice = BigInt(shortOrderList[segmentIndex - 1].lockLpEndPrice);
                segmentEndPrice = BigInt(shortOrderList[segmentIndex].lockLpStartPrice);
            }

            // Validate price segment validity
            if (segmentStartPrice > segmentEndPrice) {
                // Invalid price segment, skip
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    requiredSolAmount: null,
                    obtainableTokenAmount: null,
                    isValid: false
                };
                continue;
            }

            if (segmentStartPrice == segmentEndPrice) {
                // Price segments are equal
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    requiredSolAmount: 0n,
                    obtainableTokenAmount: 0n,
                    isValid: true
                };
                continue;
            }

            // Use AMM to calculate transaction parameters for this segment
            const segmentTradeResult = CurveAMM.buyFromPriceToPrice(segmentStartPrice, segmentEndPrice);

            if (!segmentTradeResult) {
                // AMM calculation failed
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    requiredSolAmount: null,
                    obtainableTokenAmount: null,
                    isValid: false
                };
            } else {
                // Calculation successful, save result
                const [requiredSolAmount, obtainableTokenAmount] = segmentTradeResult;
                priceSegmentAnalysisList[segmentIndex] = {
                    startPrice: segmentStartPrice,
                    endPrice: segmentEndPrice,
                    requiredSolAmount,
                    obtainableTokenAmount,
                    isValid: true
                };
            }
        }

        // Accumulate total liquidity depth
        for (let i = 0; i < priceSegmentAnalysisList.length; i++) {
            const segment = priceSegmentAnalysisList[i];

            if (segment.isValid && segment.requiredSolAmount !== null && segment.obtainableTokenAmount !== null) {
                totalLiquiditySolAmount += BigInt(segment.requiredSolAmount);
                totalLiquidityTokenAmount += BigInt(segment.obtainableTokenAmount);

                // Check if accumulated token amount has reached ideal target
                if (totalLiquidityTokenAmount >= idealTokenAmount && targetReachedAtSegmentIndex === -1) {
                    targetReachedAtSegmentIndex = i;
                }
            }
        }

        // Calculate actual transaction parameters
        let actualRequiredSolAmount = 0n;
        let actualObtainableTokenAmount = 0n;

        if (targetReachedAtSegmentIndex !== -1) {
            // Can complete 100% of transaction
            transactionCompletionRate = 100.0;

            for (let i = 0; i <= targetReachedAtSegmentIndex; i++) {
                const currentSegment = priceSegmentAnalysisList[i];

                if (i === targetReachedAtSegmentIndex) {
                    // Last segment: may only need partial transaction
                    const remainingTokenNeeded = idealTokenAmount - actualObtainableTokenAmount;
                    const partialTradeResult = CurveAMM.buyFromPriceWithTokenOutput(
                        currentSegment.startPrice,
                        remainingTokenNeeded
                    );

                    if (partialTradeResult) {
                        const [finalPrice, requiredSolForPartial] = partialTradeResult;
                        actualRequiredSolAmount += requiredSolForPartial;
                        actualObtainableTokenAmount += remainingTokenNeeded;
                        totalPriceSpan += absoluteValue(currentSegment.startPrice - finalPrice) + 1n;
                    }
                } else {
                    // Use this segment completely
                    actualRequiredSolAmount += currentSegment.requiredSolAmount;
                    actualObtainableTokenAmount += currentSegment.obtainableTokenAmount;
                    totalPriceSpan += absoluteValue(currentSegment.startPrice - currentSegment.endPrice) + 1n;
                }
            }
        } else {
            // Cannot complete transaction fully, use all available liquidity
            for (let i = 0; i < priceSegmentAnalysisList.length; i++) {
                const segment = priceSegmentAnalysisList[i];
                if (segment.isValid) {
                    actualRequiredSolAmount += segment.requiredSolAmount;
                    actualObtainableTokenAmount += segment.obtainableTokenAmount;
                    totalPriceSpan += absoluteValue(segment.startPrice - segment.endPrice) + 1n;
                }
            }

            // Calculate transaction completion rate
            if (idealTokenAmount > 0n) {
                transactionCompletionRate = parseFloat(
                    CurveAMM.u64ToTokenDecimal(actualObtainableTokenAmount)
                        .div(CurveAMM.u64ToTokenDecimal(idealTokenAmount))
                        .mul(100)
                        .toFixed(2)
                );
            }

            // Recalculate theoretical SOL needed (based on actual obtainable token amount)
            const theoreticalTradeResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, actualObtainableTokenAmount);
            if (theoreticalTradeResult) {
                const [, theoreticalSolNeeded] = theoreticalTradeResult;
                buyingSolAmountU64 = theoreticalSolNeeded;
            }
        }

        // Calculate minimum slippage percentage
        const minimumSlippagePercentage = Math.abs(
            100.0 * (
                CurveAMM.u64ToSolDecimal(buyingSolAmountU64)
                    .minus(CurveAMM.u64ToSolDecimal(actualRequiredSolAmount))
                    .div(CurveAMM.u64ToSolDecimal(buyingSolAmountU64))
                    .toNumber()
            )
        );

        // Set successful result
        result.success = true;
        result.data = {
            inputType: 'sol',                                    // Input currency type
            inputAmount: buyingSolAmountU64,                    // Input amount
            maxAllowedPrice: maxAllowedPrice,                   // Maximum allowed start price
            totalPriceSpan: totalPriceSpan,                     // Transaction price range
            transactionCompletionRate: transactionCompletionRate, // Theoretical transaction completion percentage
            idealTokenAmount: idealTokenAmount,                 // Ideal token amount obtainable
            idealSolAmount: idealSolAmount,                     // Ideal SOL amount needed
            actualRequiredSolAmount: actualRequiredSolAmount,   // Actual SOL amount required
            actualObtainableTokenAmount: actualObtainableTokenAmount, // Actual token amount obtainable
            theoreticalSolAmount: buyingSolAmountU64,           // SOL needed under liquidity pool constraints, no slippage
            minimumSlippagePercentage: minimumSlippagePercentage, // Minimum slippage percentage
            totalLiquiditySolAmount: totalLiquiditySolAmount,   // Total liquidity depth SOL
            totalLiquidityTokenAmount: totalLiquidityTokenAmount // Total liquidity depth Token
        };

    } catch (error) {
        // Catch unexpected errors
        result.errorCode = 'DATA_ERROR';
        result.errorMessage = `Error occurred during calculation: ${error.message}`;
    }

    return result;
}


/**
 * Simulate token buy transaction - calculate if target token amount can be purchased
 * @param {string} mint - Token address
 * @param {bigint|string|number} buyTokenAmount - Target token amount to buy
 * @param {string} passOrder - Optional order address to skip (won't be liquidated)
 * @returns {Promise<Object>} Token buy simulation result
 */
async function simulateTokenBuy(mint, buyTokenAmount, passOrder = null) {
    // Initialize return result
    const result = {
        success: false,
        errorCode: null,
        errorMessage: null,
        data: null
    };

    try {
        // Parameter validation
        if (!mint || typeof mint !== 'string') {
            result.errorCode = 'INVALID_MINT';
            result.errorMessage = 'Invalid mint address';
            return result;
        }

        // Convert and validate token amount
        const targetTokenAmount = typeof buyTokenAmount === 'bigint' ? 
            buyTokenAmount : BigInt(buyTokenAmount);
            
        if (targetTokenAmount <= 0n) {
            result.errorCode = 'INVALID_AMOUNT';
            result.errorMessage = 'Token amount must be positive';
            return result;
        }

        // Validate passOrder parameter
        if (passOrder !== null && typeof passOrder !== 'string') {
            result.errorCode = 'INVALID_PASS_ORDER';
            result.errorMessage = 'Pass order must be a valid address string';
            return result;
        }

        // Get current price
        let currentPrice;
        try {
            const priceString = await this.sdk.data.price(mint);
            currentPrice = BigInt(priceString);
        } catch (error) {
            result.errorCode = 'API_ERROR';
            result.errorMessage = `Failed to get price: ${error.message}`;
            return result;
        }

        // Get short order list (limited to MAX_ORDERS_COUNT + 1)
        let orders;
        try {
            const ordersData = await this.sdk.data.orders(mint, {
                type: 'up_orders',
                limit: this.sdk.MAX_ORDERS_COUNT + 1
            });
            
            if (!ordersData.success || !ordersData.data || !ordersData.data.orders) {
                result.errorCode = 'API_ERROR';
                result.errorMessage = 'Unable to get order info';
                return result;
            }
            
            // Convert order format
            orders = ordersData.data.orders;
        } catch (error) {
            result.errorCode = 'API_ERROR';
            result.errorMessage = `Failed to get orders: ${error.message}`;
            return result;
        }

        // Scenario A: No orders, direct calculation
        if (orders.length === 0) {
            const calcResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, targetTokenAmount);
            if (calcResult) {
                const [finalPrice, requiredSol] = calcResult;
                
                result.success = true;
                result.data = {
                    inputType: 'token',
                    inputAmount: targetTokenAmount,
                    currentPrice: currentPrice,
                    canComplete: true,
                    completionRate: 100.0,
                    limitReason: null,
                    idealSolRequired: requiredSol,
                    idealEndPrice: finalPrice,
                    actualObtainableToken: targetTokenAmount,
                    actualRequiredSol: requiredSol,
                    actualEndPrice: finalPrice,
                    ordersToClose: [],
                    ordersToCloseCount: 0,
                    passOrderIndex: null,
                    hasMoreOrders: false,
                    totalAvailableToken: CurveAMM.MAX_U64,
                    totalAvailableSol: CurveAMM.MAX_U64,
                    priceImpact: Number((finalPrice - currentPrice) * 10000n / currentPrice) / 100,
                    maxReachablePrice: CurveAMM.MAX_U128_PRICE,
                    segments: []
                };
                return result;
            } else {
                result.errorCode = 'CURVE_ERROR';
                result.errorMessage = 'Failed to calculate buy amounts';
                return result;
            }
        }

        // Initialize variables
        let totalAvailableToken = 0n;  // Cumulative token amount purchasable
        let totalTokenValue = 0n;      // Token amount including locked orders
        let previousAvailable = 0n;    // Previous available amount
        let ordersToClose = [];        // Order indices to liquidate
        let passOrderIndex = null;     // Index of skipped order
        let targetReached = false;     // Whether target reached
        let finalLpPairsIndex = -1;    // Final segment index
        let segments = [];             // Detailed segment information

        // Check if orders exceed limit
        const hasMoreOrders = orders.length > this.sdk.MAX_ORDERS_COUNT;
        const processableOrders = Math.min(orders.length, this.sdk.MAX_ORDERS_COUNT);

        // Step 1: Calculate liquidity from current price to first order
        if (orders.length > 0) {
            const firstOrderStartPrice = BigInt(orders[0].lock_lp_start_price);
            const firstSegmentResult = CurveAMM.buyFromPriceToPrice(currentPrice, firstOrderStartPrice);
            
            if (firstSegmentResult) {
                const [solAmount, tokenAmount] = firstSegmentResult;
                totalAvailableToken += tokenAmount;
                totalTokenValue += tokenAmount;
                
                segments.push({
                    type: 'initial',
                    startPrice: currentPrice,
                    endPrice: firstOrderStartPrice,
                    tokenAmount: tokenAmount,
                    solAmount: solAmount
                });
                
                if (totalAvailableToken >= targetTokenAmount) {
                    targetReached = true;
                    finalLpPairsIndex = -1;
                }
            }
        }

        // Step 2: Iterate orders and calculate cumulatively
        for (let i = 0; i < processableOrders && !targetReached; i++) {
            const order = orders[i];
            const isPassOrder = passOrder && order.order_pda === passOrder;
            
            // Process order
            if (isPassOrder) {
                // Skipped order: liquidity available but not liquidated
                previousAvailable = totalAvailableToken;
                totalAvailableToken += BigInt(order.lock_lp_token_amount);
                totalTokenValue += BigInt(order.lock_lp_token_amount);
                passOrderIndex = i;
                
                segments.push({
                    type: 'order',
                    startPrice: BigInt(order.lock_lp_start_price),
                    endPrice: BigInt(order.lock_lp_end_price),
                    tokenAmount: BigInt(order.lock_lp_token_amount),
                    solAmount: BigInt(order.lock_lp_sol_amount),
                    orderIndex: i,
                    isPassOrder: true
                });
            } else {
                // Order to be liquidated
                totalTokenValue += BigInt(order.lock_lp_token_amount);
                ordersToClose.push(i);
                
                segments.push({
                    type: 'order',
                    startPrice: BigInt(order.lock_lp_start_price),
                    endPrice: BigInt(order.lock_lp_end_price),
                    tokenAmount: BigInt(order.lock_lp_token_amount),
                    solAmount: BigInt(order.lock_lp_sol_amount),
                    orderIndex: i,
                    isPassOrder: false
                });
            }
            
            // Check if target reached
            if (totalAvailableToken >= targetTokenAmount) {
                targetReached = true;
                finalLpPairsIndex = i;
                break;
            }
            
            // Check next_order
            const nextOrderAddress = order.next_order || null;
            if (!nextOrderAddress) {
                // Chain ends, unlimited space above
                finalLpPairsIndex = i;
                previousAvailable = totalAvailableToken;
                totalAvailableToken = CurveAMM.MAX_U64;
                targetReached = true;
                
                segments.push({
                    type: 'final',
                    startPrice: BigInt(order.lock_lp_end_price),
                    endPrice: CurveAMM.MAX_U128_PRICE,
                    tokenAmount: CurveAMM.MAX_U64,
                    solAmount: CurveAMM.MAX_U64
                });
                break;
            }
            
            // Process gap between orders
            if (i < orders.length - 1 && i < this.sdk.MAX_ORDERS_COUNT - 1) {
                const gapStartPrice = BigInt(order.lock_lp_end_price);
                const gapEndPrice = BigInt(orders[i + 1].lock_lp_start_price);
                
                // Check if gap exists
                if (gapStartPrice < gapEndPrice) {
                    const gapResult = CurveAMM.buyFromPriceToPrice(gapStartPrice, gapEndPrice);
                    if (gapResult) {
                        const [gapSol, gapToken] = gapResult;
                        previousAvailable = totalAvailableToken;
                        totalAvailableToken += gapToken;
                        totalTokenValue += gapToken;
                        
                        segments.push({
                            type: 'gap',
                            startPrice: gapStartPrice,
                            endPrice: gapEndPrice,
                            tokenAmount: gapToken,
                            solAmount: gapSol
                        });
                        
                        if (totalAvailableToken >= targetTokenAmount) {
                            targetReached = true;
                            finalLpPairsIndex = i;
                            break;
                        }
                    }
                }
            } else if (i === processableOrders - 1 && hasMoreOrders) {
                // Last processable order with more orders beyond
                const lastGapStartPrice = BigInt(order.lock_lp_end_price);
                const lastGapEndPrice = BigInt(orders[i + 1].lock_lp_start_price);
                
                if (lastGapStartPrice < lastGapEndPrice) {
                    const lastGapResult = CurveAMM.buyFromPriceToPrice(lastGapStartPrice, lastGapEndPrice);
                    if (lastGapResult) {
                        const [lastGapSol, lastGapToken] = lastGapResult;
                        previousAvailable = totalAvailableToken;
                        totalAvailableToken += lastGapToken;
                        totalTokenValue += lastGapToken;
                        
                        segments.push({
                            type: 'gap',
                            startPrice: lastGapStartPrice,
                            endPrice: lastGapEndPrice,
                            tokenAmount: lastGapToken,
                            solAmount: lastGapSol
                        });
                        
                        if (totalAvailableToken >= targetTokenAmount) {
                            targetReached = true;
                            finalLpPairsIndex = i;
                        }
                    }
                }
            }
        }

        // Calculate ideal case (no order obstacles)
        const idealResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, targetTokenAmount);
        const [idealEndPrice, idealSolRequired] = idealResult || [0n, 0n];

        // Calculate actual parameters
        let actualRequiredSol = 0n;
        let actualObtainableToken = 0n;
        let actualEndPrice = currentPrice;
        let completionRate = 0.0;
        let limitReason = null;

        if (targetReached) {
            // Can complete trade, calculate exact SOL needed
            completionRate = 100.0;
            actualObtainableToken = targetTokenAmount;
            
            // Calculate exact end price and required SOL
            if (finalLpPairsIndex === -1) {
                // Completed in first segment
                const exactResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, targetTokenAmount);
                if (exactResult) {
                    actualEndPrice = exactResult[0];
                    actualRequiredSol = exactResult[1];
                }
            } else {
                // Need to cross multiple segments
                // Calculate remaining token needed
                const remainingToken = targetTokenAmount - previousAvailable;

                // Find final start price
                let lastStartPrice = currentPrice;
                if (finalLpPairsIndex >= 0 && finalLpPairsIndex < orders.length) {
                    lastStartPrice = BigInt(orders[finalLpPairsIndex].lock_lp_end_price);
                }
                
                // Calculate exact result for last segment
                const partialResult = CurveAMM.buyFromPriceWithTokenOutput(lastStartPrice, remainingToken);
                if (partialResult) {
                    actualEndPrice = partialResult[0];
                    
                    // Calculate total SOL requirement
                    const totalResult = CurveAMM.buyFromPriceToPrice(currentPrice, actualEndPrice);
                    if (totalResult) {
                        // Subtract SOL locked in orders
                        let lockedSol = 0n;
                        for (const idx of ordersToClose) {
                            if (idx < orders.length) {
                                lockedSol += BigInt(orders[idx].lock_lp_sol_amount);
                            }
                        }
                        actualRequiredSol = totalResult[0] - lockedSol;
                    }
                }
            }
        } else {
            // Cannot complete trade
            actualObtainableToken = Math.min(totalAvailableToken, targetTokenAmount);
            
            if (targetTokenAmount > 0n && totalAvailableToken > 0n) {
                completionRate = Number(totalAvailableToken * 10000n / targetTokenAmount) / 100;
                completionRate = Math.min(99.99, completionRate);
            }
            
            // Determine limit reason
            if (hasMoreOrders) {
                limitReason = 'order_count_limit';
            } else if (totalAvailableToken < targetTokenAmount) {
                limitReason = 'insufficient_liquidity';
            } else {
                limitReason = 'unknown';
            }
            
            // Calculate SOL for obtainable amount
            if (actualObtainableToken > 0n) {
                const partialResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, actualObtainableToken);
                if (partialResult) {
                    actualEndPrice = partialResult[0];
                    actualRequiredSol = partialResult[1];
                }
            }
        }

        // Calculate price impact
        let priceImpact = null;
        if (targetReached && actualEndPrice > currentPrice) {
            priceImpact = Number((actualEndPrice - currentPrice) * 10000n / currentPrice) / 100;
        }

        // Calculate max reachable price
        let maxReachablePrice = currentPrice;
        if (segments.length > 0) {
            const lastSegment = segments[segments.length - 1];
            maxReachablePrice = lastSegment.endPrice;
        }

        // Set successful result
        result.success = true;
        result.data = {
            // Basic info
            inputType: 'token',
            inputAmount: targetTokenAmount,
            currentPrice: currentPrice,
            
            // Feasibility analysis
            canComplete: targetReached,
            completionRate: completionRate,
            limitReason: limitReason,

            // Ideal case
            idealSolRequired: idealSolRequired,
            idealEndPrice: idealEndPrice,

            // Actual case
            actualObtainableToken: actualObtainableToken,
            actualRequiredSol: actualRequiredSol,
            actualEndPrice: actualEndPrice,

            // Order processing
            ordersToClose: ordersToClose,
            ordersToCloseCount: ordersToClose.length,
            passOrderIndex: passOrderIndex,
            hasMoreOrders: hasMoreOrders,

            // Liquidity analysis
            totalAvailableToken: totalAvailableToken,
            totalAvailableSol: actualRequiredSol,

            // Price impact
            priceImpact: priceImpact,
            maxReachablePrice: maxReachablePrice,

            // Detailed info
            segments: segments
        };

    } catch (error) {
        // Catch unexpected errors
        result.errorCode = 'UNEXPECTED_ERROR';
        result.errorMessage = `Unexpected error: ${error.message}`;
    }

    return result;
}


module.exports = {
    simulateBuy,
    simulateTokenBuy
};