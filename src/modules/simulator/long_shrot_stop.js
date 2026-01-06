
const CurveAMM = require('../../utils/curve_amm');
const {transformOrdersData , checkPriceRangeOverlap} = require('./stop_loss_utils')
const { PRICE_ADJUSTMENT_PERCENTAGE, MIN_STOP_LOSS_PERCENT } = require('./utils');
const JSONbig = require('json-bigint')({ storeAsString: false });

/**
 * Simulate long position stop loss calculation
 *
 * Simulates the stop loss calculation for a long position, returning the executable stop loss price
 * and relevant parameters. The function automatically adjusts the stop loss price to avoid overlapping
 * with existing order price ranges and returns an array of insertion position indices needed for contract execution.
 *
 * @param {string} mint - Token address
 * @param {bigint|string|number} buyTokenAmount - Token amount to buy for long position (u64 format, precision 10^9)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token current price info, default null will auto-fetch
 * @param {Object|null} ordersData - Orders data, default null will auto-fetch
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result object
 * @returns {bigint} returns.executableStopLossPrice - Calculated executable stop loss price (u128 format)
 *   - This is the adjusted stop loss price that does not overlap with existing orders
 *   - May be lower than user-input stopLossPrice (due to overlap avoidance)
 *   - Can be directly used for sdk.trading.long() closePrice parameter
 *
 * @returns {bigint} returns.tradeAmount - Estimated SOL output from selling at stop loss (lamports)
 *   - This is the SOL received when selling buyTokenAmount tokens at executableStopLossPrice
 *   - Does not include fee deductions
 *   - Used to estimate profit at stop loss
 *
 * @returns {number} returns.stopLossPercentage - Stop loss percentage (relative to current price)
 *   - Calculation: ((currentPrice - executableStopLossPrice) / currentPrice) * 100
 *   - Example: 3.5 means stop loss is 3.5% below current price
 *   - For long positions, this should be a positive number (stop loss below current price)
 *
 * @returns {number} returns.leverage - Leverage multiplier
 *   - Calculation: currentPrice / (currentPrice - executableStopLossPrice)
 *   - Example: 28.57 means approximately 28.57x leverage
 *   - Higher leverage means higher risk but also higher potential returns
 *
 * @returns {bigint} returns.currentPrice - Current price (u128 format)
 *   - Token current price used in calculation
 *   - Used for reference and verification
 *
 * @returns {number} returns.iterations - Number of price adjustment iterations
 *   - How many times the function automatically adjusted the stop loss price to avoid overlaps
 *   - Each adjustment decreases the price by PRICE_ADJUSTMENT_PERCENTAGE (default 0.5%)
 *   - High iteration count may indicate need to re-select stop loss price
 *
 * @returns {bigint} returns.originalStopLossPrice - Original stop loss price from user input (u128 format)
 *   - Used to compare price difference before and after adjustment
 *   - Large difference from executableStopLossPrice indicates dense existing orders
 *
 * @returns {number[]} returns.close_insert_indices - Candidate insertion indices for closing order
 *   - Array containing OrderBook index values for multiple candidate insertion positions
 *   - Structure: [main position index, before 1, after 1, before 2, after 2, before 3, after 3]
 *   - Example: [25, 10, 33, 5, 40, 2, 50] means main position is 25, with alternatives 10, 33, etc.
 *   - Contains at most 7 index values (1 main + 3 before + 3 after)
 *   - Returns [65535] (u16::MAX) if order book is empty, indicating insertion at head
 *   - Usage: Pass to sdk.trading.long() closeInsertIndices parameter
 *   - Increases success rate: even if main order is deleted, contract can try other candidates
 *
 * @returns {bigint} returns.estimatedMargin - Estimated required margin (SOL lamports)
 *   - Calculation: buy cost - close proceeds (after fee deduction)
 *   - This is the minimum margin needed to execute this stop loss strategy
 *   - Can be used for sdk.trading.long() marginSolMax parameter
 *   - Recommend adding 10-20% buffer in actual calls to handle price volatility
 *
 * @throws {Error} When required parameters are missing
 * @throws {Error} When unable to fetch price or order data
 * @throws {Error} When maximum iterations reached without finding suitable stop loss price
 * @throws {Error} When price adjustment results in negative value
 *
 * @example
 * // Basic usage: long 1 token with stop loss at 97% of current price
 * const result = await sdk.simulator.simulateLongStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   1000000000n,                                       // 1 token (precision 10^9)
 *   BigInt('97000000000000000000')                     // stop loss price
 * );
 *
 * console.log(`Executable stop loss price: ${result.executableStopLossPrice}`);
 * console.log(`Stop loss percentage: ${result.stopLossPercentage}%`);
 * console.log(`Leverage multiplier: ${result.leverage}x`);
 * console.log(`Estimated margin: ${result.estimatedMargin} lamports`);
 * console.log(`Insertion position indices: ${result.close_insert_indices}`);
 *
 * @example
 * // Complete usage flow: simulate then execute long position
 * async function openLongPosition(sdk, mint, buyTokenAmount, stopLossPrice) {
 *   // 1. Simulate stop loss calculation
 *   const simulation = await sdk.simulator.simulateLongStopLoss(
 *     mint,
 *     buyTokenAmount,
 *     stopLossPrice
 *   );
 *
 *   // 2. Check if stop loss price was significantly adjusted
 *   const priceDiff = Number((simulation.originalStopLossPrice - simulation.executableStopLossPrice) * 10000n / simulation.originalStopLossPrice) / 100;
 *   if (priceDiff > 1.0) {
 *     console.warn(`Stop loss price adjusted by ${priceDiff}%, current orders are dense`);
 *   }
 *
 *   // 3. Prepare transaction parameters
 *   const maxSolAmount = simulation.estimatedMargin * 120n / 100n; // Add 20% buffer
 *   const marginSolMax = simulation.estimatedMargin * 115n / 100n; // Add 15% buffer
 *
 *   // 4. Execute long position transaction
 *   const tx = await sdk.trading.long({
 *     mint: mint,
 *     buyTokenAmount: buyTokenAmount,
 *     maxSolAmount: maxSolAmount,
 *     marginSolMax: marginSolMax,
 *     closePrice: simulation.executableStopLossPrice,
 *     closeInsertIndices: simulation.close_insert_indices  // Use new indices array
 *   });
 *
 *   return tx;
 * }
 *
 * @see {@link simulateShortStopLoss} Short position stop loss calculation
 * @see {@link simulateLongSolStopLoss} Long position stop loss calculation based on SOL amount
 * @since 2.0.0
 * @version 2.0.0 - Changed from returning prev_order_pda/next_order_pda to returning close_insert_indices
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
        console.log("simulateLongStopLoss lastPrice=", lastPrice)

        // Get ordersData
        if (!ordersData) {
            //console.log('Getting orders data...');
            ordersData = await this.sdk.data.orders(mint, { type: 'down_orders' });
            if (!ordersData || !ordersData.success) {
                throw new Error('Failed to get orders data');
            }
        }

        //console.log("ordersData=", JSONbig.stringify(ordersData, null, 2))
        console.log("ordersData length=", ordersData.data.orders.length)

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
        console.log(`Found ${downOrders.length} existing long orders`);
        //console.log("downOrders=", downOrders)

        // Initialize stop loss prices
        let stopLossStartPrice = BigInt(stopLossPrice);
        let stopLossEndPrice;
        let maxIterations = 1000; // Prevent infinite loop
        let iteration = 0;
        let finalOverlapResult = null; // Record final overlap result
        let finalTradeAmount = 0n; // Record final trade amount

        // Check and adjust stop loss price to meet minimum distance requirement
        // For long: stop loss must be below current price by at least MIN_STOP_LOSS_PERCENT
        const minAllowedStopLoss = currentPrice - (currentPrice * BigInt(MIN_STOP_LOSS_PERCENT)) / 1000n;
        if (stopLossStartPrice > minAllowedStopLoss) {
            const originalStopLoss = stopLossStartPrice;
            stopLossStartPrice = minAllowedStopLoss;
            const originalPercent = Number((currentPrice - originalStopLoss) * 1000n / currentPrice) / 10;
            const adjustedPercent = Number((currentPrice - stopLossStartPrice) * 1000n / currentPrice) / 10;
            console.log(`Stop loss price automatically adjusted to meet minimum distance requirement:`);
            console.log(`  Original stop loss distance: ${originalPercent.toFixed(2)}%`);
            console.log(`  Adjusted distance: ${adjustedPercent.toFixed(2)}% (minimum requirement: ${Number(MIN_STOP_LOSS_PERCENT) / 10}%)`);
            console.log(`  Original stop loss price: ${originalStopLoss}`);
            console.log(`  Adjusted stop loss price: ${stopLossStartPrice}`);
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
            const tradeAmount = tradeResult[1]; // SOL output amount

            // console.log(`  - stopLossEndPrice: ${stopLossEndPrice.toString()}`);
            // console.log(`  - tradeAmount: ${tradeAmount.toString()}`);

            //console.log(`Iteration ${iteration}: Start=${stopLossStartPrice}, End=${stopLossEndPrice}, SOL output=${tradeAmount}`);

            // Check price range overlap
            const overlapResult = checkPriceRangeOverlap('down_orders', downOrders, stopLossStartPrice, stopLossEndPrice);

            if (overlapResult.no_overlap) {
                //console.log('No price range overlap, can execute');
                finalOverlapResult = overlapResult; // Record final overlap result
                finalTradeAmount = tradeAmount; // Record final trade amount
                break;
            }

            //console.log(`Found overlap: ${overlapResult.overlap_reason}`);

            // Adjust start price (decrease by PRICE_ADJUSTMENT_PERCENTAGE)
            const adjustmentAmount = (stopLossStartPrice * BigInt(PRICE_ADJUSTMENT_PERCENTAGE)) / 1000n;
            stopLossStartPrice = stopLossStartPrice - adjustmentAmount;

            //console.log(`Adjusted start price: ${stopLossStartPrice}`);

            // Safety check: ensure price doesn't become negative
            if (stopLossStartPrice <= 0n) {
                throw new Error('Stop loss price became negative after adjustment, cannot continue');
            }
        }

        if (iteration >= maxIterations) {
            throw new Error('Reached maximum iterations, cannot find suitable stop loss price');
        }

        // Calculate final return values
        const executableStopLossPrice = stopLossStartPrice;

        // Calculate stop loss percentage
        let stopLossPercentage = 0;
        let leverage = 1;

        if (currentPrice !== executableStopLossPrice) {
            stopLossPercentage = Number((BigInt(10000) * (currentPrice - executableStopLossPrice)) / currentPrice) / 100;
            leverage = Number((BigInt(10000) * currentPrice) / (currentPrice - executableStopLossPrice)) / 10000;
        }

        // Calculate margin requirement
        let estimatedMargin = 0n;
        try {
            // 1. Calculate SOL needed to buy from current price
            const buyResult = CurveAMM.buyFromPriceWithTokenOutput(currentPrice, buyTokenAmount);
            if (buyResult) {
                const requiredSol = buyResult[1]; // SOL input amount

                // 2. Calculate proceeds at close after fee deduction
                const closeOutputSolAfterFee = CurveAMM.calculateAmountAfterFee(finalTradeAmount, borrowFee);

                // 3. Calculate margin = buy cost - close proceeds (after fee)
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
 * Simulates the stop loss calculation for a short position, returning the executable stop loss price
 * and relevant parameters. The function automatically adjusts the stop loss price to avoid overlapping
 * with existing order price ranges and returns an array of insertion position indices needed for contract execution.
 *
 * @param {string} mint - Token address
 * @param {bigint|string|number} sellTokenAmount - Token amount to sell for short position (u64 format, precision 10^9)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token current price info, default null will auto-fetch
 * @param {Object|null} ordersData - Orders data, default null will auto-fetch
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result object
 * @returns {bigint} returns.executableStopLossPrice - Calculated executable stop loss price (u128 format)
 *   - This is the adjusted stop loss price that does not overlap with existing orders
 *   - May be higher than user-input stopLossPrice (due to overlap avoidance)
 *   - Can be directly used for sdk.trading.short() closePrice parameter
 *
 * @returns {bigint} returns.tradeAmount - Estimated SOL cost to close at stop loss (lamports)
 *   - This is the SOL needed to buy back sellTokenAmount tokens at executableStopLossPrice
 *   - Does not include fees
 *   - Used to estimate cost at stop loss
 *
 * @returns {number} returns.stopLossPercentage - Stop loss percentage (relative to current price)
 *   - Calculation: ((executableStopLossPrice - currentPrice) / currentPrice) * 100
 *   - Example: 3.5 means stop loss is 3.5% above current price
 *   - For short positions, this should be a positive number (stop loss above current price)
 *
 * @returns {number} returns.leverage - Leverage multiplier
 *   - Calculation: currentPrice / (executableStopLossPrice - currentPrice)
 *   - Example: 28.57 means approximately 28.57x leverage
 *   - Higher leverage means higher risk but also higher potential returns
 *
 * @returns {bigint} returns.currentPrice - Current price (u128 format)
 *   - Token current price used in calculation
 *   - Used for reference and verification
 *
 * @returns {number} returns.iterations - Number of price adjustment iterations
 *   - How many times the function automatically adjusted the stop loss price to avoid overlaps
 *   - Each adjustment increases the price by PRICE_ADJUSTMENT_PERCENTAGE (default 0.5%)
 *   - High iteration count may indicate need to re-select stop loss price
 *
 * @returns {bigint} returns.originalStopLossPrice - Original stop loss price from user input (u128 format)
 *   - Used to compare price difference before and after adjustment
 *   - Large difference from executableStopLossPrice indicates dense existing orders
 *
 * @returns {number[]} returns.close_insert_indices - Candidate insertion indices for closing order
 *   - Array containing OrderBook index values for multiple candidate insertion positions
 *   - Structure: [main position index, before 1, after 1, before 2, after 2, before 3, after 3]
 *   - Example: [25, 10, 33, 5, 40, 2, 50] means main position is 25, with alternatives 10, 33, etc.
 *   - Contains at most 7 index values (1 main + 3 before + 3 after)
 *   - Returns [65535] (u16::MAX) if order book is empty, indicating insertion at head
 *   - Usage: Pass to sdk.trading.short() closeInsertIndices parameter
 *   - Increases success rate: even if main order is deleted, contract can try other candidates
 *
 * @returns {bigint} returns.estimatedMargin - Estimated required margin (SOL lamports)
 *   - Calculation: close cost (with fee) - open proceeds - open fee
 *   - This is the minimum margin needed to execute this stop loss strategy
 *   - Can be used for sdk.trading.short() marginSolMax parameter
 *   - Recommend adding 10-20% buffer in actual calls to handle price volatility
 *
 * @throws {Error} When required parameters are missing
 * @throws {Error} When unable to fetch price or order data
 * @throws {Error} When maximum iterations reached without finding suitable stop loss price
 * @throws {Error} When price adjustment exceeds maximum value
 *
 * @example
 * // Basic usage: short 1 token with stop loss at 103% of current price
 * const result = await sdk.simulator.simulateShortStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   1000000000n,                                       // 1 token (precision 10^9)
 *   BigInt('103000000000000000000')                    // stop loss price
 * );
 *
 * console.log(`Executable stop loss price: ${result.executableStopLossPrice}`);
 * console.log(`Stop loss percentage: ${result.stopLossPercentage}%`);
 * console.log(`Leverage multiplier: ${result.leverage}x`);
 * console.log(`Estimated margin: ${result.estimatedMargin} lamports`);
 * console.log(`Insertion position indices: ${result.close_insert_indices}`);
 *
 * @example
 * // Complete usage flow: simulate then execute short position
 * async function openShortPosition(sdk, mint, sellTokenAmount, stopLossPrice) {
 *   // 1. Simulate stop loss calculation
 *   const simulation = await sdk.simulator.simulateShortStopLoss(
 *     mint,
 *     sellTokenAmount,
 *     stopLossPrice
 *   );
 *
 *   // 2. Check if stop loss price was significantly adjusted
 *   const priceDiff = Number((simulation.executableStopLossPrice - simulation.originalStopLossPrice) * 10000n / simulation.originalStopLossPrice) / 100;
 *   if (priceDiff > 1.0) {
 *     console.warn(`Stop loss price adjusted by ${priceDiff}%, current orders are dense`);
 *   }
 *
 *   // 3. Prepare transaction parameters
 *   const minSolOutput = simulation.tradeAmount * 80n / 100n; // Get at least 80%
 *   const marginSolMax = simulation.estimatedMargin * 115n / 100n; // Add 15% buffer
 *
 *   // 4. Execute short position transaction
 *   const tx = await sdk.trading.short({
 *     mint: mint,
 *     borrowSellTokenAmount: sellTokenAmount,
 *     minSolOutput: minSolOutput,
 *     marginSolMax: marginSolMax,
 *     closePrice: simulation.executableStopLossPrice,
 *     closeInsertIndices: simulation.close_insert_indices  // Use new indices array
 *   });
 *
 *   return tx;
 * }
 *
 * @see {@link simulateLongStopLoss} Long position stop loss calculation
 * @see {@link simulateShortSolStopLoss} Short position stop loss calculation based on SOL amount
 * @since 2.0.0
 * @version 2.0.0 - Changed from returning prev_order_pda/next_order_pda to returning close_insert_indices
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
        console.log("ordersData length=", ordersData.data.orders.length)

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
        console.log(`Found ${upOrders.length} existing short orders`);

        // Initialize stop loss prices
        let stopLossStartPrice = BigInt(stopLossPrice);
        let stopLossEndPrice;
        let maxIterations = 1000; // Prevent infinite loop
        let iteration = 0;
        let finalOverlapResult = null; // Record final overlap result
        let finalTradeAmount = 0n; // Record final trade amount

        // Check and adjust stop loss price to meet minimum distance requirement
        // For short: stop loss must be above current price by at least MIN_STOP_LOSS_PERCENT
        const minAllowedStopLoss = currentPrice + (currentPrice * BigInt(MIN_STOP_LOSS_PERCENT)) / 1000n;
        if (stopLossStartPrice < minAllowedStopLoss) {
            const originalStopLoss = stopLossStartPrice;
            stopLossStartPrice = minAllowedStopLoss;
            const originalPercent = Number((originalStopLoss - currentPrice) * 1000n / currentPrice) / 10;
            const adjustedPercent = Number((stopLossStartPrice - currentPrice) * 1000n / currentPrice) / 10;
            console.log(`Stop loss price automatically adjusted to meet minimum distance requirement:`);
            console.log(`  Original stop loss distance: ${originalPercent.toFixed(2)}%`);
            console.log(`  Adjusted distance: ${adjustedPercent.toFixed(2)}% (minimum requirement: ${Number(MIN_STOP_LOSS_PERCENT) / 10}%)`);
            console.log(`  Original stop loss price: ${originalStopLoss}`);
            console.log(`  Adjusted stop loss price: ${stopLossStartPrice}`);
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
            const tradeAmount = tradeResult[1]; // SOL input amount

            // console.log(`  - stopLossEndPrice: ${stopLossEndPrice.toString()}`);
            // console.log(`  - tradeAmount: ${tradeAmount.toString()}`);

            //console.log(`Iteration ${iteration}: Start=${stopLossStartPrice}, End=${stopLossEndPrice}, SOL input=${tradeAmount}`);

            // Check price range overlap
            const overlapResult = checkPriceRangeOverlap('up_orders', upOrders, stopLossStartPrice, stopLossEndPrice);

            if (overlapResult.no_overlap) {
                //console.log('No price range overlap, can execute');
                finalOverlapResult = overlapResult; // Record final overlap result
                finalTradeAmount = tradeAmount; // Record final trade amount
                break;
            }

            //console.log(`Found overlap: ${overlapResult.overlap_reason}`);

            // Adjust start price (increase by PRICE_ADJUSTMENT_PERCENTAGE)
            const adjustmentAmount = (stopLossStartPrice * BigInt(PRICE_ADJUSTMENT_PERCENTAGE)) / 1000n;
            stopLossStartPrice = stopLossStartPrice + adjustmentAmount;

            //console.log(`Adjusted start price: ${stopLossStartPrice}`);

            // Safety check: ensure price doesn't exceed maximum
            if (stopLossStartPrice >= CurveAMM.MAX_U128_PRICE) {
                throw new Error(`Stop loss price exceeded maximum after adjustment: ${stopLossStartPrice} >= ${CurveAMM.MAX_U128_PRICE}`);
            }
        }

        if (iteration >= maxIterations) {
            throw new Error('Reached maximum iterations, cannot find suitable stop loss price');
        }

        // Calculate final return values
        const executableStopLossPrice = stopLossStartPrice;

        // Calculate stop loss percentage
        // For short position, stop loss price is higher than current price, so it's a positive percentage
        const stopLossPercentage = Number((BigInt(10000) * (executableStopLossPrice - currentPrice)) / currentPrice) / 100;

        // Calculate leverage ratio
        // For short position, leverage = current price / (stop loss price - current price)
        const leverage = Number((BigInt(10000) * currentPrice) / (executableStopLossPrice - currentPrice)) / 10000;

        // Calculate margin requirement
        let estimatedMargin = 0n;
        try {
            // 1. Calculate SOL received from selling tokens at current price (opening proceeds, no fee)
            const sellResult = CurveAMM.sellFromPriceWithTokenInput(currentPrice, sellTokenAmount);
            if (sellResult) {
                const openingSolGain = sellResult[1]; // SOL received from sale

                // 2. Calculate opening fee
                const openingFee = (openingSolGain * BigInt(borrowFee)) / 100000n;

                // 3. Calculate close cost (including fee)
                const feeAmount = (finalTradeAmount * BigInt(borrowFee)) / 100000n;
                const closeCostWithFee = finalTradeAmount + feeAmount;

                // 4. Calculate margin = close cost (with fee) - opening proceeds - opening fee
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
 * Long position stop loss calculation based on SOL amount. The function automatically calculates
 * the corresponding token quantity so that the margin requirement is close to the user-input SOL amount.
 *
 * @param {string} mint - Token address
 * @param {bigint|string|number} buySolAmount - SOL amount to spend for long position (u64 format, lamports)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token current price info, default null will auto-fetch
 * @param {Object|null} ordersData - Orders data, default null will auto-fetch
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result object
 * @returns {bigint} returns.executableStopLossPrice - Executable stop loss price (u128 format) - Same as {@link simulateLongStopLoss}
 * @returns {bigint} returns.tradeAmount - Estimated SOL output from selling at stop loss (lamports) - Same as {@link simulateLongStopLoss}
 * @returns {number} returns.stopLossPercentage - Stop loss percentage - Same as {@link simulateLongStopLoss}
 * @returns {number} returns.leverage - Leverage multiplier - Same as {@link simulateLongStopLoss}
 * @returns {bigint} returns.currentPrice - Current price (u128 format) - Same as {@link simulateLongStopLoss}
 * @returns {number} returns.iterations - Number of price adjustment iterations - Same as {@link simulateLongStopLoss}
 * @returns {bigint} returns.originalStopLossPrice - Original stop loss price (u128 format) - Same as {@link simulateLongStopLoss}
 * @returns {number[]} returns.close_insert_indices - Candidate insertion indices for closing order - Same as {@link simulateLongStopLoss}
 * @returns {bigint} returns.estimatedMargin - Estimated required margin (SOL lamports) - Same as {@link simulateLongStopLoss}
 * @returns {bigint} returns.buyTokenAmount - Calculated token amount to buy (additional field)
 *   - This is the token quantity calculated backwards from buySolAmount
 *   - So that estimatedMargin is close to buySolAmount
 *   - Can be directly used for sdk.trading.long() buyTokenAmount parameter
 * @returns {number} returns.adjustmentIterations - Token amount adjustment iterations (additional field)
 *   - Number of iterations of binary search algorithm adjusting token quantity
 *   - Used to evaluate calculation precision
 *
 * @throws {Error} When required parameters are missing
 * @throws {Error} When unable to fetch price or order data
 * @throws {Error} When unable to calculate token quantity
 *
 * @example
 * // Basic usage: invest 0.1 SOL in long position with stop loss at 97% of current price
 * const result = await sdk.simulator.simulateLongSolStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   100000000n,                                        // 0.1 SOL (precision 10^9)
 *   BigInt('97000000000000000000')                     // stop loss price
 * );
 *
 * console.log(`Token amount to buy: ${result.buyTokenAmount}`);
 * console.log(`Estimated margin: ${result.estimatedMargin} lamports`);
 * console.log(`Insertion position indices: ${result.close_insert_indices}`);
 *
 * @see {@link simulateLongStopLoss} Long position stop loss calculation based on token amount
 * @see {@link simulateShortSolStopLoss} Short position stop loss calculation based on SOL amount
 * @since 2.0.0
 * @version 2.0.0 - Changed from returning prev_order_pda/next_order_pda to returning close_insert_indices
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

        // Use binary search algorithm to find maximum estimatedMargin that is less than buySolAmount
        let left = 1n; // Minimum value to ensure valid lower bound
        let right = buyTokenAmount * 10n; // Upper bound: 10x initial value
        let bestResult = null;
        let bestMargin = 0n; // Record maximum legal estimatedMargin
        let bestTokenAmount = buyTokenAmount;

        // Binary search main loop: find maximum estimatedMargin < buySolAmount
        while (iterations < maxIterations && left <= right) {
            const mid = (left + right) / 2n;

            // Calculate result for current token amount
            const currentResult = await simulateLongStopLoss.call(this, mint, mid, stopLossPrice, lastPrice, ordersData, borrowFee);
            const currentMargin = currentResult.estimatedMargin;

            //console.log(`Binary search iteration ${iterations}: tokenAmount=${mid}, estimatedMargin=${currentMargin}, target=${buySolAmount}`);

            // Only consider estimatedMargin < buySolAmount cases
            if (currentMargin < BigInt(buySolAmount)) {
                // This is a valid solution, check if better than current best
                if (currentMargin > bestMargin) {
                    bestMargin = currentMargin;
                    bestResult = currentResult;
                    bestTokenAmount = mid;
                    //console.log(`Found better solution: estimatedMargin=${currentMargin}, tokenAmount=${mid}`);
                }

                // If gap is very small (< 10000000 lamports from target), can exit early
                if (BigInt(buySolAmount) - currentMargin <= 10000000n) {
                    //console.log(`Found optimal solution: estimatedMargin=${currentMargin}, diff=${BigInt(buySolAmount) - currentMargin} (< 10000000 lamports tolerance)`);
                    break;
                }

                // Continue searching right for larger legal values
                left = mid + 1n;
            } else {
                // estimatedMargin >= buySolAmount, need to reduce tokenAmount
                //console.log(`estimatedMargin too large (${currentMargin} >= ${buySolAmount}), searching left`);
                right = mid - 1n;
            }

            iterations++;
        }

        // Ensure found result meets requirements
        if (bestResult && bestMargin < BigInt(buySolAmount)) {
            stopLossResult = bestResult;
            buyTokenAmount = bestTokenAmount;
            //console.log(`Binary search completed: best tokenAmount=${bestTokenAmount}, estimatedMargin=${bestMargin}, target=${buySolAmount}`);
        } else {
            // If no valid solution found, use very small tokenAmount as safe fallback
            //console.log(`No valid solution found (estimatedMargin < buySolAmount), using minimal tokenAmount`);
            buyTokenAmount = buyTokenAmount / 10n; // Use smaller value
            if (buyTokenAmount <= 0n) buyTokenAmount = 1000000000n; // Minimum protection (0.001 token with 9 decimals)
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
 * Short position stop loss calculation based on SOL amount. The function automatically calculates
 * the corresponding token quantity so that the margin requirement is close to the user-input SOL amount.
 *
 * @param {string} mint - Token address
 * @param {bigint|string|number} sellSolAmount - SOL amount needed for short position stop loss (u64 format, lamports)
 * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
 * @param {Object|null} lastPrice - Token current price info, default null will auto-fetch
 * @param {Object|null} ordersData - Orders data, default null will auto-fetch
 * @param {number} borrowFee - Borrow fee rate, default 2000 (2000/100000 = 0.02%)
 *
 * @returns {Promise<Object>} Stop loss analysis result object
 * @returns {bigint} returns.executableStopLossPrice - Executable stop loss price (u128 format) - Same as {@link simulateShortStopLoss}
 * @returns {bigint} returns.tradeAmount - Estimated SOL needed to close at stop loss (lamports) - Same as {@link simulateShortStopLoss}
 * @returns {number} returns.stopLossPercentage - Stop loss percentage - Same as {@link simulateShortStopLoss}
 * @returns {number} returns.leverage - Leverage multiplier - Same as {@link simulateShortStopLoss}
 * @returns {bigint} returns.currentPrice - Current price (u128 format) - Same as {@link simulateShortStopLoss}
 * @returns {number} returns.iterations - Number of price adjustment iterations - Same as {@link simulateShortStopLoss}
 * @returns {bigint} returns.originalStopLossPrice - Original stop loss price (u128 format) - Same as {@link simulateShortStopLoss}
 * @returns {number[]} returns.close_insert_indices - Candidate insertion indices for closing order - Same as {@link simulateShortStopLoss}
 * @returns {bigint} returns.estimatedMargin - Estimated required margin (SOL lamports) - Same as {@link simulateShortStopLoss}
 * @returns {bigint} returns.sellTokenAmount - Calculated token amount to sell (additional field)
 *   - This is the token quantity calculated backwards from sellSolAmount
 *   - So that estimatedMargin is close to sellSolAmount
 *   - Can be directly used for sdk.trading.short() borrowSellTokenAmount parameter
 * @returns {number} returns.adjustmentIterations - Token amount adjustment iterations (additional field)
 *   - Number of iterations of binary search algorithm adjusting token quantity
 *   - Used to evaluate calculation precision
 *
 * @throws {Error} When required parameters are missing
 * @throws {Error} When unable to fetch price or order data
 * @throws {Error} When unable to calculate token quantity
 *
 * @example
 * // Basic usage: invest 0.1 SOL in short position with stop loss at 103% of current price
 * const result = await sdk.simulator.simulateShortSolStopLoss(
 *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',  // mint
 *   100000000n,                                        // 0.1 SOL (precision 10^9)
 *   BigInt('103000000000000000000')                    // stop loss price
 * );
 *
 * console.log(`Token amount to sell: ${result.sellTokenAmount}`);
 * console.log(`Estimated margin: ${result.estimatedMargin} lamports`);
 * console.log(`Insertion position indices: ${result.close_insert_indices}`);
 *
 * @see {@link simulateShortStopLoss} Short position stop loss calculation based on token amount
 * @see {@link simulateLongSolStopLoss} Long position stop loss calculation based on SOL amount
 * @since 2.0.0
 * @version 2.0.0 - Changed from returning prev_order_pda/next_order_pda to returning close_insert_indices
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

        console.log("simulateShortSolStopLoss lastPrice=", lastPrice)

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

        // Use binary search algorithm to find maximum estimatedMargin that is less than sellSolAmount
        let left = 1n; // Minimum value to ensure valid lower bound
        let right = sellTokenAmount * 10n; // Upper bound: 10x initial value
        let bestResult = null;
        let bestMargin = 0n; // Record maximum legal estimatedMargin
        let bestTokenAmount = sellTokenAmount;

        // Binary search main loop: find maximum estimatedMargin < sellSolAmount
        while (iterations < maxIterations && left <= right) {
            const mid = (left + right) / 2n;

            // Calculate result for current token amount
            const currentResult = await simulateShortStopLoss.call(this, mint, mid, stopLossPrice, lastPrice, ordersData, borrowFee);
            const currentMargin = currentResult.estimatedMargin;

            //console.log(`Binary search iteration ${iterations}: tokenAmount=${mid}, estimatedMargin=${currentMargin}, target=${sellSolAmount}`);

            // Only consider estimatedMargin < sellSolAmount cases
            if (currentMargin < BigInt(sellSolAmount)) {
                // This is a valid solution, check if better than current best
                if (currentMargin > bestMargin) {
                    bestMargin = currentMargin;
                    bestResult = currentResult;
                    bestTokenAmount = mid;
                    //console.log(`Found better solution: estimatedMargin=${currentMargin}, tokenAmount=${mid}`);
                }

                // If gap is very small (< 10000000 lamports from target), can exit early
                if (BigInt(sellSolAmount) - currentMargin <= 10000000n) {
                    //console.log(`Found optimal solution: estimatedMargin=${currentMargin}, diff=${BigInt(sellSolAmount) - currentMargin} (< 10000000 lamports tolerance)`);
                    break;
                }

                // Continue searching right for larger legal values
                left = mid + 1n;
            } else {
                // estimatedMargin >= sellSolAmount, need to reduce tokenAmount
                //console.log(`estimatedMargin too large (${currentMargin} >= ${sellSolAmount}), searching left`);
                right = mid - 1n;
            }

            iterations++;
        }

        // Ensure found result meets requirements
        if (bestResult && bestMargin < BigInt(sellSolAmount)) {
            stopLossResult = bestResult;
            sellTokenAmount = bestTokenAmount;
            //console.log(`Binary search completed: best tokenAmount=${bestTokenAmount}, estimatedMargin=${bestMargin}, target=${sellSolAmount}`);
        } else {
            // If no valid solution found, use very small tokenAmount as safe fallback
            //console.log(`No valid solution found (estimatedMargin < sellSolAmount), using minimal tokenAmount`);
            sellTokenAmount = sellTokenAmount / 10n; // Use smaller value
            if (sellTokenAmount <= 0n) sellTokenAmount = 1000000000n; // Minimum protection (0.001 token with 9 decimals)
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