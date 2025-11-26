
const CurveAMM = require('../../utils/curve_amm');
const {transformOrdersData , checkPriceRangeOverlap} = require('./stop_loss_utils')
const { PRICE_ADJUSTMENT_PERCENTAGE, MIN_STOP_LOSS_PERCENT } = require('./utils');
const JSONbig = require('json-bigint')({ storeAsString: false });

/**
 * Simulate long position stop loss calculation
 *
 * 模拟做多仓位的止损计算,返回可执行的止损价格和相关参数。
 * 该函数会自动调整止损价格以避免与现有订单的价格区间重叠,
 * 并返回合约执行时需要的插入位置索引数组。
 *
 * @param {string} mint - Token address / 代币地址
 * @param {bigint|string|number} buyTokenAmount - Token amount to buy for long position (u64 format, precision 10^6) / 做多买入的代币数量 (u64格式, 精度 10^6)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format) / 用户期望的止损价格 (u128格式)
 * @param {Object|null} lastPrice - Token info, default null / 代币当前价格信息,默认null会自动获取
 * @param {Object|null} ordersData - Orders data, default null / 订单数据,默认null会自动获取
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%) / 借贷手续费率,默认2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result / 止损分析结果对象
 * @returns {bigint} returns.executableStopLossPrice - 计算出的可执行止损价格 (u128格式)
 *   - 这是经过调整后不与现有订单重叠的止损价格
 *   - 可能低于用户输入的 stopLossPrice (因为需要避免重叠)
 *   - 可以直接用于调用 sdk.trading.long() 的 closePrice 参数
 *
 * @returns {bigint} returns.tradeAmount - 止损时预计卖出获得的SOL数量 (lamports)
 *   - 这是在 executableStopLossPrice 价格卖出 buyTokenAmount 代币能获得的SOL
 *   - 不包含手续费扣除
 *   - 用于估算止损时的收益
 *
 * @returns {number} returns.stopLossPercentage - 止损百分比 (相对于当前价格)
 *   - 计算公式: ((currentPrice - executableStopLossPrice) / currentPrice) * 100
 *   - 例如: 3.5 表示止损价格比当前价格低3.5%
 *   - 做多时这个值应该是正数 (止损价低于当前价)
 *
 * @returns {number} returns.leverage - 杠杆倍数
 *   - 计算公式: currentPrice / (currentPrice - executableStopLossPrice)
 *   - 例如: 28.57 表示约28.57倍杠杆
 *   - 杠杆越高,风险越大,但潜在收益也越大
 *
 * @returns {bigint} returns.currentPrice - 当前价格 (u128格式)
 *   - 计算时使用的代币当前价格
 *   - 用于参考和验证
 *
 * @returns {number} returns.iterations - 价格调整迭代次数
 *   - 为了避免价格区间重叠,函数自动调整止损价格的次数
 *   - 每次调整会将价格降低 PRICE_ADJUSTMENT_PERCENTAGE (默认0.5%)
 *   - 如果迭代次数过高,可能需要重新选择止损价格
 *
 * @returns {bigint} returns.originalStopLossPrice - 用户输入的原始止损价格 (u128格式)
 *   - 用于对比调整前后的价格差异
 *   - 如果 executableStopLossPrice 与此差异较大,说明现有订单较密集
 *
 * @returns {number[]} returns.close_insert_indices - 平仓订单插入位置的候选索引数组 ⭐ 新增
 *   - 数组包含多个候选插入位置的 OrderBook 索引值
 *   - 结构: [主位置index, 前1个index, 后1个index, 前2个index, 后2个index, 前3个index, 后3个index]
 *   - 例如: [25, 10, 33, 5, 40, 2, 50] 表示主位置是索引25,备选位置包括索引10、33等
 *   - 最多包含7个索引值 (1个主位置 + 前3个 + 后3个)
 *   - 如果订单簿为空,返回 [65535] (u16::MAX,表示插入到头部)
 *   - 用途: 传递给 sdk.trading.long() 的 closeInsertIndices 参数
 *   - 提高成功率: 即使主位置的订单被删除,合约也能尝试其他候选位置
 *
 * @returns {bigint} returns.estimatedMargin - 预估所需保证金 (SOL lamports)
 *   - 计算公式: 买入成本 - 平仓收益(扣除手续费后)
 *   - 这是执行此止损策略需要的最少保证金
 *   - 可以用于 sdk.trading.long() 的 marginSolMax 参数
 *   - 实际调用时建议增加10-20%余量以应对价格波动
 *
 * @throws {Error} 当缺少必需参数时
 * @throws {Error} 当无法获取价格或订单数据时
 * @throws {Error} 当达到最大迭代次数仍无法找到合适的止损价格时
 * @throws {Error} 当价格调整后变为负数时
 *
 * @example
 * // 基础用法: 做多1个代币,止损价格为当前价格的97%
 * const result = await sdk.simulator.simulateLongStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   1000000n,                                          // 1 token (精度10^6)
 *   BigInt('97000000000000000000')                     // 止损价格
 * );
 *
 * console.log(`可执行止损价格: ${result.executableStopLossPrice}`);
 * console.log(`止损百分比: ${result.stopLossPercentage}%`);
 * console.log(`杠杆倍数: ${result.leverage}x`);
 * console.log(`预估保证金: ${result.estimatedMargin} lamports`);
 * console.log(`插入位置索引: ${result.close_insert_indices}`);
 *
 * @example
 * // 完整使用流程: 模拟后执行做多交易
 * async function openLongPosition(sdk, mint, buyTokenAmount, stopLossPrice) {
 *   // 1. 模拟止损计算
 *   const simulation = await sdk.simulator.simulateLongStopLoss(
 *     mint,
 *     buyTokenAmount,
 *     stopLossPrice
 *   );
 *
 *   // 2. 检查止损价格是否被大幅调整
 *   const priceDiff = Number((simulation.originalStopLossPrice - simulation.executableStopLossPrice) * 10000n / simulation.originalStopLossPrice) / 100;
 *   if (priceDiff > 1.0) {
 *     console.warn(`止损价格被调整了 ${priceDiff}%, 当前订单较密集`);
 *   }
 *
 *   // 3. 准备交易参数
 *   const maxSolAmount = simulation.estimatedMargin * 120n / 100n; // 增加20%余量
 *   const marginSolMax = simulation.estimatedMargin * 115n / 100n; // 增加15%余量
 *
 *   // 4. 执行做多交易
 *   const tx = await sdk.trading.long({
 *     mint: mint,
 *     buyTokenAmount: buyTokenAmount,
 *     maxSolAmount: maxSolAmount,
 *     marginSolMax: marginSolMax,
 *     closePrice: simulation.executableStopLossPrice,
 *     closeInsertIndices: simulation.close_insert_indices  // ⭐ 使用新的索引数组
 *   });
 *
 *   return tx;
 * }
 *
 * @see {@link simulateShortStopLoss} 做空仓位的止损计算
 * @see {@link simulateLongSolStopLoss} 基于SOL金额的做多止损计算
 * @since 2.0.0
 * @version 2.0.0 - 从返回 prev_order_pda/next_order_pda 改为返回 close_insert_indices
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
        console.log("simulateLongStopLoss lastPrice=",lastPrice)

        // Get ordersData
        if (!ordersData) {
            //console.log('Getting orders data...');
            ordersData = await this.sdk.data.orders(mint, { type: 'down_orders' });
            if (!ordersData || !ordersData.success) {
                throw new Error('Failed to get orders data');
            }
        }

        //console.log("ordersData=", JSONbig.stringify(ordersData, null, 2))
        console.log("ordersData len=", ordersData.data.orders.length)

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
        console.log(`downOrders Found ${downOrders.length} existing long orders`);
        //console.log("downOrders downOrders=",downOrders)

        // Initialize stop loss prices
        let stopLossStartPrice = BigInt(stopLossPrice);
        let stopLossEndPrice;
        let maxIterations = 1000; // Prevent infinite loop
        let iteration = 0;
        let finalOverlapResult = null; // Record final overlap result
        let finalTradeAmount = 0n; // Record final trade amount

        // 检查并调整止损价格以满足最小距离要求 (做多: 止损价必须低于当前价至少 MIN_STOP_LOSS_PERCENT)
        // Check and adjust stop loss price to meet minimum distance requirement (long: stop loss must be below current price by at least MIN_STOP_LOSS_PERCENT)
        const minAllowedStopLoss = currentPrice - (currentPrice * BigInt(MIN_STOP_LOSS_PERCENT)) / 1000n;
        if (stopLossStartPrice > minAllowedStopLoss) {
            const originalStopLoss = stopLossStartPrice;
            stopLossStartPrice = minAllowedStopLoss;
            const originalPercent = Number((currentPrice - originalStopLoss) * 1000n / currentPrice) / 10;
            const adjustedPercent = Number((currentPrice - stopLossStartPrice) * 1000n / currentPrice) / 10;
            console.log(`止损价格自动调整以满足最小距离要求:`);
            console.log(`  原始止损距离: ${originalPercent.toFixed(2)}%`);
            console.log(`  调整后距离: ${adjustedPercent.toFixed(2)}% (最小要求: ${Number(MIN_STOP_LOSS_PERCENT) / 10}%)`);
            console.log(`  原始止损价: ${originalStopLoss}`);
            console.log(`  调整后止损价: ${stopLossStartPrice}`);
        }

        //console.log(`Start price: ${stopLossStartPrice}, Target token amount: ${buyTokenAmount}`);

        // Loop to adjust stop loss price until no overlap
        while (iteration < maxIterations) {
            iteration++;

            // // Calculate stop loss end price
            // console.log(`[Long Stop Loss Debug] Iteration ${iteration}:`);
            // console.log(`  - stopLossStartPrice: ${stopLossStartPrice.toString()}`);
            // console.log(`  - buyTokenAmount: ${buyTokenAmount.toString()}`);
            // console.log(`  - Calling CurveAMM.sellFromPriceWithTokenInput...`);

            const tradeResult = CurveAMM.sellFromPriceWithTokenInput(stopLossStartPrice, buyTokenAmount);

            //console.log(`  - tradeResult:`, tradeResult);

            if (!tradeResult) {
                console.error(`[Long Stop Loss Error] Failed at iteration ${iteration}`);
                console.error(`  - stopLossStartPrice: ${stopLossStartPrice.toString()}`);
                console.error(`  - buyTokenAmount: ${buyTokenAmount.toString()}`);
                throw new Error('Failed to calculate stop loss end price');
            }

            stopLossEndPrice = tradeResult[0]; // Price after trade completion
            const tradeAmount = tradeResult[1]; // SOL输出量 / SOL output amount

            // console.log(`  - stopLossEndPrice: ${stopLossEndPrice.toString()}`);
            // console.log(`  - tradeAmount: ${tradeAmount.toString()}`);

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
        // console.log(`  Close insert indices: ${finalOverlapResult.close_insert_indices}`);

        return {
            executableStopLossPrice: executableStopLossPrice, // Calculated reasonable stop loss value
            tradeAmount: finalTradeAmount, // SOL output amount
            stopLossPercentage: stopLossPercentage, // Stop loss percentage relative to current price
            leverage: leverage, // Leverage ratio
            currentPrice: currentPrice, // Current price
            iterations: iteration, // Number of adjustments
            originalStopLossPrice: BigInt(stopLossPrice), // Original stop loss price
            close_insert_indices: finalOverlapResult.close_insert_indices, // Candidate insertion indices for closing order
            estimatedMargin: estimatedMargin // Estimated margin requirement in SOL (lamports)
        };

    } catch (error) {
        console.error('Failed to simulate stop loss calculation:', error.message);
        throw error;
    }
}


/**
 * Simulate short position stop loss calculation
 *
 * 模拟做空仓位的止损计算,返回可执行的止损价格和相关参数。
 * 该函数会自动调整止损价格以避免与现有订单的价格区间重叠,
 * 并返回合约执行时需要的插入位置索引数组。
 *
 * @param {string} mint - Token address / 代币地址
 * @param {bigint|string|number} sellTokenAmount - Token amount to sell for short position (u64 format, precision 10^6) / 做空卖出的代币数量 (u64格式, 精度 10^6)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format) / 用户期望的止损价格 (u128格式)
 * @param {Object|null} lastPrice - Token info, default null / 代币当前价格信息,默认null会自动获取
 * @param {Object|null} ordersData - Orders data, default null / 订单数据,默认null会自动获取
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%) / 借贷手续费率,默认2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result / 止损分析结果对象
 * @returns {bigint} returns.executableStopLossPrice - 计算出的可执行止损价格 (u128格式)
 *   - 这是经过调整后不与现有订单重叠的止损价格
 *   - 可能高于用户输入的 stopLossPrice (因为需要避免重叠)
 *   - 可以直接用于调用 sdk.trading.short() 的 closePrice 参数
 *
 * @returns {bigint} returns.tradeAmount - 止损时预计买入需要的SOL数量 (lamports)
 *   - 这是在 executableStopLossPrice 价格买回 sellTokenAmount 代币需要的SOL
 *   - 不包含手续费
 *   - 用于估算止损时的成本
 *
 * @returns {number} returns.stopLossPercentage - 止损百分比 (相对于当前价格)
 *   - 计算公式: ((executableStopLossPrice - currentPrice) / currentPrice) * 100
 *   - 例如: 3.5 表示止损价格比当前价格高3.5%
 *   - 做空时这个值应该是正数 (止损价高于当前价)
 *
 * @returns {number} returns.leverage - 杠杆倍数
 *   - 计算公式: currentPrice / (executableStopLossPrice - currentPrice)
 *   - 例如: 28.57 表示约28.57倍杠杆
 *   - 杠杆越高,风险越大,但潜在收益也越大
 *
 * @returns {bigint} returns.currentPrice - 当前价格 (u128格式)
 *   - 计算时使用的代币当前价格
 *   - 用于参考和验证
 *
 * @returns {number} returns.iterations - 价格调整迭代次数
 *   - 为了避免价格区间重叠,函数自动调整止损价格的次数
 *   - 每次调整会将价格提高 PRICE_ADJUSTMENT_PERCENTAGE (默认0.5%)
 *   - 如果迭代次数过高,可能需要重新选择止损价格
 *
 * @returns {bigint} returns.originalStopLossPrice - 用户输入的原始止损价格 (u128格式)
 *   - 用于对比调整前后的价格差异
 *   - 如果 executableStopLossPrice 与此差异较大,说明现有订单较密集
 *
 * @returns {number[]} returns.close_insert_indices - 平仓订单插入位置的候选索引数组 ⭐ 新增
 *   - 数组包含多个候选插入位置的 OrderBook 索引值
 *   - 结构: [主位置index, 前1个index, 后1个index, 前2个index, 后2个index, 前3个index, 后3个index]
 *   - 例如: [25, 10, 33, 5, 40, 2, 50] 表示主位置是索引25,备选位置包括索引10、33等
 *   - 最多包含7个索引值 (1个主位置 + 前3个 + 后3个)
 *   - 如果订单簿为空,返回 [65535] (u16::MAX,表示插入到头部)
 *   - 用途: 传递给 sdk.trading.short() 的 closeInsertIndices 参数
 *   - 提高成功率: 即使主位置的订单被删除,合约也能尝试其他候选位置
 *
 * @returns {bigint} returns.estimatedMargin - 预估所需保证金 (SOL lamports)
 *   - 计算公式: 平仓成本(含手续费) - 开仓收益 - 开仓手续费
 *   - 这是执行此止损策略需要的最少保证金
 *   - 可以用于 sdk.trading.short() 的 marginSolMax 参数
 *   - 实际调用时建议增加10-20%余量以应对价格波动
 *
 * @throws {Error} 当缺少必需参数时
 * @throws {Error} 当无法获取价格或订单数据时
 * @throws {Error} 当达到最大迭代次数仍无法找到合适的止损价格时
 * @throws {Error} 当价格调整后超过最大值时
 *
 * @example
 * // 基础用法: 做空1个代币,止损价格为当前价格的103%
 * const result = await sdk.simulator.simulateShortStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   1000000n,                                          // 1 token (精度10^6)
 *   BigInt('103000000000000000000')                    // 止损价格
 * );
 *
 * console.log(`可执行止损价格: ${result.executableStopLossPrice}`);
 * console.log(`止损百分比: ${result.stopLossPercentage}%`);
 * console.log(`杠杆倍数: ${result.leverage}x`);
 * console.log(`预估保证金: ${result.estimatedMargin} lamports`);
 * console.log(`插入位置索引: ${result.close_insert_indices}`);
 *
 * @example
 * // 完整使用流程: 模拟后执行做空交易
 * async function openShortPosition(sdk, mint, sellTokenAmount, stopLossPrice) {
 *   // 1. 模拟止损计算
 *   const simulation = await sdk.simulator.simulateShortStopLoss(
 *     mint,
 *     sellTokenAmount,
 *     stopLossPrice
 *   );
 *
 *   // 2. 检查止损价格是否被大幅调整
 *   const priceDiff = Number((simulation.executableStopLossPrice - simulation.originalStopLossPrice) * 10000n / simulation.originalStopLossPrice) / 100;
 *   if (priceDiff > 1.0) {
 *     console.warn(`止损价格被调整了 ${priceDiff}%, 当前订单较密集`);
 *   }
 *
 *   // 3. 准备交易参数
 *   const minSolOutput = simulation.tradeAmount * 80n / 100n; // 至少获得80%
 *   const marginSolMax = simulation.estimatedMargin * 115n / 100n; // 增加15%余量
 *
 *   // 4. 执行做空交易
 *   const tx = await sdk.trading.short({
 *     mint: mint,
 *     borrowSellTokenAmount: sellTokenAmount,
 *     minSolOutput: minSolOutput,
 *     marginSolMax: marginSolMax,
 *     closePrice: simulation.executableStopLossPrice,
 *     closeInsertIndices: simulation.close_insert_indices  // ⭐ 使用新的索引数组
 *   });
 *
 *   return tx;
 * }
 *
 * @see {@link simulateLongStopLoss} 做多仓位的止损计算
 * @see {@link simulateShortSolStopLoss} 基于SOL金额的做空止损计算
 * @since 2.0.0
 * @version 2.0.0 - 从返回 prev_order_pda/next_order_pda 改为返回 close_insert_indices
 */
async function simulateShortStopLoss(mint, sellTokenAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
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

        //console.log("ordersData=", JSONbig.stringify(ordersData, null, 2))
        console.log("ordersData len=", ordersData.data.orders.length)

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
        console.log(`upOrders Found ${upOrders.length} existing short orders`);

        // Initialize stop loss prices
        let stopLossStartPrice = BigInt(stopLossPrice);
        let stopLossEndPrice;
        let maxIterations = 1000; // Prevent infinite loop
        let iteration = 0;
        let finalOverlapResult = null; // Record final overlap result
        let finalTradeAmount = 0n; // Record final trade amount

        // 检查并调整止损价格以满足最小距离要求 (做空: 止损价必须高于当前价至少 MIN_STOP_LOSS_PERCENT)
        // Check and adjust stop loss price to meet minimum distance requirement (short: stop loss must be above current price by at least MIN_STOP_LOSS_PERCENT)
        const minAllowedStopLoss = currentPrice + (currentPrice * BigInt(MIN_STOP_LOSS_PERCENT)) / 1000n;
        if (stopLossStartPrice < minAllowedStopLoss) {
            const originalStopLoss = stopLossStartPrice;
            stopLossStartPrice = minAllowedStopLoss;
            const originalPercent = Number((originalStopLoss - currentPrice) * 1000n / currentPrice) / 10;
            const adjustedPercent = Number((stopLossStartPrice - currentPrice) * 1000n / currentPrice) / 10;
            console.log(`止损价格自动调整以满足最小距离要求:`);
            console.log(`  原始止损距离: ${originalPercent.toFixed(2)}%`);
            console.log(`  调整后距离: ${adjustedPercent.toFixed(2)}% (最小要求: ${Number(MIN_STOP_LOSS_PERCENT) / 10}%)`);
            console.log(`  原始止损价: ${originalStopLoss}`);
            console.log(`  调整后止损价: ${stopLossStartPrice}`);
        }

        //console.log(`Start price: ${stopLossStartPrice}, Target token amount: ${sellTokenAmount}`);

        // Loop to adjust stop loss price until no overlap
        while (iteration < maxIterations) {
            iteration++;

            // // Calculate stop loss end price
            // console.log(`[Sell Stop Loss Debug] Iteration ${iteration}:`);
            // console.log(`  - stopLossStartPrice: ${stopLossStartPrice.toString()}`);
            // console.log(`  - sellTokenAmount: ${sellTokenAmount.toString()}`);
            // console.log(`  - Calling CurveAMM.buyFromPriceWithTokenOutput...`);

            const tradeResult = CurveAMM.buyFromPriceWithTokenOutput(stopLossStartPrice, sellTokenAmount);

            //console.log(`  - tradeResult:`, tradeResult);

            if (!tradeResult) {
                console.error(`[Sell Stop Loss Error] Failed at iteration ${iteration}`);
                console.error(`  - stopLossStartPrice: ${stopLossStartPrice.toString()}`);
                console.error(`  - sellTokenAmount: ${sellTokenAmount.toString()}`);
                throw new Error('Failed to calculate stop loss end price');
            }

            stopLossEndPrice = tradeResult[0]; // Price after trade completion
            const tradeAmount = tradeResult[1]; // SOL输入量 / SOL input amount

            // console.log(`  - stopLossEndPrice: ${stopLossEndPrice.toString()}`);
            // console.log(`  - tradeAmount: ${tradeAmount.toString()}`);

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
                throw new Error(`Stop loss price exceeded maximum after adjustment: ${stopLossStartPrice} >= ${CurveAMM.MAX_U128_PRICE}`);
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
        // console.log(`  Close insert indices: ${finalOverlapResult.close_insert_indices}`);

        return {
            executableStopLossPrice: executableStopLossPrice, // Calculated reasonable stop loss value
            tradeAmount: finalTradeAmount, // SOL input amount
            stopLossPercentage: stopLossPercentage, // Stop loss percentage relative to current price
            leverage: leverage, // Leverage ratio
            currentPrice: currentPrice, // Current price
            iterations: iteration, // Number of adjustments
            originalStopLossPrice: BigInt(stopLossPrice), // Original stop loss price
            close_insert_indices: finalOverlapResult.close_insert_indices, // Candidate insertion indices for closing order
            estimatedMargin: estimatedMargin // Estimated margin requirement in SOL (lamports)
        };

    } catch (error) {
        console.error('Failed to simulate short position stop loss calculation:', error.message);
        throw error;
    }
}









/**
 * Simulate long position stop loss calculation with SOL amount input
 *
 * 基于 SOL 金额的做多止损计算。该函数会自动计算出对应的代币数量,
 * 使得保证金需求接近用户输入的 SOL 金额。
 *
 * @param {string} mint - Token address / 代币地址
 * @param {bigint|string|number} buySolAmount - SOL amount to spend for long position (u64 format, lamports) / 做多投入的SOL金额 (u64格式, lamports)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format) / 用户期望的止损价格 (u128格式)
 * @param {Object|null} lastPrice - Token info, default null / 代币当前价格信息,默认null会自动获取
 * @param {Object|null} ordersData - Orders data, default null / 订单数据,默认null会自动获取
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%) / 借贷手续费率,默认2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result / 止损分析结果对象
 * @returns {bigint} returns.executableStopLossPrice - 可执行止损价格 (u128格式) - 同 {@link simulateLongStopLoss}
 * @returns {bigint} returns.tradeAmount - 止损时预计卖出获得的SOL数量 (lamports) - 同 {@link simulateLongStopLoss}
 * @returns {number} returns.stopLossPercentage - 止损百分比 - 同 {@link simulateLongStopLoss}
 * @returns {number} returns.leverage - 杠杆倍数 - 同 {@link simulateLongStopLoss}
 * @returns {bigint} returns.currentPrice - 当前价格 (u128格式) - 同 {@link simulateLongStopLoss}
 * @returns {number} returns.iterations - 价格调整迭代次数 - 同 {@link simulateLongStopLoss}
 * @returns {bigint} returns.originalStopLossPrice - 原始止损价格 (u128格式) - 同 {@link simulateLongStopLoss}
 * @returns {number[]} returns.close_insert_indices - 平仓订单插入位置的候选索引数组 ⭐ - 同 {@link simulateLongStopLoss}
 * @returns {bigint} returns.estimatedMargin - 预估所需保证金 (SOL lamports) - 同 {@link simulateLongStopLoss}
 * @returns {bigint} returns.buyTokenAmount - 计算出的买入代币数量 ⭐ 额外字段
 *   - 这是根据 buySolAmount 反向计算出的代币数量
 *   - 使得 estimatedMargin 接近 buySolAmount
 *   - 可以直接用于 sdk.trading.long() 的 buyTokenAmount 参数
 * @returns {number} returns.adjustmentIterations - 代币数量调整迭代次数 ⭐ 额外字段
 *   - 二分查找算法调整代币数量的迭代次数
 *   - 用于评估计算精度
 *
 * @throws {Error} 当缺少必需参数时
 * @throws {Error} 当无法获取价格或订单数据时
 * @throws {Error} 当无法计算代币数量时
 *
 * @example
 * // 基础用法: 投入 0.1 SOL 做多,止损价格为当前价格的97%
 * const result = await sdk.simulator.simulateLongSolStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   100000000n,                                        // 0.1 SOL (精度10^9)
 *   BigInt('97000000000000000000')                     // 止损价格
 * );
 *
 * console.log(`买入代币数量: ${result.buyTokenAmount}`);
 * console.log(`预估保证金: ${result.estimatedMargin} lamports`);
 * console.log(`插入位置索引: ${result.close_insert_indices}`);
 *
 * @see {@link simulateLongStopLoss} 基于代币数量的做多止损计算
 * @see {@link simulateShortSolStopLoss} 基于SOL金额的做空止损计算
 * @since 2.0.0
 * @version 2.0.0 - 从返回 prev_order_pda/next_order_pda 改为返回 close_insert_indices
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
 *
 * 基于 SOL 金额的做空止损计算。该函数会自动计算出对应的代币数量,
 * 使得保证金需求接近用户输入的 SOL 金额。
 *
 * @param {string} mint - Token address / 代币地址
 * @param {bigint|string|number} sellSolAmount - SOL amount needed for short position stop loss (u64 format, lamports) / 做空投入的SOL金额 (u64格式, lamports)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format) / 用户期望的止损价格 (u128格式)
 * @param {Object|null} lastPrice - Token info, default null / 代币当前价格信息,默认null会自动获取
 * @param {Object|null} ordersData - Orders data, default null / 订单数据,默认null会自动获取
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%) / 借贷手续费率,默认2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result / 止损分析结果对象
 * @returns {bigint} returns.executableStopLossPrice - 可执行止损价格 (u128格式) - 同 {@link simulateShortStopLoss}
 * @returns {bigint} returns.tradeAmount - 止损时预计买入需要的SOL数量 (lamports) - 同 {@link simulateShortStopLoss}
 * @returns {number} returns.stopLossPercentage - 止损百分比 - 同 {@link simulateShortStopLoss}
 * @returns {number} returns.leverage - 杠杆倍数 - 同 {@link simulateShortStopLoss}
 * @returns {bigint} returns.currentPrice - 当前价格 (u128格式) - 同 {@link simulateShortStopLoss}
 * @returns {number} returns.iterations - 价格调整迭代次数 - 同 {@link simulateShortStopLoss}
 * @returns {bigint} returns.originalStopLossPrice - 原始止损价格 (u128格式) - 同 {@link simulateShortStopLoss}
 * @returns {number[]} returns.close_insert_indices - 平仓订单插入位置的候选索引数组 ⭐ - 同 {@link simulateShortStopLoss}
 * @returns {bigint} returns.estimatedMargin - 预估所需保证金 (SOL lamports) - 同 {@link simulateShortStopLoss}
 * @returns {bigint} returns.sellTokenAmount - 计算出的卖出代币数量 ⭐ 额外字段
 *   - 这是根据 sellSolAmount 反向计算出的代币数量
 *   - 使得 estimatedMargin 接近 sellSolAmount
 *   - 可以直接用于 sdk.trading.short() 的 borrowSellTokenAmount 参数
 * @returns {number} returns.adjustmentIterations - 代币数量调整迭代次数 ⭐ 额外字段
 *   - 二分查找算法调整代币数量的迭代次数
 *   - 用于评估计算精度
 *
 * @throws {Error} 当缺少必需参数时
 * @throws {Error} 当无法获取价格或订单数据时
 * @throws {Error} 当无法计算代币数量时
 *
 * @example
 * // 基础用法: 投入 0.1 SOL 做空,止损价格为当前价格的103%
 * const result = await sdk.simulator.simulateShortSolStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   100000000n,                                        // 0.1 SOL (精度10^9)
 *   BigInt('103000000000000000000')                    // 止损价格
 * );
 *
 * console.log(`卖出代币数量: ${result.sellTokenAmount}`);
 * console.log(`预估保证金: ${result.estimatedMargin} lamports`);
 * console.log(`插入位置索引: ${result.close_insert_indices}`);
 *
 * @see {@link simulateShortStopLoss} 基于代币数量的做空止损计算
 * @see {@link simulateLongSolStopLoss} 基于SOL金额的做多止损计算
 * @since 2.0.0
 * @version 2.0.0 - 从返回 prev_order_pda/next_order_pda 改为返回 close_insert_indices
 */
async function simulateShortSolStopLoss(mint, sellSolAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
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

        console.log("simulateShortSolStopLoss lastPrice=",lastPrice)

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
            const currentResult = await simulateShortStopLoss.call(this, mint, mid, stopLossPrice, lastPrice, ordersData, borrowFee);
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
            stopLossResult = await simulateShortStopLoss.call(this, mint, sellTokenAmount, stopLossPrice, lastPrice, ordersData, borrowFee);
        }

        // if (iterations >= maxIterations) {
        //     //console.warn(`simulateShortSolStopLoss: Reached maximum iterations (${maxIterations}), tradeAmount=${stopLossResult.tradeAmount}, target=${sellSolAmount}`);
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
    simulateShortStopLoss,
    simulateLongSolStopLoss,
    simulateShortSolStopLoss
};