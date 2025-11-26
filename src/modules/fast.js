const axios = require('axios');
const CurveAMM = require('../utils/curve_amm');

/**
 * Fast API Module
 * Access data through API interfaces from centralized servers, quickly obtain transaction parameters
 * Enables smooth trading operations
 */
class FastModule {
  constructor(sdk) {
    this.sdk = sdk;
    this.baseUrl = sdk.pinPetFastApiUrl;

    // Only create axios instance if baseUrl is provided
    // This allows SDK to be initialized with chain-only mode
    if (this.baseUrl) {
      // Create axios instance
      this.httpClient = axios.create({
        baseURL: this.baseUrl,
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
    } else {
      this.httpClient = null;
    }
  }

  /**
   * Check if FastModule is properly configured
   * @private
   */
  _ensureConfigured() {
    if (!this.baseUrl || !this.httpClient) {
      throw new Error('FastModule requires pinPetFastApiUrl configuration. Either provide pinPetFastApiUrl in options or use defaultDataSource: "chain"');
    }
  }

  /**
   * Get token list (获取代币列表)
   * @param {Object} options - Query parameters
   * @param {number} options.limit - Items per page, default 10 (每页数量，默认 10)
   * @param {number} options.before_timestamp - Cursor for pagination (分页游标，Unix 时间戳)
   * @returns {Promise<Object>} Token list data
   *
   * @example
   * // Get latest 5 tokens
   * const result = await sdk.fast.mints({ limit: 5 });
   * // Return format:
   * // {
   * //   "code": 200,
   * //   "msg": "success",
   * //   "data": {
   * //     "tokens": [
   * //       {
   * //         "payer": "8iGFeUkRpyRx8w5uoUMbfZepUr6BfTdPuJmqGoNBntdb",
   * //         "mint_account": "7K7WLJ5rKgnjG3xtknAoRmFqWoRS6cNR3TsDEN7MnLJu",
   * //         "curve_account": "58XWvk4q9NeD2fbSjy5jRyrG7ub6V8kQFvkf8EuDFVPx",
   * //         "pool_token_account": "69cooFpg3Ykg8T6iaUeCT4HhKUvZGwDbjUHUAsQa3oD",
   * //         "pool_sol_account": "5vWvG42FrKPPwdZDs7TLVncTLf6VqyQnrhgjuGtWiseH",
   * //         "fee_recipient": "GesAj2dTn2wdNcxj4x8qsqS9aNRVPBPkE76aaqg7skxu",
   * //         "base_fee_recipient": "5YHi1HsxobLiTD6NQfHJQpoPoRjMuNyXp4RroTvR6dKi",
   * //         "params_account": "4yTBVZZQLiYi2p2xgwQXPb329z9jsQnhoPJyGmF3R4hb",
   * //         "swap_fee": 1000,
   * //         "borrow_fee": 1200,
   * //         "fee_discount_flag": 0,
   * //         "name": "AutoCreatedToken",
   * //         "symbol": "ACT",
   * //         "uri": "https://example.com/token-metadata.json",
   * //         "up_orderbook": "E63BemzshShTMk3Cbm7wYzm5muS6inokKM1hZWM8aDwp",
   * //         "down_orderbook": "CSva3cHwTYsJiK21H9Li4HL9pVzvA1hhy98noYBsbvxb",
   * //         "latest_price": "2795899347623485554",
   * //         "created_at": 1763804750,
   * //         "created_slot": 3156632,
   * //         "updated_at": 1763804750,
   * //         "extras": {}
   * //       }
   * //     ],
   * //     "total": 5,
   * //     "next_cursor": "1763774111"
   * //   }
   * // }
   *
   * // Use pagination with cursor:
   * const page1 = await sdk.fast.mints({ limit: 5 });
   * const page2 = await sdk.fast.mints({ limit: 5, before_timestamp: page1.data.next_cursor });
   *
   * // Access token data:
   * const tokens = result.data.tokens; // 完整代币对象数组
   * const mintAddresses = tokens.map(t => t.mint_account); // 提取代币地址
   */
  async mints(options = {}) {
    const params = {
      limit: options.limit || 10
    };

    // Add cursor if provided
    if (options.before_timestamp) {
      params.before_timestamp = options.before_timestamp;
    }

    return this._directApiCall({
      endpoint: '/api/tokens/latest',
      method: 'GET'
    }, params);
  }

  /**
   * Get token details (获取代币详情信息)
   * @param {string} mint - Token mint address (代币地址)
   * @returns {Promise<Object>} Token details data
   *
   * @example
   * // Get single token details
   * const info = await sdk.fast.mint_info('Dj5FhAmbQ2qNDUXQV3ST2kJXTH3C3B6mrwfYXPhGb6ea');
   * // Return format:
   * // {
   * //   "code": 200,
   * //   "msg": "success",
   * //   "data": {
   * //     "payer": "8iGFeUkRpyRx8w5uoUMbfZepUr6BfTdPuJmqGoNBntdb",
   * //     "mint_account": "Dj5FhAmbQ2qNDUXQV3ST2kJXTH3C3B6mrwfYXPhGb6ea",
   * //     "curve_account": "3hhFqoPi4C4urNfxCW5iwdSZPg6bQbNc4mwWtuagDsEn",
   * //     "pool_token_account": "DTLk1p97Z5tFaZGRSV6qSkogf3gBfj57Jt1xMCAwwBGJ",
   * //     "pool_sol_account": "8oxE8wS1Zu4nktRyZqCiTXi6wEburBtRLszLHuZoyJ4b",
   * //     "fee_recipient": "GesAj2dTn2wdNcxj4x8qsqS9aNRVPBPkE76aaqg7skxu",
   * //     "base_fee_recipient": "5YHi1HsxobLiTD6NQfHJQpoPoRjMuNyXp4RroTvR6dKi",
   * //     "params_account": "4yTBVZZQLiYi2p2xgwQXPb329z9jsQnhoPJyGmF3R4hb",
   * //     "swap_fee": 1000,
   * //     "borrow_fee": 1200,
   * //     "fee_discount_flag": 0,
   * //     "name": "AutoCreatedToken",
   * //     "symbol": "ACT",
   * //     "uri": "https://example.com/token-metadata.json",
   * //     "up_orderbook": "8gYvmYKFNk6PN78yET2BB6xtyCKaEMgn65b6TA8VFMkM",
   * //     "down_orderbook": "6kk8XC3z1WUFJD8GHqqgi79GmoKd9houJ8GUEXk8ki6N",
   * //     "latest_price": "2795899347623485554",
   * //     "created_at": 1763777802,
   * //     "created_slot": 3090283,
   * //     "updated_at": 1763777802,
   * //     "extras": {}
   * //   }
   * // }
   *
   * // Access token data:
   * const tokenData = info.data;
   * const mintAccount = tokenData.mint_account;
   * const latestPrice = tokenData.latest_price;
   */
  async mint_info(mint) {
    // Validate input
    if (!mint || typeof mint !== 'string') {
      throw new Error('mint_info: 代币地址必须是有效的字符串');
    }

    return this._directApiCall({
      endpoint: '/api/tokens/mint',
      method: 'GET',
      usePathParam: true
    }, { mint });
  }

  /**
   * 直接API调用方法
   * @private
   * @param {Object} config - 数据配置
   * @param {Object} params - 请求参数
   * @returns {Promise<Object>} API响应数据
   */
  async _directApiCall(config, params = {}) {
    // Ensure FastModule is properly configured before making API calls
    this._ensureConfigured();

    try {
      let url = config.endpoint;
      let queryParams = { ...params };

      // Handle path parameters (e.g., /api/tokens/mint/:mint)
      if (config.usePathParam && params.mint) {
        url = `${config.endpoint}/${params.mint}`;
        delete queryParams.mint; // Remove from query params
      }

      const requestConfig = {
        method: config.method || 'GET',
        url: url
      };

      // 根据请求方法设置参数
      if (config.method === 'POST') {
        requestConfig.data = queryParams; // POST 请求使用 data
      } else {
        requestConfig.params = queryParams; // GET 请求使用 params
      }

      const response = await this.httpClient.request(requestConfig);

      // 检查新旧API响应格式
      // 新格式: { code: 200, msg: "success", data: {...} }
      // 旧格式: { success: true, data: {...}, message: "..." }
      const isNewFormat = response.data && typeof response.data.code === 'number';
      const isOldFormat = response.data && typeof response.data.success === 'boolean';

      if (isNewFormat) {
        // 新 API 格式
        if (response.data.code !== 200) {
          throw new Error(`API请求失败: ${response.data.msg || '未知错误'}`);
        }
      } else if (isOldFormat) {
        // 旧 API 格式（向后兼容）
        if (!response.data.success) {
          throw new Error(`API请求失败: ${response.data.message || '未知错误'}`);
        }
      } else {
        // 未知格式
        throw new Error('API返回格式无法识别');
      }

      return response.data;

    } catch (error) {
      if (error.response) {
        // API返回错误
        const errorMsg = error.response.data?.msg || error.response.data?.message || error.message;
        throw new Error(`API请求失败 [${error.response.status}]: ${errorMsg}`);
      } else if (error.request) {
        // 网络错误
        throw new Error(`网络请求失败: 无法连接到 ${this.baseUrl}`);
      } else {
        // 其他错误
        throw new Error(`请求处理失败: ${error.message}`);
      }
    }
  }



  /**
   * 获取订单数据 Get Orders Data (查询活跃订单 Active Orders)
   * @param {string} mint - 代币地址 Token mint address
   * @param {Object} options - 查询参数 Query parameters
   * @param {string} options.type - 订单类型 Order type: "up_orders" (做空/short) 或 "down_orders" (做多/long)
   * @param {number} options.page - 页码，默认1 Page number, default 1
   * @param {number} options.limit - 每页数量，默认500 Items per page, default 500
   * @returns {Promise<Object>} 订单数据，包含订单列表及分页信息 Order data with order list and pagination info
   *
   * @example
   * // 获取做多订单 Get long orders
   * const ordersData = await sdk.fast.orders('T3NFPvYvpULCTgrhHb4b4Sj5J1qtSNvyKZfE8hCvuKM', { type: 'down_orders' });
   *
   * // 返回值示例 Return value example (compatible with chain.js format):
   * // {
   * //   "success": true,
   * //   "data": {
   * //     "orders": [
   * //       {
   * //         "index": 0,                                            // 订单在 OrderBook 中的索引位置
   * //         "user": "7621yjkZJ1jxBHw3oCPoazFfMx82NWBSARk2AGV7EBig",   // 用户地址
   * //         "lock_lp_start_price": "2656104380242311276",          // LP 开始价格（字符串）
   * //         "lock_lp_end_price": "2325402748045870207",            // LP 结束价格（字符串）
   * //         "open_price": "2795899347623485554",                   // 开仓价格（字符串）
   * //         "order_id": "0",                                       // 订单 ID（字符串）
   * //         "lock_lp_sol_amount": 1880793407,                      // LP 锁定 SOL 数量（lamports）
   * //         "lock_lp_token_amount": 75677963031921,                // LP 锁定代币数量（最小单位）
   * //         "next_lp_sol_amount": 0,                               // Next LP SOL 数量
   * //         "next_lp_token_amount": 0,                             // Next LP Token 数量
   * //         "margin_init_sol_amount": 418211213,                   // 初始保证金
   * //         "margin_sol_amount": 418211213,                        // 保证金 SOL 数量（lamports）
   * //         "borrow_amount": 2276435100,                           // 借款数量（lamports）
   * //         "position_asset_amount": 75677963031921,               // 持仓资产数量（最小单位）
   * //         "realized_sol_amount": 0,                              // 已实现收益
   * //         "version": 2,                                          // 版本号
   * //         "start_time": 1764047379,                              // 开始时间（Unix 时间戳）
   * //         "end_time": 1764652179,                                // 结束时间（Unix 时间戳）
   * //         "next_order": 1,                                       // 链表中下一个订单索引 (65535=none)
   * //         "prev_order": 65535,                                   // 链表中上一个订单索引 (65535=none)
   * //         "borrow_fee": 1200,                                    // 借款费用（基点，1200 = 12%）
   * //         "order_type": "down_orders"                            // 订单类型（字符串）
   * //       }
   * //     ],
   * //     "total": 10,                                               // 总订单数量 (total_count)
   * //     "order_type": "down_orders",                               // 订单类型（字符串）
   * //     "mint_account": "T3NFPvYvpULCTgrhHb4b4Sj5J1qtSNvyKZfE8hCvuKM", // 查询的代币地址
   * //     "page": 1,                                                 // 当前页码
   * //     "limit": 3,                                                // 每页限制
   * //     "has_next": true,                                          // 是否有下一页
   * //     "has_prev": false                                          // 是否有上一页
   * //   },
   * //   "message": "Operation successful"                            // 操作结果消息
   * // }
   *
   * // 访问订单数据 Access order data:
   * const orders = ordersData.data.orders;                        // 订单数组
   * const totalOrders = ordersData.data.total;                    // 总订单数量
   * const firstOrder = orders[0];                                 // 第一个订单
   * const userAddress = firstOrder.user;                          // 用户地址
   * const marginAmount = firstOrder.margin_sol_amount;            // 保证金数量（lamports）
   * const borrowFee = firstOrder.borrow_fee;                      // 借款费用（基点）
   *
   * // 获取做空订单 Get short orders:
   * const shortOrders = await sdk.fast.orders(mint, { type: 'up_orders' });
   *
   * // 分页获取订单 Get paginated orders:
   * const pageTwo = await sdk.fast.orders(mint, { type: 'down_orders', page: 2, limit: 100 });
   */
  async orders(mint, options = {}) {
    // Ensure FastModule is properly configured
    this._ensureConfigured();

    try {
      // Parameter validation
      if (!mint || typeof mint !== 'string') {
        throw new Error('orders: mint address must be a valid string');
      }

      // Extract parameters with defaults
      const type = options.type || 'down_orders';
      const page = options.page || 1;
      const pageSize = options.limit || 55000;

      // Validate order type
      if (!['up_orders', 'down_orders'].includes(type)) {
        throw new Error('orders: order type must be "up_orders" or "down_orders"');
      }

      // Convert type to direction for new API
      // "up_orders" = short orders = direction 'up'
      // "down_orders" = long orders = direction 'dn'
      const direction = type === 'up_orders' ? 'up' : 'dn';

      // Build API endpoint path: /api/orderbook/{mint}/{direction}
      const url = `/api/orderbook/${mint}/${direction}`;

      // Build query parameters
      const queryParams = {
        page: page,
        page_size: pageSize
      };

      // Make API request
      const requestConfig = {
        method: 'GET',
        url: url,
        params: queryParams
      };

      const response = await this.httpClient.request(requestConfig);

      // Check new API response format
      const isNewFormat = response.data && typeof response.data.code === 'number';

      if (!isNewFormat) {
        throw new Error('API返回格式无法识别');
      }

      if (response.data.code !== 200) {
        throw new Error(`API请求失败: ${response.data.msg || '未知错误'}`);
      }

      // Transform new API format to match chain.js format for compatibility
      const apiData = response.data.data;

      // Process orders: convert order_type from number to string, ensure all fields are properly formatted
      const processedOrders = apiData.orders.map(order => ({
        // Keep index from API (physical slot index in OrderBook)
        index: order.index,

        // User address
        user: order.user,

        // Price fields (keep as strings)
        lock_lp_start_price: order.lock_lp_start_price,
        lock_lp_end_price: order.lock_lp_end_price,
        open_price: order.open_price,

        // Order ID (ensure string)
        order_id: order.order_id != null ? order.order_id.toString() : undefined,

        // Amount fields
        lock_lp_sol_amount: order.lock_lp_sol_amount,
        lock_lp_token_amount: order.lock_lp_token_amount,
        next_lp_sol_amount: order.next_lp_sol_amount,
        next_lp_token_amount: order.next_lp_token_amount,

        // Margin fields
        margin_init_sol_amount: order.margin_init_sol_amount,
        margin_sol_amount: order.margin_sol_amount,

        // Position fields
        borrow_amount: order.borrow_amount,
        position_asset_amount: order.position_asset_amount,
        realized_sol_amount: order.realized_sol_amount,

        // Version
        version: order.version,

        // Time fields
        start_time: order.start_time,
        end_time: order.end_time,

        // Linked list navigation
        next_order: order.next_order,
        prev_order: order.prev_order,

        // Fee
        borrow_fee: order.borrow_fee,

        // Convert order_type number to string to match chain.js format
        // order_type 1 = down_orders (long), order_type 2 = up_orders (short)
        order_type: order.order_type === 1 ? 'down_orders' : 'up_orders',

        // Add mint field for compatibility with chain.js (not in API response, use function parameter)
        mint: mint
      }));

      // Sort orders by lock_lp_start_price
      // down_orders (做多): descending order (从大到小)
      // up_orders (做空): ascending order (从小到大)
      processedOrders.sort((a, b) => {
        const priceA = BigInt(a.lock_lp_start_price);
        const priceB = BigInt(b.lock_lp_start_price);

        if (type === 'down_orders') {
          // 做多订单：从大到小排列
          return priceB > priceA ? 1 : (priceB < priceA ? -1 : 0);
        } else {
          // 做空订单：从小到大排列
          return priceA > priceB ? 1 : (priceA < priceB ? -1 : 0);
        }
      });

      // Return in chain.js compatible format
      return {
        success: true,
        data: {
          orders: processedOrders,
          total: apiData.total_count,  // Use total_count from API
          order_type: type,  // Keep original type parameter for compatibility
          mint_account: mint,  // Add mint_account for compatibility
          page: apiData.page,
          limit: apiData.page_size,  // Map page_size to limit
          has_next: apiData.page < apiData.total_pages,  // Calculate has_next
          has_prev: apiData.page > 1  // Calculate has_prev
        },
        message: "Operation successful"
      };

    } catch (error) {
      if (error.response) {
        // API returned error
        const errorMsg = error.response.data?.msg || error.response.data?.message || error.message;
        throw new Error(`API请求失败 [${error.response.status}]: ${errorMsg}`);
      } else if (error.request) {
        // Network error
        throw new Error(`网络请求失败: 无法连接到 ${this.baseUrl}`);
      } else {
        // Other errors
        throw new Error(`请求处理失败: ${error.message}`);
      }
    }
  }

  /**
   * Get token price (获取代币价格)
   * @param {string} mint - Token mint address (代币地址)
   * @returns {Promise<string>} Latest price string (最新价格字符串)
   *
   * @example
   * // Get token latest price
   * const price = await sdk.fast.price('Dj5FhAmbQ2qNDUXQV3ST2kJXTH3C3B6mrwfYXPhGb6ea');
   * console.log('Latest price:', price); // "2795899347623485554"
   */
  async price(mint) {
    // Validate input
    if (!mint || typeof mint !== 'string') {
      throw new Error('price: 代币地址必须是有效的字符串 mint address must be a valid string');
    }

    // Call mint_info API
    const result = await this.mint_info(mint);

    // Check return data (新格式: { code: 200, msg: "success", data: {...} })
    if (!result || !result.data) {
      throw new Error('price: 无法获取代币信息 Unable to fetch token information');
    }

    // Extract latest price (新格式直接返回对象，不是数组)
    let latestPrice = result.data.latest_price;

    if (!latestPrice) {
      // If no price data, calculate initial price
      const initialPrice = CurveAMM.getInitialPrice();
      if (initialPrice === null) {
        throw new Error('price: 无法计算初始价格 Unable to calculate initial price');
      }
      latestPrice = initialPrice.toString();
    }

    return latestPrice;
  }

  /**
   * Get User Active Orders (获取用户活跃订单)
   * Compatible with chain.js user_orders() method
   *
   * @param {string} user - User wallet address (用户钱包地址)
   * @param {string} mint - Token mint address (optional, null/undefined for all tokens) (代币地址，可选)
   * @param {Object} options - Query parameters (查询参数)
   * @param {string} options.direction - Order direction (optional: 'up'=short, 'dn'=long, omit=all) (订单方向)
   * @param {number} options.page - Page number, default 1 (页码，默认1)
   * @param {number} options.limit - Items per page, default 20 (每页数量，默认20)
   * @param {string} options.order_by - Sort order: 'start_time_desc' or 'start_time_asc', default 'start_time_desc' (排序方式)
   * @returns {Promise<Object>} User orders data compatible with chain.js format
   *
   * @example
   * // Get user's all active orders for a specific token
   * const userOrders = await sdk.fast.user_orders(
   *   '7621yjkZJ1jxBHw3oCPoazFfMx82NWBSARk2AGV7EBig',
   *   'T3NFPvYvpULCTgrhHb4b4Sj5J1qtSNvyKZfE8hCvuKM',
   *   { page: 1, limit: 20 }
   * );
   *
   * // Get user's long orders for a specific token
   * const longOrders = await sdk.fast.user_orders(
   *   '7621yjkZJ1jxBHw3oCPoazFfMx82NWBSARk2AGV7EBig',
   *   'T3NFPvYvpULCTgrhHb4b4Sj5J1qtSNvyKZfE8hCvuKM',
   *   { direction: 'dn' }
   * );
   *
   * // Get user's all active orders across all tokens (mint = null)
   * const allOrders = await sdk.fast.user_orders(
   *   '7621yjkZJ1jxBHw3oCPoazFfMx82NWBSARk2AGV7EBig',
   *   null,
   *   { page: 1, limit: 20 }
   * );
   *
   * // Return format (compatible with chain.js):
   * // {
   * //   "success": true,
   * //   "data": {
   * //     "orders": [
   * //       {
   * //         "order_type": 1,                                          // Order type: 1=long, 2=short
   * //         "mint": "T3NFPvYvpULCTgrhHb4b4Sj5J1qtSNvyKZfE8hCvuKM",     // Token address
   * //         "user": "7621yjkZJ1jxBHw3oCPoazFfMx82NWBSARk2AGV7EBig",   // User address
   * //         "lock_lp_start_price": "2656104380242311276",              // LP start price (string)
   * //         "lock_lp_end_price": "2325402748045870207",                // LP end price (string)
   * //         "open_price": "2795899347623485554",                       // Open price (string)
   * //         "order_id": "0",                                           // Order ID (u64 as string)
   * //         "lock_lp_sol_amount": 1880793407,                          // LP locked SOL (lamports)
   * //         "lock_lp_token_amount": 75677963031921,                    // LP locked token (min unit)
   * //         "next_lp_sol_amount": 0,                                   // Next LP SOL amount
   * //         "next_lp_token_amount": 0,                                 // Next LP token amount
   * //         "margin_init_sol_amount": 418211213,                       // Initial margin
   * //         "margin_sol_amount": 418211213,                            // Current margin
   * //         "borrow_amount": 2276435100,                               // Borrow amount
   * //         "position_asset_amount": 75677963031921,                   // Position asset amount
   * //         "realized_sol_amount": 0,                                  // Realized SOL amount
   * //         "start_time": 1764047379,                                  // Start timestamp
   * //         "end_time": 1764652179,                                    // End timestamp
   * //         "next_order": 1,                                           // Next order index (65535=none)
   * //         "prev_order": 65535,                                       // Previous order index (65535=none)
   * //         "borrow_fee": 1200,                                        // Borrow fee (basis points)
   * //         "index": 0                                                 // Order index in OrderBook
   * //       }
   * //     ],
   * //     "total": 37,                                                   // Total order count
   * //     "user": "7621yjkZJ1jxBHw3oCPoazFfMx82NWBSARk2AGV7EBig",        // User address
   * //     "mint_account": "T3NFPvYvpULCTgrhHb4b4Sj5J1qtSNvyKZfE8hCvuKM",  // Token address (null if not specified)
   * //     "page": 1,                                                     // Current page
   * //     "limit": 20,                                                   // Items per page
   * //     "has_next": true,                                              // Has next page
   * //     "has_prev": false                                              // Has previous page
   * //   },
   * //   "message": "Operation successful"
   * // }
   *
   * // Use order data:
   * const orders = userOrders.data.orders; // Order array
   * const totalCount = userOrders.data.total; // Total count
   */
  async user_orders(user, mint, options = {}) {
    this._ensureConfigured();

    try {
      // Parameter validation
      if (!user || typeof user !== 'string') {
        throw new Error('user_orders: user address must be a valid string');
      }

      // Extract parameters
      const page = options.page || 1;
      const pageSize = options.limit || 20;
      const direction = options.direction; // Optional: 'up', 'dn', or undefined
      const orderBy = options.order_by || 'start_time_desc';

      // Build API path: /api/orderbook/user/{user}/active
      const url = `/api/orderbook/user/${user}/active`;

      // Build query parameters
      const queryParams = {
        page: page,
        page_size: pageSize
      };

      // Optional parameter: mint (if provided and valid)
      if (mint && typeof mint === 'string') {
        queryParams.mint = mint;
      }

      // Optional parameter: direction
      if (direction) {
        if (!['up', 'dn'].includes(direction)) {
          throw new Error('user_orders: direction must be "up" or "dn"');
        }
        queryParams.direction = direction;
      }

      // Make API request
      const requestConfig = {
        method: 'GET',
        url: url,
        params: queryParams
      };

      const response = await this.httpClient.request(requestConfig);

      // Check new API response format
      const isNewFormat = response.data && typeof response.data.code === 'number';

      if (!isNewFormat) {
        throw new Error('API返回格式无法识别');
      }

      if (response.data.code !== 200) {
        throw new Error(`API请求失败: ${response.data.msg || '未知错误'}`);
      }

      // Transform to chain.js compatible format
      const apiData = response.data.data;

      // Process orders: add missing fields for chain.js compatibility
      let processedOrders = apiData.orders.map(order => ({
        // Keep order_type as number (1=long, 2=short) - compatible with chain.js
        order_type: order.order_type,

        // Token and user addresses
        mint: order.mint,
        user: order.user,

        // Price fields (keep as strings)
        lock_lp_start_price: order.lock_lp_start_price,
        lock_lp_end_price: order.lock_lp_end_price,
        open_price: order.open_price,

        // Order ID (ensure string)
        order_id: order.order_id != null ? order.order_id.toString() : undefined,

        // Amount fields
        lock_lp_sol_amount: order.lock_lp_sol_amount,
        lock_lp_token_amount: order.lock_lp_token_amount,
        next_lp_sol_amount: order.next_lp_sol_amount,
        next_lp_token_amount: order.next_lp_token_amount,

        // Margin fields
        margin_init_sol_amount: order.margin_init_sol_amount,
        margin_sol_amount: order.margin_sol_amount,

        // Position fields
        borrow_amount: order.borrow_amount,
        position_asset_amount: order.position_asset_amount,
        realized_sol_amount: order.realized_sol_amount,

        // Time fields
        start_time: order.start_time,
        end_time: order.end_time,

        // Linked list navigation fields (add from API response)
        next_order: order.next_order,
        prev_order: order.prev_order,

        // Fee field
        borrow_fee: order.borrow_fee,

        // Index field (add from API response)
        index: order.index
      }));

      // Client-side sorting (API doesn't support sorting)
      if (orderBy === 'start_time_desc') {
        processedOrders.sort((a, b) => b.start_time - a.start_time);
      } else if (orderBy === 'start_time_asc') {
        processedOrders.sort((a, b) => a.start_time - b.start_time);
      }

      // Calculate pagination info
      const totalPages = Math.ceil(apiData.total / apiData.page_size);

      // Return in chain.js compatible format
      return {
        success: true,
        data: {
          orders: processedOrders,
          total: apiData.total,
          user: user,
          mint_account: mint || null, // If mint not specified, return null
          page: apiData.page,
          limit: apiData.page_size,
          has_next: apiData.page < totalPages,
          has_prev: apiData.page > 1
        },
        message: "Operation successful"
      };

    } catch (error) {
      if (error.response) {
        const errorMsg = error.response.data?.msg || error.response.data?.message || error.message;
        throw new Error(`API请求失败 [${error.response.status}]: ${errorMsg}`);
      } else if (error.request) {
        throw new Error(`网络请求失败: 无法连接到 ${this.baseUrl}`);
      } else {
        throw new Error(`请求处理失败: ${error.message}`);
      }
    }
  }




}

module.exports = FastModule;
