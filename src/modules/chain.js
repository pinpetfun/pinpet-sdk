
const { PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const CurveAMM = require('../utils/curve_amm');
// 统一使用 buffer 包，所有平台一致
const { Buffer } = require('buffer');

/**
 * Chain Data Module
 * When no auxiliary server is available, directly call on-chain data to get transaction parameters
 * The downside is that during peak trading periods, on-chain data may have delays, causing transaction failures
 * Provides functionality to read account data from Solana blockchain
 */
class ChainModule {
  constructor(sdk) {
    this.sdk = sdk;
  }

  /**
   * Get complete curve_account (BorrowingBondingCurve) data
   * 
   * Read the borrowing liquidity pool account data for a specified token from the blockchain,
   * including addresses and balance information for all related accounts.
   * This function automatically calculates related PDA addresses and concurrently queries all balances,
   * providing complete liquidity pool status.
   * 
   * @param {string|PublicKey} mint - Token mint account address
   * 
   * @returns {Promise<Object>} Complete BorrowingBondingCurve account data object
   * 
   * @returns {Promise<Object>} Return object contains following complete fields:
   * 
   * **Core Reserve Data:**
   * @returns {bigint} returns.lpTokenReserve - LP Token reserves, total reserves of liquidity provider tokens
   * @returns {bigint} returns.lpSolReserve - LP SOL reserves, SOL reserves in the liquidity pool
   * @returns {bigint} returns.price - Current token price, calculated based on AMM algorithm
   * @returns {bigint} returns.borrowTokenReserve - Borrowable Token reserves, borrowable token reserves
   * @returns {bigint} returns.borrowSolReserve - Borrowable SOL reserves, borrowable SOL reserves
   * 
   * **Fee and Parameter Configuration:**
   * @returns {number} returns.swapFee - Swap fee rate, expressed in basis points (e.g. 100 = 1%)
   * @returns {number} returns.borrowFee - Borrow fee rate, expressed in basis points
   * @returns {boolean} returns.feeDiscountFlag - Fee discount flag, whether fee discounts are enabled
   * @returns {number} returns.feeSplit - Fee split ratio, determines how fees are distributed among different recipients
   * @returns {number} returns.borrowDuration - Borrow duration, in seconds
   * @returns {number} returns.bump - curve_account PDA bump seed
   * 
   * **Account Addresses:**
   * @returns {string} returns.baseFeeRecipient - Base fee recipient address, receives base transaction fees
   * @returns {string} returns.feeRecipient - Fee recipient address, receives additional fee income
   * @returns {string} returns.mint - Token mint account address
   * @returns {string|null} returns.upHead - Up order linked list head account address, null if none
   * @returns {string|null} returns.downHead - Down order linked list head account address, null if none
   * @returns {string} returns.poolTokenAccount - Pool token account address, stores tokens in the liquidity pool
   * @returns {string} returns.poolSolAccount - Pool SOL account address, stores native SOL in the liquidity pool
   * 
   * **Balance Information:**
   * @returns {number} returns.baseFeeRecipientBalance - SOL balance of base fee recipient address (lamports)
   * @returns {number} returns.feeRecipientBalance - SOL balance of fee recipient address (lamports)
   * @returns {bigint} returns.poolTokenBalance - Token balance of pool token account
   * @returns {number} returns.poolSolBalance - SOL balance of pool SOL account (lamports)
   * 
   * **Metadata:**
   * @returns {Object} returns._metadata - Additional metadata information
   * @returns {string} returns._metadata.accountAddress - Complete address of curve_account
   * @returns {string} returns._metadata.mintAddress - Input token mint address
   * 
   * @throws {Error} Throws error when curve_account does not exist
   * @throws {Error} Throws error when unable to decode account data
   * @throws {Error} Throws error when network connection fails
   * 
   * @example
   * // Basic usage example
   * try {
   *   const curveData = await sdk.chain.getCurveAccount('3YggGtxXEGBbjK1WLj2Z79doZC2gkCWXag1ag8BD4cYY');
   *   
   *   // Display core reserve information
   *   console.log('=== Core Reserve Data ===');
   *   console.log('LP Token reserves:', curveData.lpTokenReserve.toString());
   *   console.log('LP SOL reserves:', curveData.lpSolReserve.toString());
   *   console.log('Current price:', curveData.price.toString());
   *   console.log('Borrow Token reserves:', curveData.borrowTokenReserve.toString());
   *   console.log('Borrow SOL reserves:', curveData.borrowSolReserve.toString());
   *   
   *   // Display fee configuration
   *   console.log('=== Fee Configuration ===');
   *   console.log('Swap fee rate:', curveData.swapFee / 100, '%');
   *   console.log('Borrow fee rate:', curveData.borrowFee / 100, '%');
   *   console.log('Fee discount:', curveData.feeDiscountFlag ? 'Enabled' : 'Disabled');
   *   console.log('Borrow duration:', curveData.borrowDuration, 'seconds');
   *   
   *   // Display account addresses
   *   console.log('=== Account Addresses ===');
   *   console.log('Base fee recipient address:', curveData.baseFeeRecipient);
   *   console.log('Fee recipient address:', curveData.feeRecipient);
   *   console.log('Pool token account:', curveData.poolTokenAccount);
   *   console.log('Pool SOL account:', curveData.poolSolAccount);
   *   
   *   // Display balance information
   *   console.log('=== Balance Information ===');
   *   console.log('Base fee recipient balance:', curveData.baseFeeRecipientBalance / 1e9, 'SOL');
   *   console.log('Fee recipient balance:', curveData.feeRecipientBalance / 1e9, 'SOL');
   *   console.log('Pool token balance:', curveData.poolTokenBalance.toString());
   *   console.log('Pool SOL balance:', curveData.poolSolBalance / 1e9, 'SOL');
   *   
   *   // Display linked list head information
   *   console.log('=== Order Linked Lists ===');
   *   console.log('Up order head:', curveData.upHead || 'Empty');
   *   console.log('Down order head:', curveData.downHead || 'Empty');
   *   
   * } catch (error) {
   *   console.error('Failed to get curve account:', error.message);
   * }
   * 
   * @example
   * // Pool monitoring example
   * async function monitorPool(mintAddress) {
   *   const data = await sdk.chain.getCurveAccount(mintAddress);
   *   
   *   // Calculate pool utilization
   *   const tokenUtilization = Number(data.lpTokenReserve - data.poolTokenBalance) / Number(data.lpTokenReserve);
   *   const solUtilization = Number(data.lpSolReserve - BigInt(data.poolSolBalance)) / Number(data.lpSolReserve);
   *   
   *   console.log('Token utilization:', (tokenUtilization * 100).toFixed(2), '%');
   *   console.log('SOL utilization:', (solUtilization * 100).toFixed(2), '%');
   *   
   *   // Check fee earnings
   *   const totalFeeBalance = data.baseFeeRecipientBalance + data.feeRecipientBalance;
   *   console.log('Total fee earnings:', totalFeeBalance / 1e9, 'SOL');
   *   
   *   return {
   *     tokenUtilization,
   *     solUtilization,
   *     totalFeeBalance,
   *     currentPrice: data.price
   *   };
   * }
   * 
   * @since 1.0.0
   * @version 1.1.0 - Added liquidity pool account balance query functionality
   * @author SpinPet SDK Team
   */
  async getCurveAccount(mint) {
    try {
      // Parameter validation and conversion
      const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;

      // Calculate curve_account PDA address
      // Use the same seeds as in the contract: [b"borrowing_curve", mint_account.key().as_ref()]
      const [curveAccountPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("borrowing_curve"),
          mintPubkey.toBuffer()
        ],
        this.sdk.programId
      );

      // Use Anchor program to fetch account data directly
      // Method 1: Use program's fetch method
      let decodedData;
      try {
        decodedData = await this.sdk.program.account.borrowingBondingCurve.fetch(curveAccountPDA);
      } catch (fetchError) {
        // Method 2: If fetch fails, use raw method
        const accountInfo = await this.sdk.connection.getAccountInfo(curveAccountPDA);
        if (!accountInfo) {
          throw new Error(`curve_account does not exist`);
        }

        // Manually decode with BorshAccountsCoder
        const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);

        // Try different account names
        try {
          decodedData = accountsCoder.decode('BorrowingBondingCurve', accountInfo.data);
        } catch (decodeError1) {
          try {
            // Try lowercase name
            decodedData = accountsCoder.decode('borrowingBondingCurve', accountInfo.data);
          } catch (decodeError2) {
            // Both failed, throw original error
            throw new Error(`Cannot decode account data: ${decodeError1.message}`);
          }
        }
      }

      // Calculate pool account PDA addresses
      const [poolTokenAccountPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool_token"),
          mintPubkey.toBuffer()
        ],
        this.sdk.programId
      );

      const [poolSolAccountPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("pool_sol"),
          mintPubkey.toBuffer()
        ],
        this.sdk.programId
      );

      // Query all balances concurrently
      const [
        baseFeeRecipientBalance,
        feeRecipientBalance,
        poolTokenBalance,
        poolSolBalance
      ] = await Promise.all([
        this.sdk.connection.getBalance(decodedData.baseFeeRecipient),
        this.sdk.connection.getBalance(decodedData.feeRecipient),
        this.sdk.connection.getTokenAccountBalance(poolTokenAccountPDA).catch(() => ({ value: { amount: '0' } })),
        this.sdk.connection.getBalance(poolSolAccountPDA)
      ]);

      // Convert data format
      const convertedData = {
        // BN types convert to bigint
        lpTokenReserve: BigInt(decodedData.lpTokenReserve.toString()),
        lpSolReserve: BigInt(decodedData.lpSolReserve.toString()),
        price: BigInt(decodedData.price.toString()),
        borrowTokenReserve: BigInt(decodedData.borrowTokenReserve.toString()),
        borrowSolReserve: BigInt(decodedData.borrowSolReserve.toString()),

        // Numeric types remain unchanged
        swapFee: decodedData.swapFee,
        borrowFee: decodedData.borrowFee,
        feeDiscountFlag: decodedData.feeDiscountFlag,
        feeSplit: decodedData.feeSplit,
        borrowDuration: decodedData.borrowDuration,
        bump: decodedData.bump,

        // PublicKey types convert to string
        baseFeeRecipient: decodedData.baseFeeRecipient.toString(),
        feeRecipient: decodedData.feeRecipient.toString(),
        mint: decodedData.mint.toString(),
        upHead: decodedData.upHead ? decodedData.upHead.toString() : null,
        downHead: decodedData.downHead ? decodedData.downHead.toString() : null,

        // SOL balance information
        baseFeeRecipientBalance: baseFeeRecipientBalance,  // Unit: lamports
        feeRecipientBalance: feeRecipientBalance,          // Unit: lamports

        // Pool account information
        poolTokenAccount: poolTokenAccountPDA.toString(),           // Pool token account address
        poolSolAccount: poolSolAccountPDA.toString(),               // Pool SOL account address
        poolTokenBalance: BigInt(poolTokenBalance.value.amount),    // Pool token balance
        poolSolBalance: poolSolBalance,                             // Pool SOL balance (lamports)

        // Additional metadata
        _metadata: {
          accountAddress: curveAccountPDA.toString(),
          mintAddress: mintPubkey.toString()
        }
      };

      // Return converted data
      return convertedData;

    } catch (error) {
      // Provide concise error information
      if (error.message.includes('Account does not exist')) {
        throw new Error(`curve_account does not exist for mint: ${mint}`);
      } else {
        throw new Error(`Failed to get curve_account: ${error.message}`);
      }
    }
  }

  /**
   * Batch get multiple tokens' curve_account data
   * 
   * @param {Array<string|PublicKey>} mints - Array of token addresses
   * @returns {Promise<Object>} Object containing success and error results
   * 
   * @example
   * const curveDataList = await sdk.chain.getCurveAccountBatch([
   *   '3YggGtxXEGBbjK1WLj2Z79doZC2gkCWXag1ag8BD4cYY',
   *   'AnotherTokenMintAddress'
   * ]);
   */
  async getCurveAccountBatch(mints) {
    if (!Array.isArray(mints)) {
      throw new Error('mints parameter must be an array');
    }

    const results = [];
    const errors = [];

    // Concurrently get all data
    const promises = mints.map(async (mint, index) => {
      try {
        const data = await this.getCurveAccount(mint);
        return { index, success: true, data, mint: mint.toString() };
      } catch (error) {
        return { index, success: false, error: error.message, mint: mint.toString() };
      }
    });

    const settled = await Promise.allSettled(promises);

    // Process results
    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];

      if (result.status === 'fulfilled') {
        const { success, data, error, mint } = result.value;

        if (success) {
          results.push(data);
        } else {
          errors.push({ mint, error });
        }
      } else {
        errors.push({
          mint: mints[i].toString(),
          error: result.reason?.message || 'Unknown error'
        });
      }
    }

    return {
      success: results,
      errors: errors,
      total: mints.length,
      successCount: results.length,
      errorCount: errors.length
    };
  }

  /**
   * Calculate curve_account PDA address
   * 
   * @param {string|PublicKey} mint - Token mint address
   * @returns {PublicKey} curve_account PDA address
   * 
   * @example
   * const curveAddress = sdk.chain.getCurveAccountAddress('3YggGtxXEGBbjK1WLj2Z79doZC2gkCWXag1ag8BD4cYY');
   * console.log('Curve Account Address:', curveAddress.toString());
   */
  getCurveAccountAddress(mint) {
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;

    const [curveAccountPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("borrowing_curve"),
        mintPubkey.toBuffer()
      ],
      this.sdk.programId
    );

    return curveAccountPDA;
  }

  /**
   * Get price data (read price from chain curveAccountPDA)
   * @param {string} mint - Token address
   * @returns {Promise<string>} Latest price string
   * 
   * @example
   * // Get latest token price
   * const price = await sdk.chain.price('56hfrQYiyRSUZdRKDuUvsqRik8j2UDW9kCisy7BiRxmg');
   * console.log('Latest price:', price); // "13514066072452801812769"
   */
  async price(mint) {
    // Validate input
    if (!mint || typeof mint !== 'string') {
      throw new Error('price: mint address must be a valid string');
    }

    try {
      // Parameter validation and conversion
      let mintPubkey;
      try {
        mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;
      } catch (pubkeyError) {
        throw new Error(`Invalid mint address: ${mint}`);
      }

      // Validate mintPubkey
      if (!mintPubkey || typeof mintPubkey.toBuffer !== 'function') {
        throw new Error(`Invalid mintPubkey`);
      }

      // Calculate curve_account PDA address
      const [curveAccountPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("borrowing_curve"),
          mintPubkey.toBuffer()
        ],
        this.sdk.programId
      );

      // Use Anchor program to fetch account data directly
      let decodedData;
      try {
        decodedData = await this.sdk.program.account.borrowingBondingCurve.fetch(curveAccountPDA);
      } catch (fetchError) {
        // If fetch fails, use raw method
        const accountInfo = await this.sdk.connection.getAccountInfo(curveAccountPDA);
        if (!accountInfo) {
          throw new Error(`curve_account does not exist`);
        }

        // Manually decode with BorshAccountsCoder
        const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);

        try {
          decodedData = accountsCoder.decode('BorrowingBondingCurve', accountInfo.data);
        } catch (decodeError1) {
          try {
            decodedData = accountsCoder.decode('borrowingBondingCurve', accountInfo.data);
          } catch (decodeError2) {
            throw new Error(`Cannot decode account data: ${decodeError1.message}`);
          }
        }
      }

      // Check price data and return
      if (decodedData.price && decodedData.price.toString() !== '0') {
        return decodedData.price.toString();
      } else {
        // If no price data, return initial price
        const initialPrice = CurveAMM.getInitialPrice();
        if (initialPrice === null) {
          throw new Error('price: Unable to calculate initial price');
        }
        return initialPrice.toString();
      }

    } catch (error) {
      // If getting fails, return initial price
      console.warn(`price: Failed to get chain price, using initial price: ${error.message}`);

      const initialPrice = CurveAMM.getInitialPrice();
      if (initialPrice === null) {
        throw new Error('price: Unable to calculate initial price');
      }
      return initialPrice.toString();
    }
  }

  /**
   * Get Orders Data (Read from Chain)
   * @param {string} mint - Token mint address
   * @param {Object} options - Query parameters
   * @param {string} options.type - Order type: "up_orders" (short) or "down_orders" (long)
   * @param {number} options.page - Page number, default 1
   * @param {number} options.limit - Items per page, default 500, max 1000
   * @returns {Promise<Object>} Order data with raw order list
   * 
   * @example
   * // Get long orders
   * const ordersData = await sdk.chain.orders('6ZDJtGFTzrF3FaN5uaqa1h8EexW7BtQd4FwA9Dt7m3ee', { type: 'down_orders' });
   * 
   * // Return value example:
   * // {
   * //   "success": true,
   * //   "data": {
   * //     "orders": [
   * //       {
   * //         "order_type": "down_orders",                           // Order type string (converted)
   * //         "mint": "6ZDJtGFTzrF3FaN5uaqa1h8EexW7BtQd4FwA9Dt7m3ee", // Token address
   * //         "user": "JD1eNPaJpbtejKfgimbLYLkvpsTHyYzKCCozVLGLS6zu",   // User address
   * //         "lock_lp_start_price": "46618228118401293964111",        // LP start price (string)
   * //         "lock_lp_end_price": "45827474968448818396222",         // LP end price (string)
   * //         "lock_lp_sol_amount": 3299491609,                       // LP locked SOL amount (lamports)
   * //         "lock_lp_token_amount": 713848715669,                   // LP locked token amount (min unit)
   * //         "start_time": 1756352482,                               // Start time (Unix timestamp)
   * //         "end_time": 1756525282,                                 // End time (Unix timestamp)
   * //         "margin_sol_amount": 571062973,                         // Margin SOL amount (lamports)
   * //         "borrow_amount": 3860656108,                            // Borrow amount (lamports)
   * //         "position_asset_amount": 713848715669,                  // Position asset amount (min unit)
   * //         "borrow_fee": 300,                                      // Borrow fee (basis points, 300 = 3%)
   * //         "order_pda": "5aVwYyzvC5Y2qykDgwG8o7EUwCrL8WgCJpgxoH3mihYb" // Order PDA address
   * //       }
   * //     ],
   * //     "total": 12,                                                // Total order count
   * //     "order_type": "down_orders",                                // Order type (string)
   * //     "mint_account": "6ZDJtGFTzrF3FaN5uaqa1h8EexW7BtQd4FwA9Dt7m3ee", // Queried token address
   * //     "page": 1,                                                  // Current page number
   * //     "limit": 50,                                                // Per page limit
   * //     "has_next": false,                                          // Whether has next page
   * //     "has_prev": false                                           // Whether has previous page
   * //   },
   * //   "message": "Operation successful"                             // Operation result message
   * // }
   * 
   * // Use utility methods to process data:
   * const lpPairs = sdk.buildLpPairs(ordersData.data.orders);         // Build LP pairs array
   * const orderAccounts = sdk.buildOrderAccounts(ordersData.data.orders); // Build order accounts array
   */
  async orders(mint, options = {}) {
    try {
      // Parameter validation
      if (!mint || typeof mint !== 'string') {
        throw new Error('orders: mint address must be a valid string');
      }

      // Set default parameters
      const orderType = options.type || 'down_orders';
      const page = options.page || 1;
      const limit = Math.min(options.limit || 500, 1000); // Maximum 1000

      // Validate order type
      if (!['up_orders', 'down_orders'].includes(orderType)) {
        throw new Error('orders: order type must be "up_orders" or "down_orders"');
      }

      // Convert API type to linked list direction
      // "up_orders" = short orders = upHead
      // "down_orders" = long orders = downHead
      const direction = orderType === 'up_orders' ? 'upHead' : 'downHead';

      //console.log(`chain.orders: Get ${orderType} orders, mint=${mint}, limit=${limit}`);

      // Get curve_account data to get linked list head
      const curveData = await this.getCurveAccount(mint);
      const headAddress = curveData[direction];

      //console.log(`chain.orders: ${direction} linked list head address:`, headAddress || 'null');

      // If linked list is empty, return empty result
      if (!headAddress) {
        //console.log(`chain.orders: ${direction} linked list is empty`);
        return {
          success: true,
          data: {
            orders: [],
            total: 0,
            order_type: orderType,
            mint_account: mint,
            page: page,
            limit: limit,
            has_next: false,
            has_prev: false
          },
          message: "Operation successful"
        };
      }

      // Traverse linked list to read orders
      const orders = [];
      let currentAddress = new PublicKey(headAddress);
      let count = 0;

      //console.log(`chain.orders: Start traversing linked list from ${currentAddress.toString()}`);

      while (currentAddress && count < limit) {
        try {
          //console.log(`chain.orders: 遍历 Traversing [${count}] ${currentAddress.toString()}`);

          // Get raw account data
          const accountInfo = await this.sdk.connection.getAccountInfo(currentAddress);
          if (!accountInfo) {
            throw new Error(`Order account ${currentAddress.toString()} does not exist`);
          }

          // Manually decode with BorshAccountsCoder
          const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);
          let orderData;

          try {
            orderData = accountsCoder.decode('MarginOrder', accountInfo.data);
          } catch (decodeError1) {
            try {
              orderData = accountsCoder.decode('marginOrder', accountInfo.data);
            } catch (decodeError2) {
              console.log("orders 报错时的 accountInfo=", accountInfo);
              console.log("decodeError1=", decodeError1);
              throw new Error(`Cannot decode order account data: ${decodeError2.message}`);
            }
          }



          // try {
          //   // 尝试不同的账户类型名称
          //   orderData = accountsCoder.decode('MarginOrder', accountInfo.data);
          // } catch (decodeError1) {
          //   try {
          //     orderData = accountsCoder.decode('marginOrder', accountInfo.data);
          //   } catch (decodeError2) {
          //     try {
          //       // 使用 program.account 直接解码
          //       console.log(`使用 program.account 直接解码 PDA: ${pdaAddress}`);
          //       orderData = this.sdk.program.account.marginOrder.fetch(currentAddress);
          //     } catch (decodeError3) {
          //       error = `解码失败: MarginOrder[${decodeError1.message}] marginOrder[${decodeError2.message}] fetch[${decodeError3.message}]`;
          //       throw error
          //     }
          //   }
          // }





          // Data transformation
          const convertedOrder = {
            // Convert chain number to API string format
            order_type: orderData.orderType === 1 ? 'down_orders' : 'up_orders', // 1=long=down_orders, 2=short=up_orders
            mint: orderData.mint.toString(),
            user: orderData.user.toString(),
            // Convert BN type to string
            lock_lp_start_price: orderData.lockLpStartPrice.toString(),
            lock_lp_end_price: orderData.lockLpEndPrice.toString(),
            // Keep numeric types unchanged
            lock_lp_sol_amount: orderData.lockLpSolAmount.toNumber(),
            lock_lp_token_amount: orderData.lockLpTokenAmount.toNumber(),
            start_time: orderData.startTime,
            end_time: orderData.endTime,
            margin_init_sol_amount: orderData.marginInitSolAmount.toNumber(),
            margin_sol_amount: orderData.marginSolAmount.toNumber(),
            borrow_amount: orderData.borrowAmount.toNumber(),
            position_asset_amount: orderData.positionAssetAmount.toNumber(),
            borrow_fee: orderData.borrowFee,
            realized_sol_amount: orderData.realizedSolAmount.toNumber(),
            // Add order_pda field
            order_pda: currentAddress.toString()
          };

          orders.push(convertedOrder);
          count++;

          //console.log(`chain.orders: Successfully read order ${count}: ${currentAddress.toString()}, type=${convertedOrder.order_type}`);

          // Move to next node
          if (orderData.nextOrder) {
            currentAddress = orderData.nextOrder;
            //console.log(`chain.orders: 下一个 Next: ${currentAddress.toString()}`);
          } else {
            //console.log(`chain.orders: 链表结束 List ended at node ${count}`);
            break;
          }

          // Add 50ms delay to avoid calling too fast
          //await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
          // If order account doesn't exist or read fails, throw error
          console.log("A_chain.orders() err:", error);
          throw new Error(`Failed to read order: ${error.message}`);
        }
      }

      // Simulate pagination info
      const hasNext = count === limit; // If read limit reached, might have more
      const hasPrev = page > 1;

      //console.log(`chain.orders: Completed reading, got ${orders.length} orders`);

      // Return same format as fast.orders
      return {
        success: true,
        data: {
          orders: orders,
          total: orders.length, // Chain can't know total, use current count
          order_type: orderType,
          mint_account: mint,
          page: page,
          limit: limit,
          has_next: hasNext,
          has_prev: hasPrev
        },
        message: "Operation successful"
      };

    } catch (error) {
      // Error handling
      console.log("chain.orders() err:", error);
      console.error('chain.orders: Failed to get orders', error.message);
      throw new Error(`Failed to get orders: ${error.message}`);
    }
  }

  /**
   * Get MarginOrder account data by PDA address
   * 
   * Read the margin order account data for a specified PDA address from the blockchain,
   * including all order details and status information.
   * 
   * @param {string|PublicKey} pda - MarginOrder account PDA address
   * 
   * @returns {Promise<Object>} Complete MarginOrder account data object
   * 
   * @returns {Promise<Object>} Return object contains following complete fields:
   * 
   * **Core Order Data:**
   * @returns {number} returns.order_type - Order type: 1=long(做多), 2=short(做空)
   * @returns {string} returns.mint - Token mint account address
   * @returns {string} returns.user - User account address who created the order
   * @returns {string|null} returns.next_order - Next order PDA address in linked list, null if none
   * @returns {string|null} returns.prev_order - Previous order PDA address in linked list, null if none
   * 
   * **Price and Amount Data:**
   * @returns {string} returns.lock_lp_start_price - LP start price when order was created (u128 as string)
   * @returns {string} returns.lock_lp_end_price - LP end price when order was created (u128 as string)  
   * @returns {number} returns.lock_lp_sol_amount - LP locked SOL amount (lamports)
   * @returns {number} returns.lock_lp_token_amount - LP locked token amount (min unit)
   * @returns {number} returns.margin_sol_amount - Margin SOL amount (lamports)
   * @returns {number} returns.borrow_amount - Borrowed amount (lamports or min unit)
   * @returns {number} returns.position_asset_amount - Position asset amount (min unit)
   * 
   * **Time and Fee Data:**
   * @returns {number} returns.start_time - Order start time (Unix timestamp in seconds)
   * @returns {number} returns.end_time - Order expiry time (Unix timestamp in seconds)
   * @returns {number} returns.borrow_fee - Borrow fee rate (basis points, e.g. 300 = 3%)
   * @returns {string} returns.open_price - Open price when order was created (u128 as string)
   * 
   * **Technical Data:**
   * @returns {number} returns.bump - PDA bump seed
   * 
   * **Metadata:**
   * @returns {Object} returns._metadata - Additional metadata information
   * @returns {string} returns._metadata.accountAddress - Complete PDA address
   * 
   * @throws {Error} Throws error when MarginOrder account does not exist
   * @throws {Error} Throws error when unable to decode account data
   * @throws {Error} Throws error when network connection fails
   * @throws {Error} Throws error when invalid PDA address provided
   * 
   * @example
   * // Basic usage example
   * try {
   *   const orderData = await sdk.chain.getOrderAccount('FUYU1mKcV5XsJuK4SfcoD4pfXJvQ18pstg8fGqVLYGDG');
   *   
   *   // Display core order information
   *   console.log('=== Order Information ===');
   *   console.log('Order type:', orderData.order_type === 1 ? 'Long' : 'Short');
   *   console.log('Token mint:', orderData.mint);
   *   console.log('User:', orderData.user);
   *   console.log('Margin amount:', orderData.margin_sol_amount / 1e9, 'SOL');
   *   console.log('Position size:', orderData.position_asset_amount);
   *   
   *   // Display price information
   *   console.log('=== Price Information ===');
   *   console.log('Open price:', orderData.open_price);
   *   console.log('LP start price:', orderData.lock_lp_start_price);
   *   console.log('LP end price:', orderData.lock_lp_end_price);
   *   
   *   // Display time information
   *   console.log('=== Time Information ===');
   *   console.log('Start time:', new Date(orderData.start_time * 1000).toLocaleString());
   *   console.log('End time:', new Date(orderData.end_time * 1000).toLocaleString());
   *   console.log('Borrow fee:', orderData.borrow_fee / 100, '%');
   *   
   *   // Display linked list connections
   *   console.log('=== Linked List Connections ===');
   *   console.log('Previous order:', orderData.prev_order || 'None');
   *   console.log('Next order:', orderData.next_order || 'None');
   *   
   * } catch (error) {
   *   console.error('Failed to get order account:', error.message);
   * }
   * 
   * @example
   * // Order validation example
   * async function validateOrder(orderPda) {
   *   try {
   *     const orderData = await sdk.chain.getOrderAccount(orderPda);
   *     
   *     // Check if order is expired
   *     const currentTime = Math.floor(Date.now() / 1000);
   *     const isExpired = currentTime > orderData.end_time;
   *     
   *     // Calculate remaining time
   *     const remainingTime = orderData.end_time - currentTime;
   *     
   *     console.log('Order status:', isExpired ? 'Expired' : 'Active');
   *     if (!isExpired) {
   *       console.log('Remaining time:', Math.floor(remainingTime / 3600), 'hours');
   *     }
   *     
   *     return {
   *       isExpired,
   *       remainingTime,
   *       orderType: orderData.order_type === 1 ? 'long' : 'short',
   *       user: orderData.user,
   *       marginAmount: orderData.margin_sol_amount
   *     };
   *   } catch (error) {
   *     console.error('Order validation failed:', error.message);
   *     return null;
   *   }
   * }
   * 
   * @since 1.0.0
   * @author SpinPet SDK Team
   */
  async getOrderAccount(pda) {
    try {
      // Parameter validation and conversion
      let pdaPubkey;
      try {
        pdaPubkey = typeof pda === 'string' ? new PublicKey(pda) : pda;
      } catch (pubkeyError) {
        throw new Error(`Invalid PDA address: ${pda}`);
      }

      // Validate pdaPubkey
      if (!pdaPubkey || typeof pdaPubkey.toBuffer !== 'function') {
        throw new Error(`Invalid PDA public key`);
      }

      // Use Anchor program to fetch account data directly
      // Method 1: Use program's fetch method
      let decodedData;
      try {
        decodedData = await this.sdk.program.account.marginOrder.fetch(pdaPubkey);
      } catch (fetchError) {
        // Method 2: If fetch fails, use raw method
        const accountInfo = await this.sdk.connection.getAccountInfo(pdaPubkey);
        if (!accountInfo) {
          throw new Error(`MarginOrder account does not exist`);
        }

        // Manually decode with BorshAccountsCoder
        const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);

        // Try different account names
        try {
          decodedData = accountsCoder.decode('marginOrder', accountInfo.data);
        } catch (decodeError1) {
          try {
            // Try uppercase name
            decodedData = accountsCoder.decode('MarginOrder', accountInfo.data);
          } catch (decodeError2) {
            // Both failed, throw original error
            throw new Error(`Cannot decode MarginOrder account data: ${decodeError1.message}`);
          }
        }
      }

      // Convert data format (following the same pattern as getCurveAccount)
      const convertedData = {
        // Numeric types remain unchanged
        order_type: decodedData.orderType,
        start_time: decodedData.startTime,
        end_time: decodedData.endTime,
        lock_lp_sol_amount: decodedData.lockLpSolAmount.toNumber(),
        lock_lp_token_amount: decodedData.lockLpTokenAmount.toNumber(),
        margin_init_sol_amount: decodedData.marginInitSolAmount.toNumber(),
        margin_sol_amount: decodedData.marginSolAmount.toNumber(),
        borrow_amount: decodedData.borrowAmount.toNumber(),
        position_asset_amount: decodedData.positionAssetAmount.toNumber(),
        borrow_fee: decodedData.borrowFee,
        realized_sol_amount: decodedData.realizedSolAmount.toNumber(),
        bump: decodedData.bump,

        // BN types convert to string
        lock_lp_start_price: decodedData.lockLpStartPrice.toString(),
        lock_lp_end_price: decodedData.lockLpEndPrice.toString(),
        open_price: decodedData.openPrice.toString(),

        // PublicKey types convert to string
        mint: decodedData.mint.toString(),
        user: decodedData.user.toString(),
        next_order: decodedData.nextOrder ? decodedData.nextOrder.toString() : null,
        prev_order: decodedData.prevOrder ? decodedData.prevOrder.toString() : null,

        // Additional metadata
        _metadata: {
          accountAddress: pdaPubkey.toString()
        }
      };

      // Return converted data
      return convertedData;

    } catch (error) {
      // Provide concise error information
      if (error.message.includes('Account does not exist')) {
        throw new Error(`MarginOrder account does not exist for PDA: ${pda}`);
      } else {
        throw new Error(`Failed to get MarginOrder account: ${error.message}`);
      }
    }
  }

  /**
   * 获取用户订单 Get User Orders (Read from Chain)
   * @param {string} user - 用户地址
   * @param {string} mint - 代币地址
   * @param {Object} options - 查询参数
   * @param {number} options.page - 页码，默认1
   * @param {number} options.limit - 每页数量，默认200
   * @param {string} options.order_by - 排序方式，默认'start_time_desc'
   * @returns {Promise<Object>} 用户订单数据
   * 
   * @example
   * const userOrders = await sdk.chain.user_orders(
   *   '8iGFeUkRpyRx8w5uoUMbfZepUr6BfTdPuJmqGoNBntdb',
   *   '4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X',
   *   { page: 1, limit: 200, order_by: 'start_time_desc' }
   * );
   * // 返回格式:
   * // {
   * //   "success": true,
   * //   "data": {
   * //     "orders": [
   * //       {
   * //         "order_type": 2,
   * //         "mint": "4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X",
   * //         "user": "8iGFeUkRpyRx8w5uoUMbfZepUr6BfTdPuJmqGoNBntdb",
   * //         "lock_lp_start_price": "753522984132656210522",
   * //         "lock_lp_end_price": "833102733432007194898",
   * //         "lock_lp_sol_amount": 2535405978,
   * //         "lock_lp_token_amount": 32000000000000,
   * //         "start_time": 1755964862,
   * //         "end_time": 1756137662,
   * //         "margin_sol_amount": 1909140052,
   * //         "borrow_amount": 32000000000000,
   * //         "position_asset_amount": 656690798,
   * //         "borrow_fee": 1200,
   * //         "order_pda": "59yP5tpDP6DBcyy4mge9wKKKdLmk45Th4sbd6Un9LxVN"
   * //       }
   * //     ],
   * //     "total": 11,
   * //     "user": "8iGFeUkRpyRx8w5uoUMbfZepUr6BfTdPuJmqGoNBntdb",
   * //     "mint_account": "4Kq51Kt48FCwdo5CeKjRVPodH1ticHa7mZ5n5gqMEy1X",
   * //     "page": 1,
   * //     "limit": 200,
   * //     "has_next": false,
   * //     "has_prev": false
   * //   },
   * //   "message": "Operation successful"
   * // }
   * 
   * // 使用订单数据:
   * const orders = userOrders.data.orders; // 订单数组
   * const totalCount = userOrders.data.total; // 总数量
   */
  async user_orders(user, mint, options = {}) {
    try {
      // Parameter validation
      if (!user || typeof user !== 'string') {
        throw new Error('user_orders: user address must be a valid string');
      }
      if (!mint || typeof mint !== 'string') {
        throw new Error('user_orders: mint address must be a valid string');
      }

      // Set default parameters
      const page = options.page || 1;
      const limit = Math.min(options.limit || 200, 1000); // Maximum 1000
      const orderBy = options.order_by || 'start_time_desc';

      //console.log(`chain.user_orders: Get user orders, user=${user}, mint=${mint}, page=${page}, limit=${limit}`);

      // Get curve_account data to get both linked list heads
      const curveData = await this.getCurveAccount(mint);
      const upHeadAddress = curveData.upHead;   // Short orders (up_orders)
      const downHeadAddress = curveData.downHead; // Long orders (down_orders)

      //console.log(`chain.user_orders: upHead=${upHeadAddress || 'null'}, downHead=${downHeadAddress || 'null'}`);

      // Collect all user orders from both linked lists
      const allUserOrders = [];

      // Helper function to traverse a linked list and collect user orders
      const traverseLinkedList = async (headAddress) => {
        if (!headAddress) return [];

        const orders = [];
        let currentAddress = new PublicKey(headAddress);
        let count = 0;
        const maxTraverse = 1000; // Limit traversal to avoid infinite loops

        while (currentAddress && count < maxTraverse) {
          try {
            // Get raw account data
            const accountInfo = await this.sdk.connection.getAccountInfo(currentAddress);
            if (!accountInfo) {
              console.warn(`Order account ${currentAddress.toString()} does not exist, breaking traversal`);
              break;
            }

            // Manually decode with BorshAccountsCoder
            const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);
            let orderData;

            try {
              orderData = accountsCoder.decode('MarginOrder', accountInfo.data);
            } catch (decodeError1) {
              try {
                orderData = accountsCoder.decode('marginOrder', accountInfo.data);
              } catch (decodeError2) {
                console.warn(`Cannot decode order account ${currentAddress.toString()}: ${decodeError2.message}`);
                break;
              }
            }

            // Check if this order belongs to the target user
            if (orderData.user.toString() === user) {
              // Data transformation - convert to same format as fast.user_orders
              const convertedOrder = {
                // Convert chain number to API number format (keep as number for compatibility)
                order_type: orderData.orderType, // 1=long, 2=short
                mint: orderData.mint.toString(),
                user: orderData.user.toString(),
                // Convert BN type to string
                lock_lp_start_price: orderData.lockLpStartPrice.toString(),
                lock_lp_end_price: orderData.lockLpEndPrice.toString(),
                // Keep numeric types unchanged
                lock_lp_sol_amount: orderData.lockLpSolAmount.toNumber(),
                lock_lp_token_amount: orderData.lockLpTokenAmount.toNumber(),
                start_time: orderData.startTime,
                end_time: orderData.endTime,
                margin_init_sol_amount: orderData.marginInitSolAmount.toNumber(),
                margin_sol_amount: orderData.marginSolAmount.toNumber(),
                borrow_amount: orderData.borrowAmount.toNumber(),
                position_asset_amount: orderData.positionAssetAmount.toNumber(),
                borrow_fee: orderData.borrowFee,
                realized_sol_amount: orderData.realizedSolAmount.toNumber(),
                // Add order_pda field
                order_pda: currentAddress.toString()
              };

              orders.push(convertedOrder);
              //console.log(`chain.user_orders: Found user order: ${currentAddress.toString()}, type=${convertedOrder.order_type}`);
            }

            count++;

            // Move to next node
            if (orderData.nextOrder) {
              currentAddress = orderData.nextOrder;
            } else {
              break;
            }

            // Add small delay to avoid overloading
            if (count % 50 === 0) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }

          } catch (error) {
            console.warn(`Error reading order ${currentAddress.toString()}: ${error.message}`);
            break;
          }
        }

        return orders;
      };

      // Traverse both linked lists in parallel to find user orders
      const [upOrders, downOrders] = await Promise.all([
        upHeadAddress ? traverseLinkedList(upHeadAddress) : [], // Short orders
        downHeadAddress ? traverseLinkedList(downHeadAddress) : [] // Long orders
      ]);

      // Combine all orders
      allUserOrders.push(...upOrders, ...downOrders);

      //console.log(`chain.user_orders: Found ${allUserOrders.length} total user orders`);

      // Sort orders by start_time
      if (orderBy === 'start_time_desc') {
        allUserOrders.sort((a, b) => b.start_time - a.start_time);
      } else if (orderBy === 'start_time_asc') {
        allUserOrders.sort((a, b) => a.start_time - b.start_time);
      }

      // Implement pagination
      const totalOrders = allUserOrders.length;
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedOrders = allUserOrders.slice(startIndex, endIndex);

      // Calculate pagination info
      const hasNext = endIndex < totalOrders;
      const hasPrev = page > 1;

      //console.log(`chain.user_orders: Returning ${paginatedOrders.length} orders (page ${page}/${Math.ceil(totalOrders/limit)})`);

      // Return same format as fast.user_orders
      return {
        success: true,
        data: {
          orders: paginatedOrders,
          total: totalOrders,
          user: user,
          mint_account: mint,
          page: page,
          limit: limit,
          has_next: hasNext,
          has_prev: hasPrev
        },
        message: "Operation successful"
      };

    } catch (error) {
      // Error handling
      console.error('chain.user_orders: Failed to get user orders', error.message);
      throw new Error(`Failed to get user orders: ${error.message}`);
    }
  }
}

module.exports = ChainModule;