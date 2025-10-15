
const CurveAMM = require('../../utils/curve_amm');
const {transformOrdersData , checkPriceRangeOverlap} = require('./stop_loss_utils')
const { PRICE_ADJUSTMENT_PERCENTAGE } = require('./utils');

/**
 * Simulate long position stop loss calculation
 * @param {string} mint - Token address
 * @param {bigint|string|number} buyTokenAmount - Token amount to buy for long position (u64 format, precision 10^6)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token info, default null
 * @param {Object|null} ordersData - Orders data, default null
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 * @returns {Promise<Object>} Stop loss analysis result
 */
async function simulateLongStopLoss(mint, buyTokenAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
    try {
        // Parameter validation
        if (!mint || !buyTokenAmount || !stopLossPrice) {
            throw new Error('Missing required parameters');
        }

        // Get current price
        if (!lastPrice) {
            //console.log('Getting current price...');
            lastPrice = await this.sdk.data.price(mint);
            if (!lastPrice) {
                throw new Error('Failed to get current price');
            }
        }

        // Get ordersData
        if (!ordersData) {
            //console.log('Getting orders data...');
            ordersData = await this.sdk.data.orders(mint, { type: 'down_orders' });
            if (!ordersData || !ordersData.success) {
                throw new Error('Failed to get orders data');
            }
        }

        // Calculate current price
        let currentPrice;
        if (lastPrice === null || lastPrice === undefined || lastPrice === '0') {
            console.log('Current price is empty, using initial price');
            currentPrice = CurveAMM.getInitialPrice();
        } else {
            currentPrice = BigInt(lastPrice);
            if (!currentPrice || currentPrice === 0n) {
                console.log('Current price is 0, using initial price');
                currentPrice = CurveAMM.getInitialPrice();
            }
        }

        // Transform orders data
        const downOrders = transformOrdersData(ordersData);
        //console.log(`Found ${downOrders.length} existing long orders`);

        // Initialize stop loss prices
        let stopLossStartPrice = BigInt(stopLossPrice);
        let stopLossEndPrice;
        let maxIterations = 1000; // Prevent infinite loop
        let iteration = 0;
        let finalOverlapResult = null; // Record final overlap result
        let finalTradeAmount = 0n; // Record final trade amount

        //console.log(`Start price: ${stopLossStartPrice}, Target token amount: ${buyTokenAmount}`);

        // Loop to adjust stop loss price until no overlap
        while (iteration < maxIterations) {
            iteration++;

            // Calculate stop loss end price
            //console.log('Current stop loss start price:', stopLossStartPrice.toString());
            const tradeResult = CurveAMM.sellFromPriceWithTokenInput(stopLossStartPrice, buyTokenAmount);
            if (!tradeResult) {
                throw new Error('Failed to calculate stop loss end price');
            }

            stopLossEndPrice = tradeResult[0]; // Price after trade completion
            const tradeAmount = tradeResult[1]; // SOL输出量 / SOL output amount

            //console.log(`迭代 ${iteration}: 起始价格=${stopLossStartPrice}, 结束价格=${stopLossEndPrice}, SOL输出量=${tradeAmount} / Iteration ${iteration}: Start=${stopLossStartPrice}, End=${stopLossEndPrice}, SOL output=${tradeAmount}`);

            // 检查价格区间重叠 / Check price range overlap
            const overlapResult = checkPriceRangeOverlap('down_orders', downOrders, stopLossStartPrice, stopLossEndPrice);
            
            if (overlapResult.no_overlap) {
                //console.log('价格区间无重叠，可以执行 / No price range overlap, can execute');
                finalOverlapResult = overlapResult; // 记录最终的overlap结果 / Record final overlap result
                finalTradeAmount = tradeAmount; // 记录最终的交易金额 / Record final trade amount
                break;
            }

            //console.log(`发现重叠: ${overlapResult.overlap_reason} / Found overlap: ${overlapResult.overlap_reason}`);

            // 调整起始价格（减少0.5%）/ Adjust start price (decrease by 0.5%)
            // 使用方案2：直接计算 0.5% = 5/1000
            const adjustmentAmount = (stopLossStartPrice * BigInt(PRICE_ADJUSTMENT_PERCENTAGE)) / 1000n;
            stopLossStartPrice = stopLossStartPrice - adjustmentAmount;

            //console.log(`调整后起始价格: ${stopLossStartPrice} / Adjusted start price: ${stopLossStartPrice}`);

            // 安全检查：确保价格不会变成负数 / Safety check: ensure price doesn't become negative
            if (stopLossStartPrice <= 0n) {
                throw new Error('止损价格调整后变为负数，无法继续 / Stop loss price became negative after adjustment');
            }
        }

        if (iteration >= maxIterations) {
            throw new Error('达到最大迭代次数，无法找到合适的止损价格 / Reached maximum iterations, cannot find suitable stop loss price');
        }

        // 计算最终返回值 / Calculate final return values
        const executableStopLossPrice = stopLossStartPrice;
        
        // 计算止损百分比 / Calculate stop loss percentage
        let stopLossPercentage = 0;
        let leverage = 1;
        
        if (currentPrice !== executableStopLossPrice) {
            stopLossPercentage = Number((BigInt(10000) * (currentPrice - executableStopLossPrice)) / currentPrice) / 100;
            leverage = Number((BigInt(10000) * currentPrice) / (currentPrice - executableStopLossPrice)) / 10000;
        }

        // 计算保证金 / Calculate margin requirement
        let estimatedMargin = 0n;
        try {
            // 1. 计算从当前价格买入所需的SOL
            const buyResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, buyTokenAmount);
            if (buyResult) {
                const requiredSol = buyResult[1]; // SOL input amount
                
                // 2. 计算平仓时扣除手续费后的收益
                const closeOutputSolAfterFee = CurveAMM.calculateAmountAfterFee(finalTradeAmount, borrowFee);
                
                // 3. 计算保证金 = 买入成本 - 平仓收益(扣费后)
                if (closeOutputSolAfterFee !== null && requiredSol > closeOutputSolAfterFee) {
                    estimatedMargin = requiredSol - closeOutputSolAfterFee;
                }
            }
        } catch (marginError) {
            console.warn('Failed to calculate estimated margin:', marginError.message);
            // Keep estimatedMargin as 0n
        }

        // console.log(`Calculation completed:`);
        // console.log(`  Executable stop loss price: ${executableStopLossPrice}`);
        // console.log(`  SOL output amount: ${finalTradeAmount}`);
        // console.log(`  Stop loss percentage: ${stopLossPercentage}%`);
        // console.log(`  Leverage: ${leverage}x`);
        // console.log(`  Previous order PDA: ${finalOverlapResult.prev_order_pda}`);
        // console.log(`  Next order PDA: ${finalOverlapResult.next_order_pda}`);

        return {
            executableStopLossPrice: executableStopLossPrice, // Calculated reasonable stop loss value
            tradeAmount: finalTradeAmount, // SOL output amount
            stopLossPercentage: stopLossPercentage, // Stop loss percentage relative to current price
            leverage: leverage, // Leverage ratio
            currentPrice: currentPrice, // Current price
            iterations: iteration, // Number of adjustments
            originalStopLossPrice: BigInt(stopLossPrice), // Original stop loss price
            prev_order_pda: finalOverlapResult.prev_order_pda, // Previous order PDA
            next_order_pda: finalOverlapResult.next_order_pda, // Next order PDA
            estimatedMargin: estimatedMargin // Estimated margin requirement in SOL (lamports)
        };

    } catch (error) {
        console.error('Failed to simulate stop loss calculation:', error.message);
        throw error;
    }
}


/**
 * Simulate short position stop loss calculation
 * @param {string} mint - Token address
 * @param {bigint|string|number} sellTokenAmount - Token amount to sell for short position (u64 format, precision 10^6)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token info, default null
 * @param {Object|null} ordersData - Orders data, default null
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 * @returns {Promise<Object>} Stop loss analysis result
 */
async function simulateSellStopLoss(mint, sellTokenAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
    try {
        // Parameter validation
        if (!mint || !sellTokenAmount || !stopLossPrice) {
            throw new Error('Missing required parameters');
        }

        // Get current price
        if (!lastPrice) {
            //console.log('Getting current price...');
            lastPrice = await this.sdk.data.price(mint);
            if (!lastPrice) {
                throw new Error('Failed to get current price');
            }
        }

        // Get ordersData
        if (!ordersData) {
            //console.log('Getting orders data...');
            ordersData = await this.sdk.data.orders(mint, { type: 'up_orders' });
            if (!ordersData || !ordersData.success) {
                throw new Error('Failed to get orders data');
            }
        }

        // Calculate current price
        let currentPrice;
        if (lastPrice === null || lastPrice === undefined || lastPrice === '0') {
            console.log('Current price is empty, using initial price');
            currentPrice = CurveAMM.getInitialPrice();
        } else {
            currentPrice = BigInt(lastPrice);
            if (!currentPrice || currentPrice === 0n) {
                console.log('Current price is 0, using initial price');
                currentPrice = CurveAMM.getInitialPrice();
            }
        }

        // Transform orders data
        const upOrders = transformOrdersData(ordersData);
        //console.log(`Found ${upOrders.length} existing short orders`);

        // Initialize stop loss prices
        let stopLossStartPrice = BigInt(stopLossPrice);
        let stopLossEndPrice;
        let maxIterations = 1000; // Prevent infinite loop
        let iteration = 0;
        let finalOverlapResult = null; // Record final overlap result
        let finalTradeAmount = 0n; // Record final trade amount

        //console.log(`Start price: ${stopLossStartPrice}, Target token amount: ${sellTokenAmount}`);

        // Loop to adjust stop loss price until no overlap
        while (iteration < maxIterations) {
            iteration++;

            // Calculate stop loss end price
            const tradeResult = CurveAMM.buyFromPriceWithTokenOutput(stopLossStartPrice, sellTokenAmount);
            if (!tradeResult) {
                throw new Error('Failed to calculate stop loss end price');
            }

            stopLossEndPrice = tradeResult[0]; // Price after trade completion
            const tradeAmount = tradeResult[1]; // SOL输入量 / SOL input amount

            //console.log(`迭代 ${iteration}: 起始价格=${stopLossStartPrice}, 结束价格=${stopLossEndPrice}, SOL输入量=${tradeAmount} / Iteration ${iteration}: Start=${stopLossStartPrice}, End=${stopLossEndPrice}, SOL input=${tradeAmount}`);

            // 检查价格区间重叠 / Check price range overlap
            const overlapResult = checkPriceRangeOverlap('up_orders', upOrders, stopLossStartPrice, stopLossEndPrice);
            
            if (overlapResult.no_overlap) {
                //console.log(' / No price range overlap, can execute');
                finalOverlapResult = overlapResult; // 记录最终的overlap结果 / Record final overlap result
                finalTradeAmount = tradeAmount; // 记录最终的交易金额 / Record final trade amount
                break;
            }

            //console.log(`发现重叠: ${overlapResult.overlap_reason} / Found overlap: ${overlapResult.overlap_reason}`);

            // 调整起始价格（增加0.5%）/ Adjust start price (increase by 0.5%)
            // 使用方案2：直接计算 0.5% = 5/1000
            const adjustmentAmount = (stopLossStartPrice * BigInt(PRICE_ADJUSTMENT_PERCENTAGE)) / 1000n;
            stopLossStartPrice = stopLossStartPrice + adjustmentAmount;

            //console.log(`调整后起始价格: ${stopLossStartPrice} / Adjusted start price: ${stopLossStartPrice}`);

            // 安全检查：确保价格不会超过最大值 / Safety check: ensure price doesn't exceed maximum
            if (stopLossStartPrice >= CurveAMM.MAX_U128_PRICE) {
                throw new Error('Stop loss price exceeded maximum after adjustment');
            }
        }

        if (iteration >= maxIterations) {
            throw new Error('达到最大迭代次数，无法找到合适的止损价格 / Reached maximum iterations, cannot find suitable stop loss price');
        }

        // 计算最终返回值 / Calculate final return values
        const executableStopLossPrice = stopLossStartPrice;
        
        // 计算止损百分比 / Calculate stop loss percentage
        // For short position, stop loss price is higher than current price, so it's a positive percentage
        const stopLossPercentage = Number((BigInt(10000) * (executableStopLossPrice - currentPrice)) / currentPrice) / 100;
        
        // 计算杠杆比例 / Calculate leverage ratio
        // For short position, leverage = current price / (stop loss price - current price)
        const leverage = Number((BigInt(10000) * currentPrice) / (executableStopLossPrice - currentPrice)) / 10000;

        // 计算保证金 / Calculate margin requirement
        let estimatedMargin = 0n;
        try {
            // 1. 计算从当前价格卖出代币获得的SOL（开仓收益，不含手续费）
            const sellResult = CurveAMM.sellFromPriceWithTokenInput(currentPrice, sellTokenAmount);
            if (sellResult) {
                const openingSolGain = sellResult[1]; // 卖出获得的SOL
                
                // 2. 计算开仓手续费
                const openingFee = (openingSolGain * BigInt(borrowFee)) / 100000n;
                
                // 3. 计算平仓成本（含手续费）
                const feeAmount = (finalTradeAmount * BigInt(borrowFee)) / 100000n;
                const closeCostWithFee = finalTradeAmount + feeAmount;
                
                // 4. 计算保证金 = 平仓成本（含手续费） - 开仓收益 - 开仓手续费
                if (closeCostWithFee > openingSolGain + openingFee) {
                    estimatedMargin = closeCostWithFee - openingSolGain - openingFee;
                }
            }
        } catch (marginError) {
            console.warn('Failed to calculate estimated margin for short position:', marginError.message);
            // Keep estimatedMargin as 0n
        }

        // console.log(`Calculation completed:`);
        // console.log(`  Executable stop loss price: ${executableStopLossPrice}`);
        // console.log(`  SOL input amount: ${finalTradeAmount}`);
        // console.log(`  Stop loss percentage: ${stopLossPercentage}%`);
        // console.log(`  Leverage: ${leverage}x`);
        // console.log(`  Previous order PDA: ${finalOverlapResult.prev_order_pda}`);
        // console.log(`  Next order PDA: ${finalOverlapResult.next_order_pda}`);

        return {
            executableStopLossPrice: executableStopLossPrice, // Calculated reasonable stop loss value
            tradeAmount: finalTradeAmount, // SOL input amount
            stopLossPercentage: stopLossPercentage, // Stop loss percentage relative to current price
            leverage: leverage, // Leverage ratio
            currentPrice: currentPrice, // Current price
            iterations: iteration, // Number of adjustments
            originalStopLossPrice: BigInt(stopLossPrice), // Original stop loss price
            prev_order_pda: finalOverlapResult.prev_order_pda, // Previous order PDA
            next_order_pda: finalOverlapResult.next_order_pda, // Next order PDA
            estimatedMargin: estimatedMargin // Estimated margin requirement in SOL (lamports)
        };

    } catch (error) {
        console.error('Failed to simulate short position stop loss calculation:', error.message);
        throw error;
    }
}









/**
 * Simulate long position stop loss calculation with SOL amount input
 * @param {string} mint - Token address
 * @param {bigint|string|number} buySolAmount - SOL amount to spend for long position (u64 format, lamports)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token info, default null
 * @param {Object|null} ordersData - Orders data, default null
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 * @returns {Promise<Object>} Stop loss analysis result (same as simulateLongStopLoss)
 */
async function simulateLongSolStopLoss(mint, buySolAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
    try {
        // Parameter validation
        if (!mint || !buySolAmount || !stopLossPrice) {
            throw new Error('Missing required parameters');
        }

        // Get current price if not provided
        let currentPrice;
        if (!lastPrice) {
            lastPrice = await this.sdk.data.price(mint);
            if (!lastPrice) {
                throw new Error('Failed to get current price');
            }
        }

        // Calculate current price
        if (lastPrice === null || lastPrice === undefined || lastPrice === '0') {
            currentPrice = CurveAMM.getInitialPrice();
        } else {
            currentPrice = BigInt(lastPrice);
            if (!currentPrice || currentPrice === 0n) {
                currentPrice = CurveAMM.getInitialPrice();
            }
        }

        // Calculate initial token amount from SOL amount using sellFromPriceWithSolOutput
        // This gives us how many tokens we can get when we later sell for buySolAmount SOL
        const initialResult = CurveAMM.sellFromPriceWithSolOutput(currentPrice, buySolAmount);
        if (!initialResult) {
            throw new Error('Failed to calculate token amount from SOL amount');
        }

        let buyTokenAmount = initialResult[1]; // Token amount
        let stopLossResult;
        let iterations = 0;
        const maxIterations = 15;

        // 使用二分查找算法找到 estimatedMargin < buySolAmount 的最大值
        // Use binary search algorithm to find maximum estimatedMargin that is less than buySolAmount
        let left = 1n; // 最小值，确保有一个有效的下界
        let right = buyTokenAmount * 10n; // 上界：初始值的10倍
        let bestResult = null;
        let bestMargin = 0n; // 记录最大的合法 estimatedMargin
        let bestTokenAmount = buyTokenAmount;
        
        // 二分查找主循环：寻找 estimatedMargin < buySolAmount 的最大值
        while (iterations < maxIterations && left <= right) {
            const mid = (left + right) / 2n;
            
            // 计算当前 token 数量的结果
            const currentResult = await simulateLongStopLoss.call(this, mint, mid, stopLossPrice, lastPrice, ordersData, borrowFee);
            const currentMargin = currentResult.estimatedMargin;
            
            //console.log(`Binary search iteration ${iterations}: tokenAmount=${mid}, estimatedMargin=${currentMargin}, target=${buySolAmount}`);
            
            // 只考虑 estimatedMargin < buySolAmount 的情况
            if (currentMargin < BigInt(buySolAmount)) {
                // 这是一个合法的解，检查是否比当前最佳解更好
                if (currentMargin > bestMargin) {
                    bestMargin = currentMargin;
                    bestResult = currentResult;
                    bestTokenAmount = mid;
                    //console.log(`Found better solution: estimatedMargin=${currentMargin}, tokenAmount=${mid}`);
                }
                
                // 如果差距已经很小（距离目标值小于10000000 lamports），可以提前退出
                if (BigInt(buySolAmount) - currentMargin <= 10000000n) {
                    //console.log(`Found optimal solution: estimatedMargin=${currentMargin}, diff=${BigInt(buySolAmount) - currentMargin} (< 10000000 lamports tolerance)`);
                    break;
                }
                
                // 继续向右搜索，寻找更大的合法值
                left = mid + 1n;
            } else {
                // estimatedMargin >= buySolAmount，需要减少 tokenAmount
                //console.log(`estimatedMargin too large (${currentMargin} >= ${buySolAmount}), searching left`);
                right = mid - 1n;
            }
            
            iterations++;
        }
        
        // 确保找到的结果满足要求
        if (bestResult && bestMargin < BigInt(buySolAmount)) {
            stopLossResult = bestResult;
            buyTokenAmount = bestTokenAmount;
            //console.log(`Binary search completed: best tokenAmount=${bestTokenAmount}, estimatedMargin=${bestMargin}, target=${buySolAmount}`);
        } else {
            // 如果没有找到合法解，使用一个很小的 tokenAmount 作为安全回退
            //console.log(`No valid solution found (estimatedMargin < buySolAmount), using minimal tokenAmount`);
            buyTokenAmount = buyTokenAmount / 10n; // 使用更小的值
            if (buyTokenAmount <= 0n) buyTokenAmount = 1000000n; // 最小值保护
            stopLossResult = await simulateLongStopLoss.call(this, mint, buyTokenAmount, stopLossPrice, lastPrice, ordersData, borrowFee);
        }

        // if (iterations >= maxIterations) {
        //     console.warn(`simulateLongSolStopLoss: Reached maximum iterations (${maxIterations}), tradeAmount=${stopLossResult.tradeAmount}, target=${buySolAmount}`);
        // }
        
        // Add buyTokenAmount and iteration info to the result
        return {
            ...stopLossResult,
            buyTokenAmount: buyTokenAmount,
            adjustmentIterations: iterations
        };

    } catch (error) {
        console.error('Failed to simulate long stop loss with SOL amount:', error.message);
        throw error;
    }
}

/**
 * Simulate short position stop loss calculation with SOL amount input
 * @param {string} mint - Token address
 * @param {bigint|string|number} sellSolAmount - SOL amount needed for short position stop loss (u64 format, lamports)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token info, default null
 * @param {Object|null} ordersData - Orders data, default null
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 * @returns {Promise<Object>} Stop loss analysis result (same as simulateSellStopLoss)
 */
async function simulateSellSolStopLoss(mint, sellSolAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
    try {
        // Parameter validation
        if (!mint || !sellSolAmount || !stopLossPrice) {
            throw new Error('Missing required parameters');
        }

        // Get current price if not provided
        let currentPrice;
        if (!lastPrice) {
            lastPrice = await this.sdk.data.price(mint);
            if (!lastPrice) {
                throw new Error('Failed to get current price');
            }
        }

        // Calculate current price
        if (lastPrice === null || lastPrice === undefined || lastPrice === '0') {
            currentPrice = CurveAMM.getInitialPrice();
        } else {
            currentPrice = BigInt(lastPrice);
            if (!currentPrice || currentPrice === 0n) {
                currentPrice = CurveAMM.getInitialPrice();
            }
        }

        // Calculate initial token amount from SOL amount using buyFromPriceWithSolInput
        // This gives us how many tokens we need to buy later using sellSolAmount SOL
        const initialResult = CurveAMM.buyFromPriceWithSolInput(currentPrice, sellSolAmount);
        if (!initialResult) {
            throw new Error('Failed to calculate token amount from SOL amount');
        }

        let sellTokenAmount = initialResult[1]; // Token amount
        let stopLossResult;
        let iterations = 0;
        const maxIterations = 15;

        // 使用二分查找算法找到 estimatedMargin < sellSolAmount 的最大值
        // Use binary search algorithm to find maximum estimatedMargin that is less than sellSolAmount
        let left = 1n; // 最小值，确保有一个有效的下界
        let right = sellTokenAmount * 10n; // 上界：初始值的10倍
        let bestResult = null;
        let bestMargin = 0n; // 记录最大的合法 estimatedMargin
        let bestTokenAmount = sellTokenAmount;
        
        // 二分查找主循环：寻找 estimatedMargin < sellSolAmount 的最大值
        while (iterations < maxIterations && left <= right) {
            const mid = (left + right) / 2n;
            
            // 计算当前 token 数量的结果
            const currentResult = await simulateSellStopLoss.call(this, mint, mid, stopLossPrice, lastPrice, ordersData, borrowFee);
            const currentMargin = currentResult.estimatedMargin;
            
            //console.log(`Binary search iteration ${iterations}: tokenAmount=${mid}, estimatedMargin=${currentMargin}, target=${sellSolAmount}`);
            
            // 只考虑 estimatedMargin < sellSolAmount 的情况
            if (currentMargin < BigInt(sellSolAmount)) {
                // 这是一个合法的解，检查是否比当前最佳解更好
                if (currentMargin > bestMargin) {
                    bestMargin = currentMargin;
                    bestResult = currentResult;
                    bestTokenAmount = mid;
                    //console.log(`Found better solution: estimatedMargin=${currentMargin}, tokenAmount=${mid}`);
                }
                
                // 如果差距已经很小（距离目标值小于10000000 lamports），可以提前退出
                if (BigInt(sellSolAmount) - currentMargin <= 10000000n) {
                    //console.log(`Found optimal solution: estimatedMargin=${currentMargin}, diff=${BigInt(sellSolAmount) - currentMargin} (< 10000000 lamports tolerance)`);
                    break;
                }
                
                // 继续向右搜索，寻找更大的合法值
                left = mid + 1n;
            } else {
                // estimatedMargin >= sellSolAmount，需要减少 tokenAmount
                //console.log(`estimatedMargin too large (${currentMargin} >= ${sellSolAmount}), searching left`);
                right = mid - 1n;
            }
            
            iterations++;
        }
        
        // 确保找到的结果满足要求
        if (bestResult && bestMargin < BigInt(sellSolAmount)) {
            stopLossResult = bestResult;
            sellTokenAmount = bestTokenAmount;
            //console.log(`Binary search completed: best tokenAmount=${bestTokenAmount}, estimatedMargin=${bestMargin}, target=${sellSolAmount}`);
        } else {
            // 如果没有找到合法解，使用一个很小的 tokenAmount 作为安全回退
            //console.log(`No valid solution found (estimatedMargin < sellSolAmount), using minimal tokenAmount`);
            sellTokenAmount = sellTokenAmount / 10n; // 使用更小的值
            if (sellTokenAmount <= 0n) sellTokenAmount = 1000000n; // 最小值保护
            stopLossResult = await simulateSellStopLoss.call(this, mint, sellTokenAmount, stopLossPrice, lastPrice, ordersData, borrowFee);
        }

        // if (iterations >= maxIterations) {
        //     //console.warn(`simulateSellSolStopLoss: Reached maximum iterations (${maxIterations}), tradeAmount=${stopLossResult.tradeAmount}, target=${sellSolAmount}`);
        // }
        
        // Add sellTokenAmount and iteration info to the result
        return {
            ...stopLossResult,
            sellTokenAmount: sellTokenAmount,
            adjustmentIterations: iterations
        };

    } catch (error) {
        console.error('Failed to simulate short stop loss with SOL amount:', error.message);
        throw error;
    }
}

module.exports = {
    simulateLongStopLoss,
    simulateSellStopLoss,
    simulateLongSolStopLoss,
    simulateSellSolStopLoss
};