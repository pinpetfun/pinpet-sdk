const { MAX_CANDIDATE_INDICES } = require('./utils');

// Calculate number of nodes to include before and after the main position
const CANDIDATE_NODES_EACH_SIDE = Math.floor((MAX_CANDIDATE_INDICES - 1) / 2);

// Special value indicating no prev/next order in the linked list
const NO_ORDER = 65535;

/**
 * 根据 index 在订单数组中查找订单
 * Find order in array by its index field
 *
 * @param {Array} orders - 订单数组 / Orders array
 * @param {number} index - 订单的 index 字段值 / Order's index field value
 * @returns {Object|null} 找到的订单对象，找不到返回 null / Found order object or null
 */
function findOrderByIndex(orders, index) {
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].index === index) {
      return orders[i];
    }
  }
  return null;
}

/**
 * 为做多平仓生成候选插入索引
 * Generate candidate insertion indices for closing long position
 *
 * @param {string} mint - 代币地址 / Token address
 * @param {number|string|anchor.BN} closeOrderId - 要平仓的订单ID (order_id, 不是 index) / Order ID to close (order_id, not index)
 * @param {Object|null} ordersData - 订单数据（可选，如果不提供会自动获取）/ Orders data (optional, will fetch if not provided)
 * @returns {Promise<Object>} 返回包含候选索引数组的对象 / Returns object containing candidate indices array
 *   - closeOrderIndices: {number[]} 候选插入位置索引数组 / Candidate insertion position indices array
 *
 * @throws {Error} 如果找不到对应的 closeOrderId / If closeOrderId is not found
 *
 * @example
 * // 平仓做多订单
 * const result = await sdk.simulator.simulateLongClose(
 *   'HG9R8CE9N18U8zYqo6cqS4bFaCAzHbAhaAe1zq8Hq7PF',
 *   1090  // order_id
 * );
 * console.log('候选索引:', result.closeOrderIndices);
 * // 输出: { closeOrderIndices: [25, 15, 35, 5, 45, ...] }
 */
async function simulateLongClose(mint, closeOrderId, ordersData = null) {
  // 1. 获取 down_orders 数据（做多订单在 down_orders 中）
  if (!ordersData) {
    ordersData = await this.sdk.data.orders(mint, { type: 'down_orders' });
  }

  if (!ordersData || !ordersData.success || !ordersData.data || !ordersData.data.orders) {
    throw new Error('Failed to fetch down_orders data');
  }

  const orders = ordersData.data.orders;

  // 2. 将 closeOrderId 转换为字符串（因为 API 返回的 order_id 是字符串）
  const targetOrderId = closeOrderId.toString();

  // 3. 在订单列表中查找匹配的订单
  let targetOrderIndex = -1;
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].order_id === targetOrderId) {
      targetOrderIndex = i;
      break;
    }
  }

  // 4. 如果找不到订单，抛出错误
  if (targetOrderIndex === -1) {
    throw new Error(`Order with order_id ${targetOrderId} not found in down_orders`);
  }

  // 5. 获取目标订单的 OrderBook index
  const targetOrder = orders[targetOrderIndex];
  const mainIndex = targetOrder.index;

  // 6. 生成候选索引数组（通过链表结构遍历前后节点）
  const indices = [];

  // 添加主位置
  indices.push(mainIndex);

  // 通过链表结构添加前后节点的索引
  let prevNode = targetOrder;
  let nextNode = targetOrder;

  for (let offset = 1; offset <= CANDIDATE_NODES_EACH_SIDE; offset++) {
    // 添加前面第 offset 个节点（通过 prev_order 链表指针）
    if (prevNode.prev_order !== NO_ORDER) {
      const prevOrder = findOrderByIndex(orders, prevNode.prev_order);
      if (prevOrder && prevOrder.index !== undefined) {
        indices.push(prevOrder.index);
        prevNode = prevOrder; // 继续向前遍历
      } else {
        prevNode = { prev_order: NO_ORDER }; // 找不到则停止
      }
    }

    // 添加后面第 offset 个节点（通过 next_order 链表指针）
    if (nextNode.next_order !== NO_ORDER) {
      const nextOrder = findOrderByIndex(orders, nextNode.next_order);
      if (nextOrder && nextOrder.index !== undefined) {
        indices.push(nextOrder.index);
        nextNode = nextOrder; // 继续向后遍历
      } else {
        nextNode = { next_order: NO_ORDER }; // 找不到则停止
      }
    }
  }

  // 7. 返回结果
  return {
    closeOrderIndices: indices
  };
}

/**
 * 为做空平仓生成候选插入索引
 * Generate candidate insertion indices for closing short position
 *
 * @param {string} mint - 代币地址 / Token address
 * @param {number|string|anchor.BN} closeOrderId - 要平仓的订单ID (order_id, 不是 index) / Order ID to close (order_id, not index)
 * @param {Object|null} ordersData - 订单数据（可选，如果不提供会自动获取）/ Orders data (optional, will fetch if not provided)
 * @returns {Promise<Object>} 返回包含候选索引数组的对象 / Returns object containing candidate indices array
 *   - closeOrderIndices: {number[]} 候选插入位置索引数组 / Candidate insertion position indices array
 *
 * @throws {Error} 如果找不到对应的 closeOrderId / If closeOrderId is not found
 *
 * @example
 * // 平仓做空订单
 * const result = await sdk.simulator.simulateShortClose(
 *   'HG9R8CE9N18U8zYqo6cqS4bFaCAzHbAhaAe1zq8Hq7PF',
 *   1090  // order_id
 * );
 * console.log('候选索引:', result.closeOrderIndices);
 * // 输出: { closeOrderIndices: [25, 15, 35, 5, 45, ...] }
 */
async function simulateShortClose(mint, closeOrderId, ordersData = null) {
  // 1. 获取 up_orders 数据（做空订单在 up_orders 中）
  if (!ordersData) {
    ordersData = await this.sdk.data.orders(mint, { type: 'up_orders' });
  }

  if (!ordersData || !ordersData.success || !ordersData.data || !ordersData.data.orders) {
    throw new Error('Failed to fetch up_orders data');
  }

  const orders = ordersData.data.orders;

  // 2. 将 closeOrderId 转换为字符串（因为 API 返回的 order_id 是字符串）
  const targetOrderId = closeOrderId.toString();

  // 3. 在订单列表中查找匹配的订单
  let targetOrderIndex = -1;
  for (let i = 0; i < orders.length; i++) {
    if (orders[i].order_id === targetOrderId) {
      targetOrderIndex = i;
      break;
    }
  }

  // 4. 如果找不到订单，抛出错误
  if (targetOrderIndex === -1) {
    throw new Error(`Order with order_id ${targetOrderId} not found in up_orders`);
  }

  // 5. 获取目标订单的 OrderBook index
  const targetOrder = orders[targetOrderIndex];
  const mainIndex = targetOrder.index;

  // 6. 生成候选索引数组（通过链表结构遍历前后节点）
  const indices = [];

  // 添加主位置
  indices.push(mainIndex);

  // 通过链表结构添加前后节点的索引
  let prevNode = targetOrder;
  let nextNode = targetOrder;

  for (let offset = 1; offset <= CANDIDATE_NODES_EACH_SIDE; offset++) {
    // 添加前面第 offset 个节点（通过 prev_order 链表指针）
    if (prevNode.prev_order !== NO_ORDER) {
      const prevOrder = findOrderByIndex(orders, prevNode.prev_order);
      if (prevOrder && prevOrder.index !== undefined) {
        indices.push(prevOrder.index);
        prevNode = prevOrder; // 继续向前遍历
      } else {
        prevNode = { prev_order: NO_ORDER }; // 找不到则停止
      }
    }

    // 添加后面第 offset 个节点（通过 next_order 链表指针）
    if (nextNode.next_order !== NO_ORDER) {
      const nextOrder = findOrderByIndex(orders, nextNode.next_order);
      if (nextOrder && nextOrder.index !== undefined) {
        indices.push(nextOrder.index);
        nextNode = nextOrder; // 继续向后遍历
      } else {
        nextNode = { next_order: NO_ORDER }; // 找不到则停止
      }
    }
  }

  // 7. 返回结果
  return {
    closeOrderIndices: indices
  };
}

module.exports = {
  simulateLongClose,
  simulateShortClose
};
