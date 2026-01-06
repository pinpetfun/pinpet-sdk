
const { MAX_CANDIDATE_INDICES } = require('./utils');

// Liquidity reservation ratio - how much liquidity to reserve relative to the last locked liquidity
const LIQUIDITY_RESERVATION = 100;  // 100%

// Calculate number of nodes to include before and after the main position
const CANDIDATE_NODES_EACH_SIDE = Math.floor((MAX_CANDIDATE_INDICES - 1) / 2);

/**
 * Transform orders data format
 * @param {Object} ordersData - Raw orders data
 * @returns {Array} Transformed orders array
 */
function transformOrdersData(ordersData) {
  if (!ordersData || !ordersData.success || !ordersData.data || !ordersData.data.orders) {
    throw new Error('Invalid orders data format');
  }

  return ordersData.data.orders.map(order => ({
    order_type: order.order_type,
    lock_lp_start_price: BigInt(order.lock_lp_start_price),
    lock_lp_end_price: BigInt(order.lock_lp_end_price),
    lock_lp_sol_amount: order.lock_lp_sol_amount,
    lock_lp_token_amount: order.lock_lp_token_amount,
    index: order.index,           // Preserve OrderBook index
    order_id: order.order_id       // Preserve order ID
  }));
}

/**
 * @typedef {Object} Order
 * @property {number} order_type - Order type (e.g., 1 for down_orders, 2 for up_orders).
 * @property {bigint} lock_lp_start_price - Locked liquidity start price.
 * @property {bigint} lock_lp_end_price - Locked liquidity end price.
 * @property {number} lock_lp_sol_amount - Locked SOL amount.
 * @property {number} lock_lp_token_amount - Locked token amount.
 */

/**
 * @typedef {Object} OverlapResult
 * @property {boolean} no_overlap - Whether there is no overlap. `true` means no overlap (safe to insert), `false` means there is overlap.
 * @property {number[]} close_insert_indices - Array of position indices for inserting into order book at close. Contains main position index and indices of 3 nodes before and after.
 * @property {string} overlap_reason - Description of overlap reason. Empty string when no overlap, describes specific reason when overlap exists.
 */

/**
 * Check if a given price range overlaps with any range in a sorted order list,
 * and return appropriate insertion position indices.
 *
 * ## Function Description
 * This function is used for margin trading (long/short) scenarios. When opening a position,
 * it determines where the closing order should be inserted in the OrderBook.
 * The function checks if the new order's price range overlaps with existing orders and
 * returns multiple candidate insertion position indices to improve contract execution success rate.
 *
 * ## Core Logic
 * 1. **Price Range Check**: Uses binary search algorithm to find suitable insertion position in sorted order list
 * 2. **Overlap Detection**:
 *    - Basic overlap: new range directly overlaps with existing order's price range
 *    - Liquidity reservation overlap: considers liquidity reservation area (default 100%), prevents too-close ranges
 * 3. **Candidate Index Generation**:
 *    - Main insertion position: logically most suitable insertion position index
 *    - Alternative positions: indices of nodes before and after this position (quantity determined by MAX_CANDIDATE_INDICES)
 *    - Purpose: even if main position order is deleted or moved, contract can find other suitable positions
 *
 * ## Return Value Explanation
 * - **No overlap**: returns `close_insert_indices` array with OrderBook indices of candidate insertion positions
 *   - Priority: main position → before 1 → after 1 → before 2 → after 2 → ... → before N → after N
 *   - Index quantity determined by MAX_CANDIDATE_INDICES constant (default 21: main position + 10 before + 10 after)
 * - **With overlap**: returns empty array `[]`, indicating cannot insert
 * - **Empty order book**: returns `[65535]` (u16::MAX), indicating insert at head
 *
 * ## Order Type Rules
 * - **down_orders (long orders)**: prices sorted from high to low
 *   - lock_lp_start_price > lock_lp_end_price (price decreases)
 *   - New order's end_price must be >= next order's start_price
 * - **up_orders (short orders)**: prices sorted from low to high
 *   - lock_lp_start_price < lock_lp_end_price (price increases)
 *   - New order's end_price must be <= next order's start_price
 *
 * @param {'down_orders' | 'up_orders'} order_type - Order type
 *   - 'down_orders': long orders, prices sorted high to low
 *   - 'up_orders': short orders, prices sorted low to high
 *
 * @param {Order[]} order_list - Array of sorted order objects
 *   - Each order must contain:
 *     - `index` {number}: original index in OrderBook (critical field needed by contract)
 *     - `lock_lp_start_price` {bigint|string}: locked liquidity pool range start price
 *     - `lock_lp_end_price` {bigint|string}: locked liquidity pool range end price
 *   - Array must be sorted by price (down_orders high to low, up_orders low to high)
 *   - Usually from `sdk.chain.orders()` or `sdk.fast.orders()` return data
 *
 * @param {bigint | number | string} lp_start_price - New order start price
 *   - For down_orders: higher price (near opening price)
 *   - For up_orders: lower price (near stop loss price)
 *
 * @param {bigint | number | string} lp_end_price - New order end price
 *   - For down_orders: lower price (near stop loss price)
 *   - For up_orders: higher price (near opening price)
 *
 * @returns {OverlapResult} Object containing overlap check result and candidate insertion indices
 * @returns {boolean} returns.no_overlap - Whether there is no overlap
 *   - `true`: can safely insert, use indices in `close_insert_indices`
 *   - `false`: overlap exists, cannot insert
 * @returns {number[]} returns.close_insert_indices - Array of OrderBook indices for candidate insertion positions
 *   - No overlap: contains main position and 3 nodes before and after (max 7)
 *   - With overlap: empty array `[]`
 *   - Empty order book: `[65535]` indicating insert at head
 * @returns {string} returns.overlap_reason - Overlap reason description
 *   - No overlap: empty string `""`
 *   - With overlap: describes specific reason (e.g., "Overlaps with existing order range")
 *
 * @example
 * // Example 1: down_orders (long orders) - insert in middle position
 * const downOrders = [
 *   { index: 10, lock_lp_start_price: 100n, lock_lp_end_price: 90n },  // order 1
 *   { index: 25, lock_lp_start_price: 80n, lock_lp_end_price: 70n },   // order 2
 *   { index: 33, lock_lp_start_price: 60n, lock_lp_end_price: 50n }    // order 3
 * ];
 *
 * // Check if new order [75, 72] can be inserted
 * const result = checkPriceRangeOverlap('down_orders', downOrders, 75n, 72n);
 * console.log(result);
 * // Returns: {
 * //   no_overlap: true,
 * //   close_insert_indices: [25, 10, 33],
 * //   // Main position is 25 (order 2), new order should insert between order 2 and 3
 * //   // Alternatives: 10 (order 1 before), 33 (order 3 after)
 * //   overlap_reason: ""
 * // }
 *
 * @example
 * // Example 2: down_orders - price overlap case
 * const downOrders = [
 *   { index: 10, lock_lp_start_price: 100n, lock_lp_end_price: 90n },
 *   { index: 25, lock_lp_start_price: 80n, lock_lp_end_price: 70n }
 * ];
 *
 * // New order [95, 85] overlaps with order 1 [100, 90]
 * const result = checkPriceRangeOverlap('down_orders', downOrders, 95n, 85n);
 * console.log(result);
 * // Returns: {
 * //   no_overlap: false,
 * //   close_insert_indices: [],
 * //   overlap_reason: "Overlaps with existing order range"
 * // }
 *
 * @example
 * // Example 3: up_orders (short orders) - insert at end
 * const upOrders = [
 *   { index: 5, lock_lp_start_price: 70n, lock_lp_end_price: 80n },
 *   { index: 12, lock_lp_start_price: 90n, lock_lp_end_price: 100n }
 * ];
 *
 * // New order [110, 120] should be inserted at end
 * const result = checkPriceRangeOverlap('up_orders', upOrders, 110n, 120n);
 * console.log(result);
 * // Returns: {
 * //   no_overlap: true,
 * //   close_insert_indices: [12, 5],
 * //   // Main position is 12 (order 2), new order should insert after order 2
 * //   // Alternatives: 5 (order 1 before)
 * //   overlap_reason: ""
 * // }
 *
 * @example
 * // Example 4: empty order book - first order
 * const emptyOrders = [];
 * const result = checkPriceRangeOverlap('down_orders', emptyOrders, 100n, 90n);
 * console.log(result);
 * // Returns: {
 * //   no_overlap: true,
 * //   close_insert_indices: [65535],
 * //   // 65535 is u16::MAX, means insert at head (special value for empty order book)
 * //   overlap_reason: ""
 * // }
 *
 * @example
 * // Example 5: real usage scenario - long position
 * async function openLongPosition(sdk, mint, buyTokenAmount, stopLossPrice) {
 *   // 1. Get down_orders data
 *   const ordersData = await sdk.data.orders(mint, { type: 'down_orders' });
 *   const orders = ordersData.data.orders;
 *
 *   // 2. Get current price
 *   const currentPrice = BigInt(await sdk.data.price(mint));
 *
 *   // 3. Calculate close price range (simulation)
 *   const simulateResult = await sdk.simulator.simulateLongStopLoss(
 *     mint,
 *     buyTokenAmount,
 *     stopLossPrice
 *   );
 *
 *   // 4. Check if price range can be inserted
 *   const overlapCheck = checkPriceRangeOverlap(
 *     'down_orders',
 *     orders,
 *     simulateResult.close_lp_start_price,
 *     simulateResult.close_lp_end_price
 *   );
 *
 *   if (!overlapCheck.no_overlap) {
 *     throw new Error(`Cannot open position: ${overlapCheck.overlap_reason}`);
 *   }
 *
 *   // 5. Call contract with close_insert_indices
 *   const tx = await sdk.trading.long({
 *     mint,
 *     buyTokenAmount,
 *     maxSolAmount,
 *     marginSolMax,
 *     closePrice: stopLossPrice,
 *     closeInsertIndices: overlapCheck.close_insert_indices  // Pass to contract
 *   });
 *
 *   return tx;
 * }
 *
 * @throws {Error} When input start and end prices don't match order type rules
 *
 * @see {@link https://github.com/your-repo/docs/orderbook.md|OrderBook documentation}
 * @see {@link transformOrdersData} Data format conversion function
 *
 * @since 2.0.0
 * @version 2.0.0 - Changed from returning prev_order_pda/next_order_pda to returning close_insert_indices
 */
function checkPriceRangeOverlap(order_type, order_list, lp_start_price, lp_end_price) {
  // console.log("checkPriceRangeOverlap=",order_type,lp_start_price, lp_end_price)

  const startPrice = BigInt(lp_start_price);
  const endPrice = BigInt(lp_end_price);

  // If order list is empty, return u16::MAX to indicate insertion at head
  if (order_list.length === 0) {
    return { no_overlap: true, close_insert_indices: [65535], overlap_reason: "" };
  }

  const isDown = order_type === 'down_orders';

  // Validate and normalize input price range, ensure minPrice <= maxPrice
  if ((isDown && startPrice < endPrice) || (!isDown && startPrice > endPrice)) {
    throw new Error('Input start and end prices do not match order type rules.');
  }
  const minPrice = isDown ? endPrice : startPrice;
  const maxPrice = isDown ? startPrice : endPrice;

  let low = 0;
  let high = order_list.length - 1;
  let insertionIndex = order_list.length; // Default insert at the end

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const order = order_list[mid];
    const orderStart = BigInt(order.lock_lp_start_price);
    const orderEnd = BigInt(order.lock_lp_end_price);

    const orderMin = isDown ? orderEnd : orderStart;
    const orderMax = isDown ? orderStart : orderEnd;

    // Core overlap check: (StartA < EndB) and (EndA > StartB)
    if (minPrice < orderMax && maxPrice > orderMin) {
      // Basic overlap detected
      return {
        no_overlap: false,
        close_insert_indices: [],
        overlap_reason: "Overlaps with existing order range"
      };
    }

    if (isDown) {
      // down_orders: prices from high to low (orderMax decreases)
      if (maxPrice > orderMax) { // New range is to "left" of current range (higher price)
        insertionIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    } else {
      // up_orders: prices from low to high (orderMin increases)
      if (minPrice < orderMin) { // New range is to "left" of current range (lower price)
        insertionIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
  }

  // Based on found insertion point, determine logically previous and next orders
  // insertionIndex is where new range should be inserted so list remains sorted
  const nextOrder = order_list[insertionIndex] || null;
  const prevOrder = order_list[insertionIndex - 1] || null;

  // Check liquidity reservation overlap
  function checkLiquidityReservationOverlap(checkOrder) {
    if (!checkOrder) return false;

    const orderStart = BigInt(checkOrder.lock_lp_start_price);
    const orderEnd = BigInt(checkOrder.lock_lp_end_price);
    const orderMin = isDown ? orderEnd : orderStart;
    const orderMax = isDown ? orderStart : orderEnd;

    // Calculate expansion amount
    const expansionAmount = (orderMax - orderMin) * BigInt(Math.floor(LIQUIDITY_RESERVATION)) / 100n;

    let hasOverlap;
    if (isDown) {
      // down_orders: start unchanged, end expands downward
      const expandedEnd = orderMin - expansionAmount;
      hasOverlap = startPrice >= expandedEnd;
    } else {
      // up_orders: start unchanged, end expands upward
      const expandedEnd = orderMax + expansionAmount;
      hasOverlap = startPrice <= expandedEnd;
    }

    return hasOverlap;
  }

  // Check liquidity reservation overlap with previous order
  if (prevOrder && checkLiquidityReservationOverlap(prevOrder)) {
    return {
      no_overlap: false,
      close_insert_indices: [],
      overlap_reason: "Overlaps with previous order's liquidity reservation range"
    };
  }

  // No overlap, build close_insert_indices array
  // Priority: main position → before 1 → after 1 → before 2 → after 2 → before 3 → after 3
  const indices = [];

  // Main insertion position logic:
  // - down_orders (prices high to low): insert after prevOrder
  //   - If no prevOrder (insertionIndex=0), highest price, use u16::MAX for head insertion
  //   - If prevOrder exists, use prevOrder.index, insert after it
  // - up_orders (prices low to high): insert after prevOrder
  //   - If no prevOrder (insertionIndex=0), lowest price, use u16::MAX for head insertion
  //   - If prevOrder exists, use prevOrder.index, insert after it

  if (prevOrder && prevOrder.index !== undefined) {
    // Has previous order, insert after it
    indices.push(prevOrder.index);
  } else {
    // No previous order (insertionIndex=0)
    // down_orders: highest price, insert at head (65535)
    // up_orders: lowest price, insert at head (65535)
    indices.push(65535); // u16::MAX - insert at head
  }

  // Add indices of nodes before and after
  // Calculate how many before and after nodes to add based on MAX_CANDIDATE_INDICES constant
  for (let offset = 1; offset <= CANDIDATE_NODES_EACH_SIDE; offset++) {
    // Add the offset-th node before
    const beforeIndex = insertionIndex - 1 - offset;
    if (beforeIndex >= 0 && order_list[beforeIndex] && order_list[beforeIndex].index !== undefined) {
      indices.push(order_list[beforeIndex].index);
    }

    // Add the offset-th node after
    // offset=1 should be nextOrder (insertionIndex), offset=2 is insertionIndex+1, etc.
    const afterIndex = insertionIndex + offset - 1;
    if (afterIndex < order_list.length && order_list[afterIndex] && order_list[afterIndex].index !== undefined) {
      indices.push(order_list[afterIndex].index);
    }
  }

  return {
    no_overlap: true,
    close_insert_indices: indices,
    overlap_reason: ""
  };
}


module.exports = {
  transformOrdersData,
  checkPriceRangeOverlap
};