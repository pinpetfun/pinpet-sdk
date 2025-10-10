const anchor = require('@coral-xyz/anchor');

/**
 * Order Data Processing Utilities Module
 *
 * Provides pure function utilities for order data format conversion and processing
 */
class OrderUtils {
  
  /**
   * Build LP Pairs Array (for trading) - Based on price range analysis
   *
   * @param {Array} orders - Order array
   * @param {string} direction - Direction: 'up_orders' (short orders) or 'down_orders' (long orders)
   * @param {number} maxCount - Max price ranges count, default 10
   * @returns {Array} LP pairs array, format: [{ solAmount: BN, tokenAmount: BN }, ...]
   *
   * @example
   * // Get short orders and build price range analysis
   * const ordersData = await sdk.fast.orders(mint, { type: 'up_orders' });
   * const lpPairs = OrderUtils.buildLpPairs(ordersData.data.orders, 'up_orders', 10);
   *
   * // Get long orders and build price range analysis
   * const ordersData = await sdk.fast.orders(mint, { type: 'down_orders' });
   * const lpPairs = OrderUtils.buildLpPairs(ordersData.data.orders, 'down_orders', 10);
   *
   * // Returns: [
   * //   { solAmount: new anchor.BN("63947874"), tokenAmount: new anchor.BN("65982364399") },
   * //   { solAmount: new anchor.BN("1341732020"), tokenAmount: new anchor.BN("1399566720549") },
   * //   ...
   * //   { solAmount: new anchor.BN("0"), tokenAmount: new anchor.BN("0") }, // Padded empty ranges
   * // ]
   */
  static buildLpPairs(orders, direction, price, maxCount = 10) {
    const CurveAMM = require('./curve_amm');
    
    // Parameter validation
    if (!Array.isArray(orders)) {
      throw new Error('buildLpPairs: orders must be an array');
    }

    if (typeof direction !== 'string' || !['up_orders', 'down_orders'].includes(direction)) {
      throw new Error('buildLpPairs: direction must be "up_orders" or "down_orders"');
    }

    if (!price) {
      throw new Error('buildLpPairs: price parameter is required');
    }

    if (!Number.isInteger(maxCount) || maxCount <= 0) {
      throw new Error('buildLpPairs: maxCount must be a positive integer');
    }

    // Convert price to bigint (u128 format)
    const currentPriceU128 = typeof price === 'bigint' ? price : BigInt(price);

    const lpPairs = [];

    // If orders is empty, create a range covering to max/min price
    if (orders.length === 0) {
      if (direction === 'up_orders') {
        // Short direction - price rising
        const buyResult = CurveAMM.buyFromPriceToPrice(currentPriceU128, CurveAMM.MAX_U128_PRICE);
        if (buyResult) {
          const [solAmount, tokenAmount] = buyResult;
          lpPairs.push({
            solAmount: new anchor.BN(solAmount.toString()),
            tokenAmount: new anchor.BN(tokenAmount.toString())
          });
        }
      } else {
        // Long direction - price falling 
        const sellResult = CurveAMM.sellFromPriceToPrice(currentPriceU128, CurveAMM.MIN_U128_PRICE);
        if (sellResult) {
          const [tokenAmount, solAmount] = sellResult;
          lpPairs.push({
            solAmount: new anchor.BN(solAmount.toString()),
            tokenAmount: new anchor.BN(tokenAmount.toString())
          });
        }
      }
    } else {
      // When orders exist, build price ranges
      const validOrders = orders.filter(order => order !== null);

      if (direction === 'up_orders') {
        // Short orders - analyze liquidity demand when price rises

        // First range: from current price to first order start price
        if (validOrders.length > 0) {
          const firstOrderStartPrice = BigInt(validOrders[0].lock_lp_start_price);
          if (currentPriceU128 < firstOrderStartPrice) {
            const buyResult = CurveAMM.buyFromPriceToPrice(currentPriceU128, firstOrderStartPrice - 1n);
            if (buyResult) {
              const [solAmount, tokenAmount] = buyResult;
              lpPairs.push({
                solAmount: new anchor.BN(solAmount.toString()),
                tokenAmount: new anchor.BN(tokenAmount.toString())
              });
            }
          }
        }

        // Middle ranges: gaps between orders
        for (let i = 0; i < validOrders.length - 1 && lpPairs.length < maxCount; i++) {
          const currentOrderEndPrice = BigInt(validOrders[i].lock_lp_end_price);
          const nextOrderStartPrice = BigInt(validOrders[i + 1].lock_lp_start_price);

          if (currentOrderEndPrice + 1n < nextOrderStartPrice) {
            const buyResult = CurveAMM.buyFromPriceToPrice(currentOrderEndPrice + 1n, nextOrderStartPrice - 1n);
            if (buyResult) {
              const [solAmount, tokenAmount] = buyResult;
              lpPairs.push({
                solAmount: new anchor.BN(solAmount.toString()),
                tokenAmount: new anchor.BN(tokenAmount.toString())
              });
            }
          }
        }

        // Last range: from last order end price to max price
        if (validOrders.length > 0 && lpPairs.length < maxCount) {
          const lastOrderEndPrice = BigInt(validOrders[validOrders.length - 1].lock_lp_end_price);
          const buyResult = CurveAMM.buyFromPriceToPrice(lastOrderEndPrice + 1n, CurveAMM.MAX_U128_PRICE);
          if (buyResult) {
            const [solAmount, tokenAmount] = buyResult;
            lpPairs.push({
              solAmount: new anchor.BN(solAmount.toString()),
              tokenAmount: new anchor.BN(tokenAmount.toString())
            });
          }
        }

      } else {
        // Long orders - analyze liquidity demand when price falls

        // First range: from current price to first order start price
        if (validOrders.length > 0) {
          const firstOrderStartPrice = BigInt(validOrders[0].lock_lp_start_price);
          if (currentPriceU128 > firstOrderStartPrice) {
            const sellResult = CurveAMM.sellFromPriceToPrice(currentPriceU128, firstOrderStartPrice + 1n);
            if (sellResult) {
              const [tokenAmount, solAmount] = sellResult;
              lpPairs.push({
                solAmount: new anchor.BN(solAmount.toString()),
                tokenAmount: new anchor.BN(tokenAmount.toString())
              });
            }
          }
        }

        // Middle ranges: gaps between orders
        for (let i = 0; i < validOrders.length - 1 && lpPairs.length < maxCount; i++) {
          const currentOrderEndPrice = BigInt(validOrders[i].lock_lp_end_price);
          const nextOrderStartPrice = BigInt(validOrders[i + 1].lock_lp_start_price);

          if (currentOrderEndPrice - 1n > nextOrderStartPrice) {
            const sellResult = CurveAMM.sellFromPriceToPrice(currentOrderEndPrice - 1n, nextOrderStartPrice + 1n);
            if (sellResult) {
              const [tokenAmount, solAmount] = sellResult;
              lpPairs.push({
                solAmount: new anchor.BN(solAmount.toString()),
                tokenAmount: new anchor.BN(tokenAmount.toString())
              });
            }
          }
        }

        // Last range: from last order end price to min price
        if (validOrders.length > 0 && lpPairs.length < maxCount) {
          const lastOrderEndPrice = BigInt(validOrders[validOrders.length - 1].lock_lp_end_price);
          const sellResult = CurveAMM.sellFromPriceToPrice(lastOrderEndPrice - 1n, CurveAMM.MIN_U128_PRICE);
          if (sellResult) {
            const [tokenAmount, solAmount] = sellResult;
            lpPairs.push({
              solAmount: new anchor.BN(solAmount.toString()),
              tokenAmount: new anchor.BN(tokenAmount.toString())
            });
          }
        }
      }
    }

    // Pad to maxCount elements
    while (lpPairs.length < maxCount) {
      lpPairs.push({
        solAmount: new anchor.BN(0),
        tokenAmount: new anchor.BN(0)
      });
    }

    // Ensure not exceeding maxCount
    if (lpPairs.length > maxCount) {
      lpPairs.splice(maxCount);
    }

    return lpPairs;
  }

  /**
   * Build Order Accounts Array (for trading)
   *
   * @param {Array} orders - Order array
   * @param {number} maxCount - Max order count, default 20
   * @returns {Array} Order account address array, format: [string, string, ..., null, null]
   *
   * @example
   * const ordersData = await sdk.fast.orders(mint, { type: 'down_orders' });
   * const orderAccounts = OrderUtils.buildOrderAccounts(ordersData.data.orders);
   * // Returns: [
   * //   "4fvsPDNoRRacSzE3PkEuNQeTNWMaeFqGwUxCnEbR1Dzb",
   * //   "G4nHBYX8EbrP8r35pk5TfpvJZfGNyLnd4qsfT7ru5vLd",
   * //   ...
   * //   null, null
   * // ]
   *
   * // Or specify max count
   * const orderAccounts = OrderUtils.buildOrderAccounts(ordersData.data.orders, 10);
   */
  static buildOrderAccounts(orders, maxCount = 10) {
    // Parameter validation
    if (!Array.isArray(orders)) {
      throw new Error('buildOrderAccounts: orders must be an array');
    }

    if (!Number.isInteger(maxCount) || maxCount <= 0) {
      throw new Error('buildOrderAccounts: maxCount must be a positive integer');
    }

    const orderAccounts = [];
    
    for (let i = 0; i < maxCount; i++) {
      if (i < orders.length && orders[i] && orders[i].order_pda) {
        // Validate order_pda format
        if (typeof orders[i].order_pda !== 'string' || orders[i].order_pda.trim() === '') {
          console.warn(`buildOrderAccounts: Invalid order_pda format for order ${i}: ${orders[i].order_pda}`);
          orderAccounts.push(null);
        } else {
          orderAccounts.push(orders[i].order_pda);
        }
      } else {
        // Fill null values
        orderAccounts.push(null);
      }
    }
    
    return orderAccounts;
  }

  /**
   * Find Previous and Next Order
   *
   * @param {Array} orders - Order array
   * @param {string} findOrderPda - Target order PDA address to find
   * @returns {Object} Returns { prevOrder: Object|null, nextOrder: Object|null }
   *
   * @example
   * const ordersData = await sdk.fast.orders(mint, { type: 'down_orders' });
   * const result = OrderUtils.findPrevNext(ordersData.data.orders, 'E2T72D4wZdxHRjELN5VnRdcCvS4FPcYBBT3UBEoaC5cA');
   * // Return format:
   * // {
   * //   prevOrder: { order_pda: "...", user: "...", ... } | null,
   * //   nextOrder: { order_pda: "...", user: "...", ... } | null
   * // }
   *
   * // Use returned data:
   * if (result.prevOrder) {
   *   console.log('Previous Order:', result.prevOrder.order_pda);
   * }
   * if (result.nextOrder) {
   *   console.log('Next Order:', result.nextOrder.order_pda);
   * }
   */
  static findPrevNext(orders, findOrderPda) {
    // Parameter validation
    if (!Array.isArray(orders)) {
      throw new Error('findPrevNext: orders parameter must be an array');
    }

    if (!findOrderPda || typeof findOrderPda !== 'string') {
      throw new Error('findPrevNext: findOrderPda parameter must be a valid string');
    }

    // Find target order index
    let targetIndex = -1;
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] && orders[i].order_pda === findOrderPda) {
        targetIndex = i;
        break;
      }
    }

    // If target order not found
    if (targetIndex === -1) {
      console.log(`findPrevNext: Order PDA not found: ${findOrderPda}`);
      return {
        prevOrder: null,
        nextOrder: null
      };
    }

    // Get previous order
    let prevOrder = null;
    if (targetIndex > 0 && orders[targetIndex - 1]) {
      prevOrder = orders[targetIndex - 1];
    }

    // Get next order
    let nextOrder = null;
    if (targetIndex < orders.length - 1 && orders[targetIndex + 1]) {
      nextOrder = orders[targetIndex + 1];
    }

    console.log(`findPrevNext: Found target order at index ${targetIndex}`);
    console.log(`findPrevNext: prevOrder = ${prevOrder ? prevOrder.order_pda : 'null'}`);
    console.log(`findPrevNext: nextOrder = ${nextOrder ? nextOrder.order_pda : 'null'}`);
    
    return {
      prevOrder,
      nextOrder
    };
  }

  /**
   * Validate Orders Array Format
   *
   * @param {Array} orders - Order array
   * @param {boolean} throwOnError - Whether to throw error, default true
   * @returns {boolean|Object} Validation result
   *
   * @example
   * const ordersData = await sdk.fast.orders(mint, { type: 'down_orders' });
   * const isValid = OrderUtils.validateOrdersFormat(ordersData.data.orders);
   *
   * // Or get detailed validation result
   * const result = OrderUtils.validateOrdersFormat(ordersData.data.orders, false);
   * // {
   * //   valid: true,
   * //   errors: [],
   * //   warnings: []
   * // }
   */
  static validateOrdersFormat(orders, throwOnError = true) {
    const errors = [];
    const warnings = [];

    // Basic type check
    if (!Array.isArray(orders)) {
      const error = 'orders must be an array';
      if (throwOnError) {
        throw new Error(`validateOrdersFormat: ${error}`);
      }
      errors.push(error);
      return { valid: false, errors, warnings };
    }

    // Check required fields for each order
    const requiredFields = [
      'order_pda', 'user', 'mint', 'order_type',
      'lock_lp_sol_amount', 'lock_lp_token_amount',
      'margin_sol_amount', 'borrow_amount', 'position_asset_amount'
    ];

    orders.forEach((order, index) => {
      if (!order) {
        warnings.push(`Order ${index} is null`);
        return;
      }

      requiredFields.forEach(field => {
        if (!(field in order)) {
          warnings.push(`Order ${index} missing field ${field}`);
        }
      });

      // Check order_pda format
      if (order.order_pda && typeof order.order_pda !== 'string') {
        warnings.push(`Order ${index} order_pda is not string`);
      }
    });

    const isValid = errors.length === 0;

    if (throwOnError && !isValid) {
      throw new Error(`validateOrdersFormat: Validation failed: ${errors.join(', ')}`);
    }

    return {
      valid: isValid,
      errors,
      warnings
    };
  }
}

module.exports = OrderUtils;