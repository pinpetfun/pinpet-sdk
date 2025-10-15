const CurveAMM = require('../utils/curve_amm');
const { simulateLongStopLoss, simulateSellStopLoss, simulateLongSolStopLoss, simulateSellSolStopLoss } = require('./simulator/long_shrot_stop');
const { simulateTokenBuy, simulateTokenSell } = require('./simulator/buy_sell_token');




/**
 * Simulator Module Class
 */
class SimulatorModule {
    constructor(sdk) {
        this.sdk = sdk;

        // Liquidity reservation ratio - how much liquidity to reserve relative to the last locked liquidity
        this.LIQUIDITY_RESERVATION = 100; // 100%;
        // Price adjustment percentage
        this.PRICE_ADJUSTMENT_PERCENTAGE = 0.5; // 0.5%
    }

    /**
     * Simulate token buy transaction - calculate if target token amount can be purchased
     * 模拟以 Token 数量为目标的买入交易 - 计算是否能买到指定数量的 Token
     * @param {string} mint - Token address 代币地址
     * @param {bigint|string|number} buyTokenAmount - Target token amount to buy 目标购买的 Token 数量
     * @param {string} passOrder - Optional order address to skip (won't be liquidated) 可选的跳过订单地址
     * @param {Object|null} lastPrice - Token price info, default null
     * @param {Object|null} ordersData - Orders response object, default null
     * @returns {Promise<Object>} Token buy simulation result with the following structure:
     *   - liqResult: {Object} Complete liquidity calculation result from calcLiqTokenBuy, containing:
     *     - free_lp_sol_amount_sum: {bigint} Total available free liquidity SOL amount
     *     - free_lp_token_amount_sum: {bigint} Total available free liquidity token amount
     *     - lock_lp_sol_amount_sum: {bigint} Total locked liquidity SOL amount
     *     - lock_lp_token_amount_sum: {bigint} Total locked liquidity token amount
     *     - has_infinite_lp: {boolean} Whether includes infinite liquidity beyond last order
     *     - pass_order_id: {number} Index of skipped order in array (-1 if none skipped)
     *     - force_close_num: {number} Number of orders that need force closure for target amount
     *     - ideal_lp_sol_amount: {bigint} Theoretical minimum SOL required at current price
     *     - real_lp_sol_amount: {bigint} Actual SOL required considering real liquidity distribution
     *   - completion: {string} Purchase completion percentage as decimal string (e.g., "85.2", "100.0")
     *   - slippage: {string} Price slippage percentage as decimal string (e.g., "2.5", "0.8")
     *   - suggestedTokenAmount: {string} Recommended token amount to buy based on available liquidity
     *   - suggestedSolAmount: {string} Required SOL amount for suggested token purchase
     */
    async simulateTokenBuy(mint, buyTokenAmount, passOrder = null, lastPrice = null, ordersData = null) {
        return simulateTokenBuy.call(this, mint, buyTokenAmount, passOrder, lastPrice, ordersData);
    }

    /**
     * Simulate token sell transaction analysis
     * @param {string} mint - Token address
     * @param {bigint|string|number} sellTokenAmount - Token amount to sell (u64 format, precision 10^6)
     * @param {string} passOrder - Optional order address to skip (won't be liquidated) 可选的跳过订单地址
     * @param {Object|null} lastPrice - Token price info, default null
     * @param {Object|null} ordersData - Orders response object, default null
     * @returns {Promise<Object>} Token sell simulation result with the following structure:
     *   - liqResult: {Object} Complete liquidity calculation result from calcLiqTokenSell, containing:
     *     - free_lp_sol_amount_sum: {bigint} Total available free liquidity SOL obtainable from selling
     *     - free_lp_token_amount_sum: {bigint} Maximum tokens sellable without force closing orders
     *     - lock_lp_sol_amount_sum: {bigint} Total locked liquidity SOL amount (excluding skipped orders)
     *     - lock_lp_token_amount_sum: {bigint} Total locked liquidity token amount (excluding skipped orders)
     *     - has_infinite_lp: {boolean} Whether includes infinite liquidity to minimum price
     *     - pass_order_id: {number} Index of skipped order in array (-1 if none skipped)
     *     - force_close_num: {number} Number of orders that need force closure for target sell amount
     *     - ideal_lp_sol_amount: {bigint} Theoretical maximum SOL obtainable at current price
     *     - real_lp_sol_amount: {bigint} Actual SOL obtainable considering real liquidity distribution
     *   - completion: {string} Sell completion percentage as decimal string (e.g., "85.2", "100.0")
     *   - slippage: {string} Price slippage percentage as decimal string (e.g., "2.5", "0.8")
     *   - suggestedTokenAmount: {string} Recommended token amount to sell based on available liquidity
     *   - suggestedSolAmount: {string} Expected SOL amount from suggested token sale
     */
    async simulateTokenSell(mint, sellTokenAmount, passOrder = null, lastPrice = null, ordersData = null) {
        return simulateTokenSell.call(this, mint, sellTokenAmount, passOrder, lastPrice, ordersData);
    }

    /**
     * Simulate long position stop loss calculation
     * @param {string} mint - Token address
     * @param {bigint|string|number} buyTokenAmount - Token amount to buy for long position (u64 format, precision 10^6)
     * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
     * @param {Object|null} lastPrice - Token info, default null
     * @param {Object|null} ordersData - Orders data, default null
     * @returns {Promise<Object>} Stop loss analysis result
     */
    async simulateLongStopLoss(mint, buyTokenAmount, stopLossPrice, lastPrice = null, ordersData = null) {
        return simulateLongStopLoss.call(this, mint, buyTokenAmount, stopLossPrice, lastPrice, ordersData);
    }

    /**
     * Simulate short position stop loss calculation
     * @param {string} mint - Token address
     * @param {bigint|string|number} sellTokenAmount - Token amount to sell for short position (u64 format, precision 10^6)
     * @param {bigint|string|number} stopLossPrice - User desired stop loss price (u128 format)
     * @param {Object|null} lastPrice - Token info, default null
     * @param {Object|null} ordersData - Orders data, default null
     * @returns {Promise<Object>} Stop loss analysis result
     */
    async simulateSellStopLoss(mint, sellTokenAmount, stopLossPrice, lastPrice = null, ordersData = null) {
        return simulateSellStopLoss.call(this, mint, sellTokenAmount, stopLossPrice, lastPrice, ordersData);
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
    async simulateLongSolStopLoss(mint, buySolAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
        return simulateLongSolStopLoss.call(this, mint, buySolAmount, stopLossPrice, lastPrice, ordersData, borrowFee);
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
    async simulateSellSolStopLoss(mint, sellSolAmount, stopLossPrice, lastPrice = null, ordersData = null, borrowFee = 2000) {
        return simulateSellSolStopLoss.call(this, mint, sellSolAmount, stopLossPrice, lastPrice, ordersData, borrowFee);
    }

    
}

module.exports = SimulatorModule;
