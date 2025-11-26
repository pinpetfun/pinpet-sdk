
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
    index: order.index,           // 保留 OrderBook 中的索引
    order_id: order.order_id       // 保留订单ID
  }));
}

/**
 * @typedef {Object} Order
 * @property {number} order_type - Order type (e.g., 1 for down_orders, 2 for up_orders).
 * @property {bigint} lock_lp_start_price - Locked liquidity start price.
 * @property {bigint} lock_lp_end_price - Locked liquidity end price.
 * @property {number} lock_lp_sol_amount - 锁定的SOL数量。
 * @property {number} lock_lp_token_amount - 锁定的代币数量。
 */

/**
 * @typedef {Object} OverlapResult
 * @property {boolean} no_overlap - 是否没有重叠。`true` 表示没有重叠（可以安全插入），`false` 表示有重叠。
 * @property {number[]} close_insert_indices - 平仓时插入订单簿的位置索引数组。包含主位置索引及其前后3个节点的索引。
 * @property {string} overlap_reason - 重叠原因说明。当没有重叠时为空字符串，有重叠时说明具体原因。
 */

/**
 * 检查给定价格区间是否与已排序的订单列表中的任何区间发生重叠，并返回合适的插入位置索引。
 *
 * ## 功能说明
 * 此函数用于保证金交易（long/short）场景，在开仓时需要确定平仓订单应该插入到订单簿（OrderBook）的哪个位置。
 * 函数会检查新订单的价格区间是否与现有订单重叠，并返回多个候选插入位置索引，以提高合约执行成功率。
 *
 * ## 核心逻辑
 * 1. **价格区间检查**：使用二分查找算法在已排序的订单列表中查找合适的插入位置
 * 2. **重叠检测**：
 *    - 基础重叠：新区间与现有订单的价格区间直接重叠
 *    - 流动性预留重叠：考虑到流动性预留区域（默认100%），防止价格区间过于接近
 * 3. **候选索引生成**：
 *    - 主插入位置：逻辑上最合适的插入位置索引
 *    - 备选位置：该位置前后各若干个节点的索引（数量由 MAX_CANDIDATE_INDICES 常量决定）
 *    - 目的：即使主位置的订单被删除或移动，合约也能找到其他合适位置
 *
 * ## 返回值说明
 * - **无重叠时**：返回 `close_insert_indices` 数组，包含候选插入位置的 OrderBook 索引
 *   - 优先级：主位置 → 前1个 → 后1个 → 前2个 → 后2个 → ... → 前N个 → 后N个
 *   - 索引数量由 MAX_CANDIDATE_INDICES 常量决定（默认21个，即主位置+前10个+后10个）
 * - **有重叠时**：返回空数组 `[]`，表示无法插入
 * - **空订单簿**：返回 `[65535]` (u16::MAX)，表示插入到头部
 *
 * ## 订单类型规则
 * - **down_orders（做多订单）**：价格从高到低排序
 *   - lock_lp_start_price > lock_lp_end_price（价格下跌）
 *   - 新订单的 end_price 必须 >= 下一个订单的 start_price
 * - **up_orders（做空订单）**：价格从低到高排序
 *   - lock_lp_start_price < lock_lp_end_price（价格上涨）
 *   - 新订单的 end_price 必须 <= 下一个订单的 start_price
 *
 * @param {'down_orders' | 'up_orders'} order_type - 订单类型
 *   - 'down_orders': 做多订单，价格从高到低排序
 *   - 'up_orders': 做空订单，价格从低到高排序
 *
 * @param {Order[]} order_list - 已排序的订单对象数组
 *   - 每个订单必须包含以下字段：
 *     - `index` {number}: 订单在 OrderBook 中的原始索引值（这是合约需要的关键字段）
 *     - `lock_lp_start_price` {bigint|string}: 锁定流动池区间起始价格
 *     - `lock_lp_end_price` {bigint|string}: 锁定流动池区间结束价格
 *   - 数组必须已按价格排序（down_orders 从高到低，up_orders 从低到高）
 *   - 通常来自 `sdk.chain.orders()` 或 `sdk.fast.orders()` 的返回数据
 *
 * @param {bigint | number | string} lp_start_price - 新订单的起始价格
 *   - 对于 down_orders：这是较高的价格（开仓价附近）
 *   - 对于 up_orders：这是较低的价格（止损价附近）
 *
 * @param {bigint | number | string} lp_end_price - 新订单的结束价格
 *   - 对于 down_orders：这是较低的价格（止损价附近）
 *   - 对于 up_orders：这是较高的价格（开仓价附近）
 *
 * @returns {OverlapResult} 返回包含重叠检查结果和候选插入索引的对象
 * @returns {boolean} returns.no_overlap - 是否没有重叠
 *   - `true`: 可以安全插入，使用 `close_insert_indices` 中的索引
 *   - `false`: 存在重叠，无法插入
 * @returns {number[]} returns.close_insert_indices - 候选插入位置的 OrderBook 索引数组
 *   - 无重叠时：包含主位置及前后3个节点的索引（最多7个）
 *   - 有重叠时：空数组 `[]`
 *   - 空订单簿时：`[65535]` 表示插入到头部
 * @returns {string} returns.overlap_reason - 重叠原因说明
 *   - 无重叠时：空字符串 `""`
 *   - 有重叠时：描述具体原因（如 "Overlaps with existing order range"）
 *
 * @example
 * // 示例 1: down_orders（做多订单）- 插入到中间位置
 * const downOrders = [
 *   { index: 10, lock_lp_start_price: 100n, lock_lp_end_price: 90n },  // 订单1
 *   { index: 25, lock_lp_start_price: 80n, lock_lp_end_price: 70n },   // 订单2
 *   { index: 33, lock_lp_start_price: 60n, lock_lp_end_price: 50n }    // 订单3
 * ];
 *
 * // 检查新订单 [75, 72] 是否可以插入
 * const result = checkPriceRangeOverlap('down_orders', downOrders, 75n, 72n);
 * console.log(result);
 * // 返回: {
 * //   no_overlap: true,
 * //   close_insert_indices: [25, 10, 33],
 * //   // 主位置是 25（订单2），因为新订单应该插入到订单2和订单3之间
 * //   // 备选位置：10（订单1在前），33（订单3在后）
 * //   overlap_reason: ""
 * // }
 *
 * @example
 * // 示例 2: down_orders - 价格重叠的情况
 * const downOrders = [
 *   { index: 10, lock_lp_start_price: 100n, lock_lp_end_price: 90n },
 *   { index: 25, lock_lp_start_price: 80n, lock_lp_end_price: 70n }
 * ];
 *
 * // 新订单 [95, 85] 与订单1 [100, 90] 重叠
 * const result = checkPriceRangeOverlap('down_orders', downOrders, 95n, 85n);
 * console.log(result);
 * // 返回: {
 * //   no_overlap: false,
 * //   close_insert_indices: [],
 * //   overlap_reason: "Overlaps with existing order range"
 * // }
 *
 * @example
 * // 示例 3: up_orders（做空订单）- 插入到末尾
 * const upOrders = [
 *   { index: 5, lock_lp_start_price: 70n, lock_lp_end_price: 80n },
 *   { index: 12, lock_lp_start_price: 90n, lock_lp_end_price: 100n }
 * ];
 *
 * // 新订单 [110, 120] 应该插入到末尾
 * const result = checkPriceRangeOverlap('up_orders', upOrders, 110n, 120n);
 * console.log(result);
 * // 返回: {
 * //   no_overlap: true,
 * //   close_insert_indices: [12, 5],
 * //   // 主位置是 12（订单2），因为新订单应该插入到订单2之后
 * //   // 备选位置：5（订单1在前）
 * //   overlap_reason: ""
 * // }
 *
 * @example
 * // 示例 4: 空订单簿 - 第一个订单
 * const emptyOrders = [];
 * const result = checkPriceRangeOverlap('down_orders', emptyOrders, 100n, 90n);
 * console.log(result);
 * // 返回: {
 * //   no_overlap: true,
 * //   close_insert_indices: [65535],
 * //   // 65535 是 u16::MAX，表示插入到头部（空订单簿时的特殊值）
 * //   overlap_reason: ""
 * // }
 *
 * @example
 * // 示例 5: 实际使用场景 - 做多交易
 * async function openLongPosition(sdk, mint, buyTokenAmount, stopLossPrice) {
 *   // 1. 获取 down_orders 数据
 *   const ordersData = await sdk.data.orders(mint, { type: 'down_orders' });
 *   const orders = ordersData.data.orders;
 *
 *   // 2. 获取当前价格
 *   const currentPrice = BigInt(await sdk.data.price(mint));
 *
 *   // 3. 计算平仓价格区间（模拟）
 *   const simulateResult = await sdk.simulator.simulateLongStopLoss(
 *     mint,
 *     buyTokenAmount,
 *     stopLossPrice
 *   );
 *
 *   // 4. 检查价格区间是否可以插入
 *   const overlapCheck = checkPriceRangeOverlap(
 *     'down_orders',
 *     orders,
 *     simulateResult.close_lp_start_price,
 *     simulateResult.close_lp_end_price
 *   );
 *
 *   if (!overlapCheck.no_overlap) {
 *     throw new Error(`无法开仓: ${overlapCheck.overlap_reason}`);
 *   }
 *
 *   // 5. 使用 close_insert_indices 调用合约
 *   const tx = await sdk.trading.long({
 *     mint,
 *     buyTokenAmount,
 *     maxSolAmount,
 *     marginSolMax,
 *     closePrice: stopLossPrice,
 *     closeInsertIndices: overlapCheck.close_insert_indices  // 传递给合约
 *   });
 *
 *   return tx;
 * }
 *
 * @throws {Error} 当输入的起始和结束价格与订单类型规则不匹配时抛出错误
 *
 * @see {@link https://github.com/your-repo/docs/orderbook.md|OrderBook 文档}
 * @see {@link transformOrdersData} 数据格式转换函数
 *
 * @since 2.0.0
 * @version 2.0.0 - 从返回 prev_order_pda/next_order_pda 改为返回 close_insert_indices
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

  // 验证并规范化输入价格区间，确保 minPrice <= maxPrice
  if ((isDown && startPrice < endPrice) || (!isDown && startPrice > endPrice)) {
    throw new Error('输入的起始和结束价格与订单类型规则不匹配。');
  }
  const minPrice = isDown ? endPrice : startPrice;
  const maxPrice = isDown ? startPrice : endPrice;

  let low = 0;
  let high = order_list.length - 1;
  let insertionIndex = order_list.length; // 默认插入到最后

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const order = order_list[mid];
    const orderStart = BigInt(order.lock_lp_start_price);
    const orderEnd = BigInt(order.lock_lp_end_price);

    const orderMin = isDown ? orderEnd : orderStart;
    const orderMax = isDown ? orderStart : orderEnd;

    // 核心重叠判断: (StartA < EndB) and (EndA > StartB)
    if (minPrice < orderMax && maxPrice > orderMin) {
      // 发生基础重叠
      return {
        no_overlap: false,
        close_insert_indices: [],
        overlap_reason: "Overlaps with existing order range"
      };
    }

    if (isDown) {
      // down_orders: 价格从大到小 (orderMax 递减)
      if (maxPrice > orderMax) { // 新区间在当前区间的“左边”（价格更高）
        insertionIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    } else {
      // up_orders: 价格从小到大 (orderMin 递增)
      if (minPrice < orderMin) { // 新区间在当前区间的“左边”（价格更低）
        insertionIndex = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
  }

  // 根据找到的插入点，确定逻辑上的前后订单
  // insertionIndex 是新区间应该插入的位置，使得列表依然有序
  const nextOrder = order_list[insertionIndex] || null;
  const prevOrder = order_list[insertionIndex - 1] || null;

  // 检查流动性预留重叠
  function checkLiquidityReservationOverlap(checkOrder) {
    if (!checkOrder) return false;

    const orderStart = BigInt(checkOrder.lock_lp_start_price);
    const orderEnd = BigInt(checkOrder.lock_lp_end_price);
    const orderMin = isDown ? orderEnd : orderStart;
    const orderMax = isDown ? orderStart : orderEnd;

    // 计算扩大区间值
    const expansionAmount = (orderMax - orderMin) * BigInt(Math.floor(LIQUIDITY_RESERVATION)) / 100n;

    let hasOverlap;
    if (isDown) {
      // down_orders: start不变，end向下扩大
      const expandedEnd = orderMin - expansionAmount;
      hasOverlap = startPrice >= expandedEnd;
    } else {
      // up_orders: start不变，end向上扩大
      const expandedEnd = orderMax + expansionAmount;
      hasOverlap = startPrice <= expandedEnd;
    }

    return hasOverlap;
  }

  // 检查与前一个订单的流动性预留重叠
  if (prevOrder && checkLiquidityReservationOverlap(prevOrder)) {
    return {
      no_overlap: false,
      close_insert_indices: [],
      overlap_reason: "Overlaps with previous order's liquidity reservation range"
    };
  }

  // 无重叠，构建 close_insert_indices 数组
  // 优先级：主位置 → 前1个 → 后1个 → 前2个 → 后2个 → 前3个 → 后3个
  const indices = [];

  // 主插入位置逻辑：
  // - down_orders (价格从高到低): 插入到 prevOrder 之后
  //   - 如果没有 prevOrder (insertionIndex=0)，说明价格最高，使用 u16::MAX 插入头部
  //   - 如果有 prevOrder，使用 prevOrder.index，插入到它后面
  // - up_orders (价格从低到高): 插入到 prevOrder 之后
  //   - 如果没有 prevOrder (insertionIndex=0)，说明价格最低，使用 u16::MAX 插入头部
  //   - 如果有 prevOrder，使用 prevOrder.index，插入到它后面

  if (prevOrder && prevOrder.index !== undefined) {
    // 有前置订单，插入到它后面
    indices.push(prevOrder.index);
  } else {
    // 没有前置订单 (insertionIndex=0)
    // down_orders: 价格最高，插入头部 (65535)
    // up_orders: 价格最低，插入头部 (65535)
    indices.push(65535); // u16::MAX - 插入到头部
  }

  // 添加前后节点的索引
  // 根据 MAX_CANDIDATE_INDICES 常量计算需要添加多少个前后节点
  for (let offset = 1; offset <= CANDIDATE_NODES_EACH_SIDE; offset++) {
    // 添加前面第 offset 个节点
    const beforeIndex = insertionIndex - 1 - offset;
    if (beforeIndex >= 0 && order_list[beforeIndex] && order_list[beforeIndex].index !== undefined) {
      indices.push(order_list[beforeIndex].index);
    }

    // 添加后面第 offset 个节点
    // offset=1 应该是 nextOrder (insertionIndex)，offset=2 是 insertionIndex+1，以此类推
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