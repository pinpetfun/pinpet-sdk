
const CurveAMM = require('../../utils/curve_amm');


/**
 * Calculate liquidity impact for token buy operations
 *
 * This function analyzes the liquidity impact of buy operations within price ranges,
 * calculates available free liquidity, locked liquidity, and supports skipping specific
 * orders (treating their liquidity as available). Applicable for long orders (up_orders) scenarios.
 *
 * @param {bigint|string|number} price - Current token price, used as calculation start price
 * @param {bigint|string|number} buyTokenAmount - Amount of tokens to buy, target purchase amount
 * @param {Array<Object>} orders - Array of orders sorted by lock_lp_start_price (ascending):
 *   - order_type: {number} Order type (1=long, 2=short)
 *   - mint: {string} Token mint address
 *   - user: {string} User address
 *   - lock_lp_start_price: {string} LP lock start price (required)
 *   - lock_lp_end_price: {string} LP lock end price (required)
 *   - lock_lp_sol_amount: {number} Locked SOL amount (required)
 *   - lock_lp_token_amount: {number} Locked token amount (required)
 *   - start_time: {number} Start timestamp
 *   - end_time: {number} End timestamp
 *   - margin_sol_amount: {number} Margin SOL amount
 *   - borrow_amount: {number} Borrow amount
 *   - position_asset_amount: {number} Position asset amount
 *   - borrow_fee: {number} Borrow fee
 *   - order_pda: {string} Order PDA address (required for passOrder matching)
 * @param {number} onceMaxOrder - Maximum orders to process at once, limits traversal range
 * @param {string|null} passOrder - Order PDA address string to skip, when this value matches an order's order_pda, skip that order and count its liquidity as free liquidity
 *
 * @returns {Object} Liquidity calculation result object with detailed liquidity analysis data:
 *
 *   **Free Liquidity:**
 *   - free_lp_sol_amount_sum: {bigint} Total available free liquidity SOL amount, includes: 1) price gap liquidity 2) skipped order liquidity 3) infinite liquidity (if any)
 *   - free_lp_token_amount_sum: {bigint} Total available free liquidity token amount, corresponds to SOL, represents max tokens buyable without force closing any orders
 *
 *   **Locked Liquidity:**
 *   - lock_lp_sol_amount_sum: {bigint} Total locked liquidity SOL amount, excludes skipped orders, this liquidity is not directly usable
 *   - lock_lp_token_amount_sum: {bigint} Total locked liquidity token amount, excludes skipped orders, corresponds to locked SOL liquidity
 *
 *   **Liquidity Status Indicators:**
 *   - has_infinite_lp: {boolean} Whether includes infinite liquidity, true means order chain ended and liquidity to max price (MAX_U128_PRICE) was calculated
 *   - pass_order_id: {number} Index of skipped order in array, -1 means no order skipped, >=0 means order at that index was skipped
 *
 *   **Buy Execution Info:**
 *   - force_close_num: {number} Number of orders that need to be force closed, indicates how many orders need force closure to buy target amount, 0 means no force closure needed
 *   - ideal_lp_sol_amount: {bigint} Ideal SOL usage, theoretical minimum SOL requirement calculated directly from current price using CurveAMM, ignores liquidity distribution
 *   - real_lp_sol_amount: {bigint} Actual SOL usage, precise SOL requirement considering real liquidity distribution. 0 means current free liquidity insufficient for buy requirement, need to force close more orders
 *
 * @throws {Error} Parameter validation error: invalid price, buyTokenAmount, orders, or onceMaxOrder
 * @throws {Error} Price conversion error: cannot convert price parameters to BigInt
 * @throws {Error} Liquidity calculation error: CurveAMM calculation failure or value conversion error
 * @throws {Error} Gap liquidity calculation failure: price gap liquidity calculation exception
 * @throws {Error} Infinite liquidity calculation failure: max price liquidity calculation exception
 * @throws {Error} Order data format error: order object missing required fields
 */
function calcLiqTokenBuy(price, buyTokenAmount, orders, onceMaxOrder, passOrder = null) {
  // For buy operations, must use up_orders direction orders
  // lock_lp_start_price < lock_lp_end_price
  // and lock_lp_start_price is sorted from small to large in orders

  // Parameter validation
  if (!price && price !== 0) {
    throw new Error('Parameter validation error: price cannot be null');
  }
  if (!buyTokenAmount && buyTokenAmount !== 0) {
    throw new Error('Parameter validation error: buyTokenAmount cannot be null');
  }
  if (!Array.isArray(orders)) {
    throw new Error('Parameter validation error: orders must be an array');
  }
  if (!onceMaxOrder || onceMaxOrder <= 0) {
    throw new Error('Parameter validation error: onceMaxOrder must be a positive number');
  }

  const result = {
    free_lp_sol_amount_sum: 0n,  // SOL liquidity amount available in gaps
    free_lp_token_amount_sum: 0n, // Token liquidity amount available in gaps
    lock_lp_sol_amount_sum: 0n,
    lock_lp_token_amount_sum: 0n,
    has_infinite_lp: false, // Whether includes infinite liquidity
    pass_order_id: -1, // Skipped order index
    force_close_num: 0, // Number of orders to force close
    ideal_lp_sol_amount: 0n, // Ideal SOL amount to buy buyTokenAmount
    real_lp_sol_amount: 0n, // Actual SOL amount needed to buy buyTokenAmount
  }




  let buyTokenAmountBigInt;
  try {
    buyTokenAmountBigInt = BigInt(buyTokenAmount);
  } catch (error) {
    throw new Error(`Price conversion error: Cannot convert buyTokenAmount to BigInt - ${error.message}`);
  }

  // Variable to track previous free liquidity total
  let prev_free_lp_sol_amount_sum;

  //result.ideal_lp_token_amount_sum = buyTokenAmountBigInt;

  try {
    const priceBigInt = BigInt(price);
    [, result.ideal_lp_sol_amount] = CurveAMM.buyFromPriceWithTokenOutput(priceBigInt, buyTokenAmountBigInt);
    // console.log(`Ideal calculation: current price=${priceBigInt}, target token=${buyTokenAmountBigInt}, ideal SOL=${result.ideal_lp_sol_amount}`);
  } catch (error) {
    throw new Error(`Buy liquidity calculation error: Ideal liquidity calculation failed - ${error.message}`);
  }


  // When orders length is 0, calculate separately
  if (orders.length === 0) {
    [result.free_lp_sol_amount_sum, result.free_lp_token_amount_sum] = CurveAMM.buyFromPriceToPrice(BigInt(price), CurveAMM.MAX_U128_PRICE);
    result.has_infinite_lp = true;
    result.real_lp_sol_amount = result.ideal_lp_sol_amount
    return result
  }




  // Select minimum value for iteration
  const loopCount = Math.min(orders.length, onceMaxOrder);

  let counti = 0;
  for (let i = 0; i < loopCount; i++) {
    const order = orders[i];

    // Validate order data format
    if (!order) {
      throw new Error(`Order data format error: Order ${i} is null`);
    }
    if (!order.lock_lp_start_price) {
      throw new Error(`Order data format error: Order ${i} missing lock_lp_start_price`);
    }
    if (!order.lock_lp_end_price) {
      throw new Error(`Order data format error: Order ${i} missing lock_lp_end_price`);
    }


    // Calculate gap liquidity
    let startPrice, endPrice;
    try {
      if (i === 0) {
        // First order: use gap from current price to order start price
        startPrice = BigInt(price);
        endPrice = BigInt(order.lock_lp_start_price);
      } else {
        // Subsequent orders: use gap from previous order end price to current order start price
        startPrice = BigInt(orders[i - 1].lock_lp_end_price);
        endPrice = BigInt(order.lock_lp_start_price);
      }
    } catch (error) {
      throw new Error(`Price conversion error: Cannot convert price data for order ${i} - ${error.message}`);
    }


    // If there is a price gap, calculate free liquidity
    if (endPrice > startPrice) {
      try {
        const gapLiquidity = CurveAMM.buyFromPriceToPrice(startPrice, endPrice);
        if (gapLiquidity && Array.isArray(gapLiquidity) && gapLiquidity.length === 2) {
          const [solAmount, tokenAmount] = gapLiquidity;

          try {
            prev_free_lp_sol_amount_sum = result.free_lp_sol_amount_sum; // Previous value
            result.free_lp_sol_amount_sum += BigInt(solAmount);
            result.free_lp_token_amount_sum += BigInt(tokenAmount);
            // console.log(`Gap[${i}]: ${startPrice}→${endPrice}, gap SOL=${solAmount}, gap token=${tokenAmount}, total free token=${result.free_lp_token_amount_sum}`);
          } catch (error) {
            throw new Error(`Liquidity calculation error: Cannot convert gap liquidity values - ${error.message}`);
          }


          // Calculate actual SOL needed until can buy enough
          if (result.real_lp_sol_amount === 0n) {
            if (result.free_lp_token_amount_sum > buyTokenAmountBigInt) {
              // Gap liquidity is now sufficient for purchase
              // Calculate exactly how much token we need to buy
              try {
                const actualBuyAmount = buyTokenAmountBigInt - (result.free_lp_token_amount_sum - BigInt(tokenAmount));
                // console.log("actualBuyAmount", actualBuyAmount)
                const [, preciseSol] = CurveAMM.buyFromPriceWithTokenOutput(startPrice, actualBuyAmount)
                result.real_lp_sol_amount = prev_free_lp_sol_amount_sum + BigInt(preciseSol);

                // console.log(`Actual calculation[${i}]: free liquidity sufficient, actualBuyAmount=${actualBuyAmount}, preciseSol=${preciseSol}, actual SOL=${result.real_lp_sol_amount}`);
                result.force_close_num = counti; // Number of orders to force close
              } catch (error) {
                // console.log('Error details:', error);
                throw new Error(`Liquidity calculation error: Precise SOL calculation failed - ${error.message}`);
              }
            }
          }

        } else {
          throw new Error(`Gap liquidity calculation failure: Invalid return data format`);
        }
      } catch (error) {
        if (error.message.includes('Gap liquidity calculation failure') || error.message.includes('Liquidity calculation error')) {
          throw error;
        }
        throw new Error(`Gap liquidity calculation failure: ${error.message}`);
      }
    } else {
    }

    // Check if need to skip this order (passOrder logic)
    //const shouldSkipOrder = passOrder && typeof passOrder === 'string' && order.order_pda === passOrder;


    if (passOrder == order.order_pda) {

      // Add skipped order liquidity to free liquidity
      try {
        if (order.lock_lp_sol_amount === undefined || order.lock_lp_sol_amount === null) {
          throw new Error(`Order data format error: Skipped order ${i} missing lock_lp_sol_amount`);
        }
        if (order.lock_lp_token_amount === undefined || order.lock_lp_token_amount === null) {
          throw new Error(`Order data format error: Skipped order ${i} missing lock_lp_token_amount`);
        }

        const prevFreeSolSum = result.free_lp_sol_amount_sum; // Save previous value for calculation
        result.free_lp_sol_amount_sum += BigInt(order.lock_lp_sol_amount);
        result.free_lp_token_amount_sum += BigInt(order.lock_lp_token_amount);

        result.pass_order_id = i;


        // Check if free liquidity after skipping order meets purchase requirement
        if (result.real_lp_sol_amount === 0n) {
          if (result.free_lp_token_amount_sum >= buyTokenAmountBigInt) {
            // Free liquidity is now sufficient for purchase requirement
            try {
              //const remainingToken = result.free_lp_token_amount_sum - buyTokenAmountBigInt;
              // Calculate SOL needed from current price to buy exact token amount
              const targetPrice = i === 0 ? BigInt(price) : BigInt(orders[i - 1].lock_lp_end_price);
              const actualBuyAmount = buyTokenAmountBigInt - (result.free_lp_token_amount_sum - BigInt(order.lock_lp_token_amount));
              const [, preciseSol] = CurveAMM.buyFromPriceWithTokenOutput(targetPrice, actualBuyAmount);
              result.real_lp_sol_amount = prevFreeSolSum + BigInt(preciseSol);
              // console.log(`Actual calculation[${i}]: sufficient after skipping order, targetPrice=${targetPrice}, preciseSol=${preciseSol}, actual SOL=${result.real_lp_sol_amount}`);
              result.force_close_num = counti;
            } catch (error) {
              throw new Error(`Liquidity calculation error: Precise SOL calculation failed after skipping order - ${error.message}`);
            }
          }
        }

      } catch (error) {
        if (error.message.includes('Order data format error') || error.message.includes('Liquidity calculation error')) {
          throw error;
        }
        throw new Error(`Liquidity calculation error: Cannot process skipped order ${i} liquidity - ${error.message}`);
      }
    } else {
      // Accumulate locked liquidity (normal case)
      try {
        if (order.lock_lp_sol_amount === undefined || order.lock_lp_sol_amount === null) {
          throw new Error(`Order data format error: Order ${i} missing lock_lp_sol_amount`);
        }
        if (order.lock_lp_token_amount === undefined || order.lock_lp_token_amount === null) {
          throw new Error(`Order data format error: Order ${i} missing lock_lp_token_amount`);
        }

        result.lock_lp_sol_amount_sum += BigInt(order.lock_lp_sol_amount);
        result.lock_lp_token_amount_sum += BigInt(order.lock_lp_token_amount);
      } catch (error) {
        if (error.message.includes('Order data format error')) {
          throw error;
        }
        throw new Error(`Liquidity calculation error: Cannot accumulate locked liquidity for order ${i} - ${error.message}`);
      }

      counti += 1;
    }




  }

  // If traversed orders <= onceMaxOrder, means linked list ends, need to calculate infinite liquidity
  if (orders.length <= onceMaxOrder && orders.length > 0) {

    const lastOrder = orders[orders.length - 1];
    if (!lastOrder || !lastOrder.lock_lp_end_price) {
      throw new Error(`Order data format error: Last order missing lock_lp_end_price`);
    }

    let lastEndPrice, maxPrice;
    try {
      lastEndPrice = BigInt(lastOrder.lock_lp_end_price);
      maxPrice = CurveAMM.MAX_U128_PRICE;
    } catch (error) {
      throw new Error(`Price conversion error: Cannot convert last order price or max price - ${error.message}`);
    }


    if (maxPrice > lastEndPrice) {
      try {
        const infiniteLiquidity = CurveAMM.buyFromPriceToPrice(lastEndPrice, maxPrice);
        if (infiniteLiquidity && Array.isArray(infiniteLiquidity) && infiniteLiquidity.length === 2) {
          const [solAmount, tokenAmount] = infiniteLiquidity;

          try {
            result.free_lp_sol_amount_sum += BigInt(solAmount);
            result.free_lp_token_amount_sum += BigInt(tokenAmount);
            result.has_infinite_lp = true;
          } catch (error) {
            throw new Error(`Liquidity calculation error: Cannot convert infinite liquidity values - ${error.message}`);
          }

          // After entering infinite liquidity, also calculate actual SOL needed until can buy enough
          if (result.real_lp_sol_amount === 0n) {
            if (result.free_lp_token_amount_sum > buyTokenAmountBigInt) {
              // Gap liquidity is now sufficient for purchase
              // Calculate exactly how much token we need to buy
              try {
                const actualBuyAmount = buyTokenAmountBigInt - (result.free_lp_token_amount_sum - BigInt(tokenAmount));
                const [, preciseSol] = CurveAMM.buyFromPriceWithTokenOutput(lastEndPrice, actualBuyAmount)
                result.real_lp_sol_amount += BigInt(preciseSol);
                result.force_close_num = counti; // Number of orders to force close
              } catch (error) {
                throw new Error(`Liquidity calculation error: Infinite liquidity precise SOL calculation failed - ${error.message}`);
              }
            }
          }

        } else {
          throw new Error(`Infinite liquidity calculation failure: Invalid return data format`);
        }
      } catch (error) {
        if (error.message.includes('Infinite liquidity calculation failure') || error.message.includes('Liquidity calculation error') || error.message.includes('Order data format error') || error.message.includes('Price conversion error')) {
          throw error;
        }
        throw new Error(`Infinite liquidity calculation failure: ${error.message}`);
      }
    }
  }

  return result;

}




/**
 * Calculate liquidity impact for token sell operations
 *
 * This function analyzes the liquidity impact of sell operations within price ranges,
 * calculates available free liquidity, locked liquidity, and supports skipping specific
 * orders (treating their liquidity as available). Applicable for short orders (down_orders) scenarios.
 *
 * @param {bigint|string|number} price - Current token price, used as calculation start price
 * @param {bigint|string|number} sellTokenAmount - Amount of tokens to sell, target sell amount
 * @param {Array<Object>} orders - Array of orders sorted by lock_lp_start_price (descending):
 *   - order_type: {number} Order type (1=long, 2=short)
 *   - mint: {string} Token mint address
 *   - user: {string} User address
 *   - lock_lp_start_price: {string} LP lock start price (high price) (required)
 *   - lock_lp_end_price: {string} LP lock end price (low price) (required)
 *   - lock_lp_sol_amount: {number} Locked SOL amount (required)
 *   - lock_lp_token_amount: {number} Locked token amount (required)
 *   - start_time: {number} Start timestamp
 *   - end_time: {number} End timestamp
 *   - margin_sol_amount: {number} Margin SOL amount
 *   - borrow_amount: {number} Borrow amount
 *   - position_asset_amount: {number} Position asset amount
 *   - borrow_fee: {number} Borrow fee
 *   - order_pda: {string} Order PDA address (required for passOrder matching)
 * @param {number} onceMaxOrder - Maximum orders to process at once, limits traversal range
 * @param {string|null} passOrder - Order PDA address string to skip, when this value matches an order's order_pda, skip that order and count its liquidity as free liquidity
 *
 * @returns {Object} Liquidity calculation result object with detailed liquidity analysis data:
 *
 *   **Free Liquidity:**
 *   - free_lp_sol_amount_sum: {bigint} Total available free liquidity SOL amount, represents SOL obtainable from selling, includes: 1) price gap liquidity 2) skipped order liquidity 3) infinite liquidity (if any)
 *   - free_lp_token_amount_sum: {bigint} Total available free liquidity token amount, represents max tokens sellable without force closing any orders
 *
 *   **Locked Liquidity:**
 *   - lock_lp_sol_amount_sum: {bigint} Total locked liquidity SOL amount, excludes skipped orders, this liquidity is not directly usable
 *   - lock_lp_token_amount_sum: {bigint} Total locked liquidity token amount, excludes skipped orders, corresponds to locked SOL liquidity
 *
 *   **Liquidity Status Indicators:**
 *   - has_infinite_lp: {boolean} Whether includes infinite liquidity, true means order chain ended and liquidity to min price (MIN_U128_PRICE) was calculated
 *   - pass_order_id: {number} Index of skipped order in array, -1 means no order skipped, >=0 means order at that index was skipped
 *
 *   **Sell Execution Info:**
 *   - force_close_num: {number} Number of orders that need to be force closed, indicates how many orders need force closure to sell target amount, 0 means no force closure needed
 *   - ideal_lp_sol_amount: {bigint} Ideal SOL amount obtainable, theoretical maximum SOL revenue calculated directly from current price using CurveAMM, ignores liquidity distribution
 *   - real_lp_sol_amount: {bigint} Actual SOL amount obtainable, precise SOL revenue considering real liquidity distribution. 0 means current free liquidity insufficient for sell requirement, need to force close more orders
 *
 * @throws {Error} Parameter validation error: invalid price, sellTokenAmount, orders, or onceMaxOrder
 * @throws {Error} Price conversion error: cannot convert price parameters to BigInt
 * @throws {Error} Liquidity calculation error: CurveAMM calculation failure or value conversion error
 * @throws {Error} Gap liquidity calculation failure: price gap liquidity calculation exception
 * @throws {Error} Infinite liquidity calculation failure: min price liquidity calculation exception
 * @throws {Error} Order data format error: order object missing required fields
 */
function calcLiqTokenSell(price, sellTokenAmount, orders, onceMaxOrder, passOrder = null) {
  // For sell operations, must use down_orders direction orders
  // lock_lp_start_price > lock_lp_end_price
  // and lock_lp_start_price is sorted from large to small in orders

  // Parameter validation
  if (!price && price !== 0) {
    throw new Error('Parameter validation error: price cannot be null');
  }
  if (!sellTokenAmount && sellTokenAmount !== 0) {
    throw new Error('Parameter validation error: sellTokenAmount cannot be null');
  }
  if (!Array.isArray(orders)) {
    throw new Error('Parameter validation error: orders must be an array');
  }
  if (!onceMaxOrder || onceMaxOrder <= 0) {
    throw new Error('Parameter validation error: onceMaxOrder must be a positive number');
  }

  const result = {
    free_lp_sol_amount_sum: 0n,  // SOL liquidity amount available in gaps
    free_lp_token_amount_sum: 0n, // Token liquidity amount available in gaps
    lock_lp_sol_amount_sum: 0n,
    lock_lp_token_amount_sum: 0n,
    has_infinite_lp: false, // Whether infinite liquidity is included
    pass_order_id: -1, // Index of skipped order
    force_close_num: 0, // Number of forced close orders
    ideal_lp_sol_amount: 0n, // Ideal SOL amount obtained from selling sellTokenAmount
    real_lp_sol_amount: 0n, // Actual SOL amount obtained from selling sellTokenAmount
  }

  let sellTokenAmountBigInt;
  try {
    sellTokenAmountBigInt = BigInt(sellTokenAmount);
  } catch (error) {
    throw new Error(`Price conversion error: Cannot convert sellTokenAmount to BigInt - ${error.message}`);
  }

  // Variable to track previous free liquidity total amount
  let prev_free_lp_sol_amount_sum;

  // Calculate ideal SOL amount obtained from selling
  try {
    const priceBigInt = BigInt(price);
    [, result.ideal_lp_sol_amount] = CurveAMM.sellFromPriceWithTokenInput(priceBigInt, sellTokenAmountBigInt);
    // console.log(`Ideal calculation: current price=${priceBigInt}, sell tokens=${sellTokenAmountBigInt}, ideal SOL=${result.ideal_lp_sol_amount}`);
  } catch (error) {
    throw new Error(`Sell liquidity calculation error: Ideal liquidity calculation failed - ${error.message}`);
  }

  // Special calculation when orders length is 0
  if (orders.length === 0) {
    const sellResult = CurveAMM.sellFromPriceToPrice(BigInt(price), CurveAMM.MIN_U128_PRICE);
    if (sellResult) {
      [result.free_lp_token_amount_sum, result.free_lp_sol_amount_sum] = sellResult;
    } else {
      // If current price is already below minimum price, cannot sell further
      result.free_lp_token_amount_sum = 0n;
      result.free_lp_sol_amount_sum = 0n;
    }
    result.has_infinite_lp = true;
    result.real_lp_sol_amount = result.ideal_lp_sol_amount
    return result
  }




  // Select minimum value for iteration
  const loopCount = Math.min(orders.length, onceMaxOrder);

  let counti = 0;
  for (let i = 0; i < loopCount; i++) {
    const order = orders[i];
    // console.log(`Processing sell order[${i}]: accumulated free tokens=${result.free_lp_token_amount_sum}, target=${sellTokenAmountBigInt}, needed=${sellTokenAmountBigInt > result.free_lp_token_amount_sum}`);

    // Validate order data format
    if (!order) {
      throw new Error(`Order data format error: Order ${i} is null`);
    }
    if (!order.lock_lp_start_price) {
      throw new Error(`Order data format error: Order ${i} missing lock_lp_start_price`);
    }
    if (!order.lock_lp_end_price) {
      throw new Error(`Order data format error: Order ${i} missing lock_lp_end_price`);
    }


    // Calculate gap liquidity (sell direction: from high price to low price)
    let startPrice, endPrice;
    try {
      if (i === 0) {
        // First order: gap from current price (high) to order start price (low)
        startPrice = BigInt(price);
        endPrice = BigInt(order.lock_lp_start_price);
      } else {
        // Subsequent orders: gap from previous order end price (high) to current order start price (low)
        startPrice = BigInt(orders[i - 1].lock_lp_end_price);
        endPrice = BigInt(order.lock_lp_start_price);
      }
    } catch (error) {
      throw new Error(`Price conversion error: Cannot convert price data for order ${i} - ${error.message}`);
    }


    // If price gap exists (for sell, startPrice should be greater than endPrice)
    if (startPrice > endPrice) {
      try {
        const gapLiquidity = CurveAMM.sellFromPriceToPrice(startPrice, endPrice);
        if (gapLiquidity && Array.isArray(gapLiquidity) && gapLiquidity.length === 2) {
          const [tokenAmount, solAmount] = gapLiquidity;

          try {
            prev_free_lp_sol_amount_sum = result.free_lp_sol_amount_sum; // Previous value
            result.free_lp_sol_amount_sum += BigInt(solAmount);
            result.free_lp_token_amount_sum += BigInt(tokenAmount);
            // console.log(`Sell gap[${i}]: ${startPrice}→${endPrice}, gap tokens=${tokenAmount}, gap SOL=${solAmount}, accumulated free tokens=${result.free_lp_token_amount_sum}`);
          } catch (error) {
            throw new Error(`Liquidity calculation error: Cannot convert gap liquidity values - ${error.message}`);
          }

          // Calculate actual SOL amount obtained until we can sell
          if (result.real_lp_sol_amount === 0n) {
            if (result.free_lp_token_amount_sum >= sellTokenAmountBigInt) {
              // Gap liquidity is now sufficient for the sale
              // Calculate exact SOL amount obtainable
              try {
                const actualSellAmount = sellTokenAmountBigInt - (result.free_lp_token_amount_sum - BigInt(tokenAmount));
                const [, preciseSol] = CurveAMM.sellFromPriceWithTokenInput(startPrice, actualSellAmount);
                result.real_lp_sol_amount = prev_free_lp_sol_amount_sum + preciseSol;
                // console.log(`Sell actual calculation[${i}]: free liquidity sufficient, actualSellAmount=${actualSellAmount}, preciseSol=${preciseSol}, actual SOL=${result.real_lp_sol_amount}`);
                result.force_close_num = counti; // Number of forced close orders
              } catch (error) {
                throw new Error(`Liquidity calculation error: Precise SOL calculation failed - ${error.message}`);
              }
            }
          }

        } else {
          throw new Error(`Gap liquidity calculation failure: Invalid return data format`);
        }
      } catch (error) {
        if (error.message.includes('Gap liquidity calculation failure') || error.message.includes('Liquidity calculation error')) {
          throw error;
        }
        throw new Error(`Gap liquidity calculation failure: ${error.message}`);
      }
    } else {
    }

    // Check if need to skip this order (passOrder logic)

    if (passOrder == order.order_pda) {

      // Add skipped order's liquidity to free liquidity
      try {
        if (order.lock_lp_sol_amount === undefined || order.lock_lp_sol_amount === null) {
          throw new Error(`Order data format error: Skipped order ${i} missing lock_lp_sol_amount`);
        }
        if (order.lock_lp_token_amount === undefined || order.lock_lp_token_amount === null) {
          throw new Error(`Order data format error: Skipped order ${i} missing lock_lp_token_amount`);
        }

        const prevFreeSolSum = result.free_lp_sol_amount_sum; // Save previous value for calculation
        result.free_lp_sol_amount_sum += BigInt(order.lock_lp_sol_amount);
        result.free_lp_token_amount_sum += BigInt(order.lock_lp_token_amount);

        result.pass_order_id = i;


        // Check if free liquidity after skipping order satisfies sell requirement
        if (result.real_lp_sol_amount === 0n) {
          if (result.free_lp_token_amount_sum >= sellTokenAmountBigInt) {
            // Free liquidity is now sufficient for the sell requirement
            try {
              // Calculate exact SOL amount obtainable
              const targetPrice = i === 0 ? BigInt(price) : BigInt(orders[i - 1].lock_lp_end_price);
              const actualSellAmount = sellTokenAmountBigInt - (result.free_lp_token_amount_sum - BigInt(order.lock_lp_token_amount));
              const [, preciseSol] = CurveAMM.sellFromPriceWithTokenInput(targetPrice, actualSellAmount);
              result.real_lp_sol_amount = prevFreeSolSum + preciseSol;
              result.force_close_num = counti;
            } catch (error) {
              throw new Error(`Liquidity calculation error: Precise SOL calculation failed after skipping order - ${error.message}`);
            }
          }
        }

      } catch (error) {
        if (error.message.includes('Order data format error') || error.message.includes('Liquidity calculation error')) {
          throw error;
        }
        throw new Error(`Liquidity calculation error: Cannot process skipped order ${i} liquidity - ${error.message}`);
      }
    } else {
      // Accumulate locked liquidity (normal case)
      try {
        if (order.lock_lp_sol_amount === undefined || order.lock_lp_sol_amount === null) {
          throw new Error(`Order data format error: Order ${i} missing lock_lp_sol_amount`);
        }
        if (order.lock_lp_token_amount === undefined || order.lock_lp_token_amount === null) {
          throw new Error(`Order data format error: Order ${i} missing lock_lp_token_amount`);
        }

        result.lock_lp_sol_amount_sum += BigInt(order.lock_lp_sol_amount);
        result.lock_lp_token_amount_sum += BigInt(order.lock_lp_token_amount);
      } catch (error) {
        if (error.message.includes('Order data format error')) {
          throw error;
        }
        throw new Error(`Liquidity calculation error: Cannot accumulate locked liquidity for order ${i} - ${error.message}`);
      }

      counti += 1;
    }

  }

  // If traversed orders count <= onceMaxOrder, linked list has ended, need to calculate infinite liquidity
  if (orders.length <= onceMaxOrder && orders.length > 0) {

    const lastOrder = orders[orders.length - 1];
    if (!lastOrder || !lastOrder.lock_lp_end_price) {
      throw new Error(`Order data format error: Last order missing lock_lp_end_price`);
    }

    let lastEndPrice, minPrice;
    try {
      lastEndPrice = BigInt(lastOrder.lock_lp_end_price);
      minPrice = CurveAMM.MIN_U128_PRICE;
    } catch (error) {
      throw new Error(`Price conversion error: Cannot convert last order price or min price - ${error.message}`);
    }


    if (lastEndPrice > minPrice) {

      try {
        const infiniteLiquidity = CurveAMM.sellFromPriceToPrice(lastEndPrice, minPrice);
        if (infiniteLiquidity && Array.isArray(infiniteLiquidity) && infiniteLiquidity.length === 2) {
          const [tokenAmount, solAmount] = infiniteLiquidity;

          let prevFreeSolSum;
          try {
            prevFreeSolSum = result.free_lp_sol_amount_sum;
            result.free_lp_sol_amount_sum += BigInt(solAmount);
            result.free_lp_token_amount_sum += BigInt(tokenAmount);
            result.has_infinite_lp = true;
          } catch (error) {
            throw new Error(`Liquidity calculation error: Cannot convert infinite liquidity values - ${error.message}`);
          }

          // After entering infinite liquidity, calculate actual SOL amount obtained
          if (result.real_lp_sol_amount === 0n) {
            if (result.free_lp_token_amount_sum >= sellTokenAmountBigInt) {
              // Infinite liquidity is now sufficient for the sell requirement
              try {
                const actualSellAmount = sellTokenAmountBigInt - (result.free_lp_token_amount_sum - BigInt(tokenAmount));
                const [, preciseSol] = CurveAMM.sellFromPriceWithTokenInput(lastEndPrice, actualSellAmount);
                result.real_lp_sol_amount = prevFreeSolSum + preciseSol;
                result.force_close_num = counti; // Number of forced close orders
              } catch (error) {
                throw new Error(`Liquidity calculation error: Infinite liquidity precise SOL calculation failed - ${error.message}`);
              }
            }
          }

        } else {
          throw new Error(`Infinite liquidity calculation failure: Invalid return data format`);
        }
      } catch (error) {
        if (error.message.includes('Infinite liquidity calculation failure') || error.message.includes('Liquidity calculation error') || error.message.includes('Order data format error') || error.message.includes('Price conversion error')) {
          throw error;
        }
        throw new Error(`Infinite liquidity calculation failure: ${error.message}`);
      }
    }
  }

  return result;
}

module.exports = {
  calcLiqTokenBuy,
  calcLiqTokenSell
};


