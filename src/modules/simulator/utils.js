

// Liquidity reservation ratio - how much liquidity to reserve relative to the last locked liquidity
const LIQUIDITY_RESERVATION = 100;  // 100%

// Price adjustment percentage
const PRICE_ADJUSTMENT_PERCENTAGE = 15; //  5就是 0.5%

// Minimum stop loss percentage - stop loss price must be at least this far from current price
// 最小止损百分比 - 止损价格必须与当前价格至少相差此百分比
// Example: 40 means 4.0% (calculation: 40/1000 = 0.04 = 4%)
const MIN_STOP_LOSS_PERCENT = 40; // 4.0%

// Maximum number of candidate indices to include in close_insert_indices
// This represents: 1 main position + N nodes before + N nodes after
// Must be an odd number >= 1 (e.g., 21 = 1 main + 10 before + 10 after)
// The contract accepts up to 20, we use 21 to provide more flexibility
const MAX_CANDIDATE_INDICES = 15;


// Validate MAX_CANDIDATE_INDICES constant
if (MAX_CANDIDATE_INDICES < 1 || MAX_CANDIDATE_INDICES % 2 === 0) {
    throw new Error(`MAX_CANDIDATE_INDICES must be an odd number >= 1, got ${MAX_CANDIDATE_INDICES}`);
}


/**
 * Convert API order format to expected format
 * @param {Array} apiOrders - Orders returned from API
 * @returns {Array} Converted order list
 */
function convertApiOrdersFormat(apiOrders) {
    if (!apiOrders || !Array.isArray(apiOrders)) {
        return [];
    }

    return apiOrders.map(order => ({
        ...order,
        lockLpStartPrice: order.lock_lp_start_price,
        lockLpEndPrice: order.lock_lp_end_price
    }));
}


/**
 * Handle BigInt absolute value
 * @param {BigInt} value - BigInt value to calculate absolute value
 * @returns {BigInt} Absolute value result
 */
function absoluteValue(value) {
    return value < 0n ? -value : value;
}



module.exports = {
    convertApiOrdersFormat,
    absoluteValue,
    LIQUIDITY_RESERVATION,
    PRICE_ADJUSTMENT_PERCENTAGE,
    MIN_STOP_LOSS_PERCENT,
    MAX_CANDIDATE_INDICES
};