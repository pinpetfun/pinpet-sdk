const { ComputeBudgetProgram, PublicKey, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { createAssociatedTokenAccountInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
// 统一使用 buffer 包，所有平台一致
const { Buffer } = require('buffer');
const { MAX_CANDIDATE_INDICES } = require('./simulator/utils');

// 环境检测和条件加载
const IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node;

let fs, path;
if (IS_NODE) {
  try {
    fs = require('fs');
    path = require('path');
  } catch (e) {
    console.warn('File system modules not available in trading module');
  }
}

/**
 * Trading Module
 * Handles buy/sell and long/short trading operations
 */
class TradingModule {
  constructor(sdk) {
    this.sdk = sdk;
  }

  /**
   * Buy tokens
   * @param {Object} params - Buy parameters
   * @param {string|PublicKey} params.mintAccount - Token mint account address
   * @param {anchor.BN} params.buyTokenAmount - Amount of tokens to buy
   * @param {anchor.BN} params.maxSolAmount - Maximum SOL to spend
   * @param {PublicKey} params.payer - Payer public key
   * @param {Object} options - Optional parameters
   * @param {number} options.computeUnits - Compute units limit, default 1400000
   * @returns {Promise<Object>} Object containing transaction, signers and account info
   *
   * @example
   * const result = await sdk.trading.buy({
   *   mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
   *   buyTokenAmount: new anchor.BN("1000000000"),
   *   maxSolAmount: new anchor.BN("2000000000"),
   *   payer: wallet.publicKey
   * });
   */
  async buy({ mintAccount, buyTokenAmount, maxSolAmount, payer }, options = {}) {
    const { computeUnits = 1400000 } = options;

    // 1. Parameter validation and conversion
    const mint = typeof mintAccount === 'string' ? new PublicKey(mintAccount) : mintAccount;

    if (!anchor.BN.isBN(buyTokenAmount) || !anchor.BN.isBN(maxSolAmount)) {
      throw new Error('buyTokenAmount and maxSolAmount must be anchor.BN type');
    }

    // 2. Calculate PDA accounts
    const accounts = this._calculatePDAAccounts(mint);

    // 3. Calculate orderbook PDAs
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('up_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('down_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    // 4. Get user token account
    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      payer
    );

    // 5. Check if user token account exists, create if not
    const userTokenAccountInfo = await this.sdk.connection.getAccountInfo(userTokenAccount);
    const createAtaIx = userTokenAccountInfo === null
      ? createAssociatedTokenAccountInstruction(
        payer,
        userTokenAccount,
        payer,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      : null;

    // 6. Get fee recipient accounts from curve account
    const curveAccountInfo = await this.sdk.chain.getCurveAccount(mint);
    const feeRecipientAccount = new PublicKey(curveAccountInfo.feeRecipient);
    const baseFeeRecipientAccount = new PublicKey(curveAccountInfo.baseFeeRecipient);

    // 6.5. Calculate cooldown PDA
    const [cooldownPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('trade_cooldown'),
        mint.toBuffer(),
        payer.toBuffer()
      ],
      this.sdk.programId
    );

    // 7. Build transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });

    const buyIx = await this.sdk.program.methods
      .buy(buyTokenAmount, maxSolAmount)
      .accounts({
        payer: payer,
        mintAccount: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount,
        cooldown: cooldownPDA
      })
      .instruction();

    // 8. Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);

    // If user token account doesn't exist, create it first
    if (createAtaIx) {
      transaction.add(createAtaIx);
    }

    transaction.add(buyIx);

    // 9. Return transaction object and related info
    return {
      transaction,
      signers: [], // Buy transaction doesn't need additional signers, only payer signature
      accounts: {
        mint: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        userTokenAccount: userTokenAccount,
        payer: payer,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount,
        cooldown: cooldownPDA
      }
    };
  }

  /**

  /**
   * Sell tokens
   * @param {Object} params - Sell parameters
   * @param {string|PublicKey} params.mintAccount - Token mint account address
   * @param {anchor.BN} params.sellTokenAmount - Amount of tokens to sell
   * @param {anchor.BN} params.minSolOutput - Minimum SOL output
   * @param {PublicKey} params.payer - Payer public key
   * @param {Object} options - Optional parameters
   * @param {number} options.computeUnits - Compute units limit, default 1400000
   * @returns {Promise<Object>} Object containing transaction, signers and account info
   * 
   * @example
   * const result = await sdk.trading.sell({
   *   mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
   *   sellTokenAmount: new anchor.BN("1000000000"),
   *   minSolOutput: new anchor.BN("2000000000"),
   *   payer: wallet.publicKey
   * });
   */
  async sell({ mintAccount, sellTokenAmount, minSolOutput, payer }, options = {}) {
    const { computeUnits = 1400000 } = options;

    // 1. Parameter validation and conversion
    const mint = typeof mintAccount === 'string' ? new PublicKey(mintAccount) : mintAccount;

    if (!anchor.BN.isBN(sellTokenAmount) || !anchor.BN.isBN(minSolOutput)) {
      throw new Error('sellTokenAmount and minSolOutput must be anchor.BN type');
    }

    // 2. Calculate PDA accounts
    const accounts = this._calculatePDAAccounts(mint);

    // 3. Calculate orderbook PDAs
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('up_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('down_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    // 4. Get user token account
    const userTokenAccount = await getAssociatedTokenAddress(
      mint,
      payer
    );

    // 5. Check if user token account exists, create if not
    const userTokenAccountInfo = await this.sdk.connection.getAccountInfo(userTokenAccount);
    const createAtaIx = userTokenAccountInfo === null
      ? createAssociatedTokenAccountInstruction(
        payer,
        userTokenAccount,
        payer,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      : null;

    // 6. Get fee recipient accounts from curve account
    const curveAccountInfo = await this.sdk.chain.getCurveAccount(mint);
    const feeRecipientAccount = new PublicKey(curveAccountInfo.feeRecipient);
    const baseFeeRecipientAccount = new PublicKey(curveAccountInfo.baseFeeRecipient);

    // 6.5. Calculate cooldown PDA
    const [cooldownPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('trade_cooldown'),
        mint.toBuffer(),
        payer.toBuffer()
      ],
      this.sdk.programId
    );

    // 7. Build transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });

    const sellIx = await this.sdk.program.methods
      .sell(sellTokenAmount, minSolOutput)
      .accounts({
        payer: payer,
        mintAccount: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount,
        cooldown: cooldownPDA
      })
      .instruction();

    // 8. Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);

    // If user token account doesn't exist, create it first
    if (createAtaIx) {
      transaction.add(createAtaIx);
    }

    transaction.add(sellIx);

    // 9. Return transaction object and related info
    return {
      transaction,
      signers: [], // Sell transaction doesn't need additional signers, only payer signature
      accounts: {
        mint: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        userTokenAccount: userTokenAccount,
        payer: payer,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount,
        cooldown: cooldownPDA
      }
    };
  }

  /**
   * Margin Long
   * @param {Object} params - Long parameters
   * @param {string|PublicKey} params.mintAccount - Token mint account address
   * @param {anchor.BN} params.buyTokenAmount - Amount of tokens to buy (确定值)
   * @param {anchor.BN} params.maxSolAmount - Maximum SOL to spend (实际有可能会少点)
   * @param {anchor.BN} params.marginSol - Margin amount (保证金数量 SOL)
   * @param {anchor.BN} params.closePrice - Close price (平仓价格/止损价格)
   * @param {Array<number>} params.closeInsertIndices - Close insert indices array (平仓时插入订单簿的位置索引数组)
   * @param {PublicKey} params.payer - Payer public key
   * @param {Object} options - Optional parameters
   * @param {number} options.computeUnits - Compute units limit, default 1400000
   * @returns {Promise<Object>} Object containing transaction, signers and account info
   *
   * @example
   * const result = await sdk.trading.long({
   *   mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
   *   buyTokenAmount: new anchor.BN("10000000"),
   *   maxSolAmount: new anchor.BN("1100000000"),
   *   marginSol: new anchor.BN("2200000000"),
   *   closePrice: new anchor.BN("1000000000000000"),
   *   closeInsertIndices: [0, 1, 2], // 插入位置索引数组
   *   payer: wallet.publicKey
   * });
   */
  async long({ mintAccount, buyTokenAmount, maxSolAmount, marginSol, closePrice, closeInsertIndices, payer }, options = {}) {
    const { computeUnits = 1400000 } = options;

    // 1. 参数验证和转换
    const mint = typeof mintAccount === 'string' ? new PublicKey(mintAccount) : mintAccount;

    if (!anchor.BN.isBN(buyTokenAmount) || !anchor.BN.isBN(maxSolAmount) ||
      !anchor.BN.isBN(marginSol) || !anchor.BN.isBN(closePrice)) {
      throw new Error('All amount parameters must be anchor.BN type');
    }

    if (!Array.isArray(closeInsertIndices) || closeInsertIndices.length === 0) {
      throw new Error('closeInsertIndices must be a non-empty array');
    }

    if (closeInsertIndices.length > 20) {
      throw new Error('closeInsertIndices array cannot exceed 20 elements');
    }

    // 2. Calculate PDA accounts
    const accounts = this._calculatePDAAccounts(mint);

    // 3. Calculate OrderBook PDA addresses
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from("up_orderbook"), mint.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from("down_orderbook"), mint.toBuffer()],
      this.sdk.programId
    );

    // 4. Build transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });

    const longIx = await this.sdk.program.methods
      .long(
        buyTokenAmount,
        maxSolAmount,
        marginSol,
        closePrice,
        closeInsertIndices
      )
      .accounts({
        payer: payer,
        mintAccount: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        feeRecipientAccount: this.sdk.feeRecipient,
        baseFeeRecipientAccount: this.sdk.baseFeeRecipient,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook
      })
      .instruction();

    // 5. Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);
    transaction.add(longIx);

    // 6. Return transaction object and related info
    return {
      transaction,
      signers: [], // Long transaction doesn't need additional signers, only payer signature
      accounts: {
        mint: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        payer: payer,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook
      },
      orderData: {
        closeInsertIndices: closeInsertIndices
      }
    };
  }

  /**
   * 保证金做空 / Margin Short
   * @param {Object} params - 做空参数 / Short parameters
   * @param {string|PublicKey} params.mintAccount - 代币铸造账户地址 / Token mint account address
   * @param {anchor.BN} params.borrowSellTokenAmount - 借出卖出的代币数量 (希望卖出的token数量) / Borrowed token amount to sell
   * @param {anchor.BN} params.minSolOutput - 最小 SOL 输出 (卖出后最少得到的sol数量) / Minimum SOL output
   * @param {anchor.BN} params.marginSol - 保证金数量 (SOL) / Margin amount
   * @param {anchor.BN} params.closePrice - 平仓价格 (止损价格) / Close price
   * @param {Array<number>} params.closeInsertIndices - Close insert indices array (平仓时插入订单簿的位置索引数组)
   * @param {PublicKey} params.payer - 支付者公钥 / Payer public key
   * @param {Object} options - 可选参数 / Optional parameters
   * @param {number} options.computeUnits - 计算单元限制，默认 1400000 / Compute units limit, default 1400000
   * @returns {Promise<Object>} 包含交易对象、签名者和账户信息的对象 / Object containing transaction, signers and account info
   *
   * @example
   * const result = await sdk.trading.short({
   *   mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
   *   borrowSellTokenAmount: new anchor.BN("1000000000"),
   *   minSolOutput: new anchor.BN("100"),
   *   marginSol: new anchor.BN("2200000000"),
   *   closePrice: new anchor.BN("1000000000000000"),
   *   closeInsertIndices: [0, 1, 2], // 插入位置索引数组
   *   payer: wallet.publicKey
   * });
   */
  async short({ mintAccount, borrowSellTokenAmount, minSolOutput, marginSol, closePrice, closeInsertIndices, payer }, options = {}) {
    const { computeUnits = 1400000 } = options;

    // 1. 参数验证和转换 / Parameter validation and conversion
    const mint = typeof mintAccount === 'string' ? new PublicKey(mintAccount) : mintAccount;

    if (!anchor.BN.isBN(borrowSellTokenAmount) || !anchor.BN.isBN(minSolOutput) ||
      !anchor.BN.isBN(marginSol) || !anchor.BN.isBN(closePrice)) {
      throw new Error('所有金额参数必须是 anchor.BN 类型 / All amount parameters must be anchor.BN type');
    }

    if (!Array.isArray(closeInsertIndices) || closeInsertIndices.length === 0) {
      throw new Error('closeInsertIndices must be a non-empty array');
    }

    if (closeInsertIndices.length > 20) {
      throw new Error('closeInsertIndices array cannot exceed 20 elements');
    }

    // 2. 计算 PDA 账户 / Calculate PDA accounts
    const accounts = this._calculatePDAAccounts(mint);

    // 3. Calculate OrderBook PDA addresses
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from("up_orderbook"), mint.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from("down_orderbook"), mint.toBuffer()],
      this.sdk.programId
    );

    // 4. 构建交易指令 / Build transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });

    const shortIx = await this.sdk.program.methods
      .short(
        borrowSellTokenAmount,
        minSolOutput,
        marginSol,
        closePrice,
        closeInsertIndices
      )
      .accounts({
        payer: payer,
        mintAccount: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        feeRecipientAccount: this.sdk.feeRecipient,
        baseFeeRecipientAccount: this.sdk.baseFeeRecipient,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook
      })
      .instruction();

    // 5. 创建交易并添加指令 / Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);
    transaction.add(shortIx);

    // 6. 返回交易对象和相关信息 / Return transaction object and related info
    return {
      transaction,
      signers: [], // 做空交易不需要额外的签名者，只需要 payer 签名 / Short transaction doesn't need additional signers, only payer signature
      accounts: {
        mint: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        payer: payer,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook
      },
      orderData: {
        closeInsertIndices: closeInsertIndices
      }
    };
  }

  /**
   * 平仓做多 / Close Long Position
   * @param {Object} params - 平仓参数 / Close position parameters
   * @param {string|PublicKey} params.mintAccount - 代币铸造账户地址 / Token mint account address
   * @param {anchor.BN} params.sellTokenAmount - 希望卖出的token数量 / Amount of tokens to sell
   * @param {anchor.BN} params.minSolOutput - 卖出后最少得到的sol数量 / Minimum SOL output after selling
   * @param {number|anchor.BN} params.closeOrderId - 订单的唯一编号 / Order unique ID
   * @param {Array<number>} params.closeOrderIndices - 平仓时订单的位置索引数组 / Close order position indices array
   * @param {PublicKey} params.payer - 支付者公钥 / Payer public key
   * @param {PublicKey} params.userSolAccount - 开仓用户的SOL账户（接收资金）/ User SOL account to receive funds (must be order opener)
   * @param {Object} options - 可选参数 / Optional parameters
   * @param {number} options.computeUnits - 计算单元限制，默认1400000 / Compute units limit, default 1400000
   * @returns {Promise<Object>} 包含交易对象、签名者和账户信息的对象 / Object containing transaction, signers and account info
   *
   * @example
   * const result = await sdk.trading.closeLong({
   *   mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
   *   sellTokenAmount: new anchor.BN("1000000000"),
   *   minSolOutput: new anchor.BN("100000000"),
   *   closeOrderId: 12345,  // 订单唯一编号
   *   closeOrderIndices: [10, 11, 12],  // 候选索引数组
   *   payer: wallet.publicKey,
   *   userSolAccount: orderOwnerPublicKey
   * });
   */
  async closeLong({ mintAccount, sellTokenAmount, minSolOutput, closeOrderId, closeOrderIndices, payer, userSolAccount }, options = {}) {
    const { computeUnits = 1400000 } = options;

    // 1. 参数验证和转换 / Parameter validation and conversion
    const mint = typeof mintAccount === 'string' ? new PublicKey(mintAccount) : mintAccount;

    if (!anchor.BN.isBN(sellTokenAmount) || !anchor.BN.isBN(minSolOutput)) {
      throw new Error('sellTokenAmount and minSolOutput must be anchor.BN type');
    }

    // 转换 closeOrderId 为 anchor.BN (u64)
    const closeOrderIdBN = anchor.BN.isBN(closeOrderId) ? closeOrderId : new anchor.BN(closeOrderId);

    // 验证 closeOrderIndices 参数
    if (!Array.isArray(closeOrderIndices) || closeOrderIndices.length === 0) {
      throw new Error('closeOrderIndices must be a non-empty array');
    }

    if (closeOrderIndices.length > MAX_CANDIDATE_INDICES) {
      throw new Error(`closeOrderIndices array cannot exceed ${MAX_CANDIDATE_INDICES} elements`);
    }

    // 验证和转换 userSolAccount - 支持字符串或 PublicKey 对象
    let userSolAccountPubkey;
    if (!userSolAccount) {
      throw new Error('userSolAccount is required');
    }

    if (typeof userSolAccount === 'string') {
      try {
        userSolAccountPubkey = new PublicKey(userSolAccount);
      } catch (error) {
        throw new Error('userSolAccount must be a valid PublicKey string');
      }
    } else if (userSolAccount instanceof PublicKey) {
      userSolAccountPubkey = userSolAccount;
    } else if (userSolAccount.constructor && userSolAccount.constructor.name === 'PublicKey') {
      // 处理跨包 PublicKey 实例 - 提取字符串后重新创建
      try {
        userSolAccountPubkey = new PublicKey(userSolAccount.toString());
      } catch (error) {
        throw new Error('userSolAccount must be a valid PublicKey');
      }
    } else {
      throw new Error('userSolAccount must be a valid PublicKey or PublicKey string');
    }

    // 2. 计算 PDA 账户 / Calculate PDA accounts
    const accounts = this._calculatePDAAccounts(mint);

    // 3. 计算 OrderBook PDA 地址 / Calculate OrderBook PDA addresses
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('up_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('down_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    // 4. 从 curve account 获取手续费接收账户 / Get fee recipient accounts from curve account
    const curveAccountInfo = await this.sdk.chain.getCurveAccount(mint);
    const feeRecipientAccount = new PublicKey(curveAccountInfo.feeRecipient);
    const baseFeeRecipientAccount = new PublicKey(curveAccountInfo.baseFeeRecipient);

    // 5. 构建交易指令 / Build transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });

    const closeLongIx = await this.sdk.program.methods
      .closeLong(
        sellTokenAmount,       // sell_token_amount: 希望卖出的token数量 / Amount of tokens to sell
        minSolOutput,          // min_sol_output: 卖出后最少得到的sol数量 / Minimum SOL output
        closeOrderIdBN,        // close_order_id: 订单的唯一编号 / Order unique ID
        closeOrderIndices      // close_order_indices: 平仓时订单的位置索引数组 / Close order indices array
      )
      .accounts({
        payer: payer,
        mintAccount: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        userSolAccount: userSolAccountPubkey,  // 开仓用户的SOL账户 / User SOL account (must be order opener)
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook
      })
      .instruction();

    // 6. 创建交易并添加指令 / Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);
    transaction.add(closeLongIx);

    // 7. 返回交易对象和相关信息 / Return transaction object and related info
    return {
      transaction,
      signers: [], // 平仓做多交易不需要额外的签名者，只需要 payer 签名 / Close long transaction doesn't need additional signers, only payer signature
      accounts: {
        mint: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        payer: payer,
        userSolAccount: userSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount
      },
      orderData: {
        closeOrderId: closeOrderIdBN.toString(),
        closeOrderIndices: closeOrderIndices
      }
    };
  }


  /**
   * 平仓做空 / Close Short Position
   * @param {Object} params - 平仓参数 / Close position parameters
   * @param {string|PublicKey} params.mintAccount - 代币铸造账户地址 / Token mint account address
   * @param {anchor.BN} params.buyTokenAmount - 希望买入的token数量 / Amount of tokens to buy
   * @param {anchor.BN} params.maxSolAmount - 愿意给出的最大sol数量 / Maximum SOL amount to spend
   * @param {number|anchor.BN} params.closeOrderId - 订单的唯一编号 / Order unique ID
   * @param {Array<number>} params.closeOrderIndices - 平仓时订单的位置索引数组 / Close order position indices array
   * @param {PublicKey} params.payer - 支付者公钥 / Payer public key
   * @param {PublicKey} params.userSolAccount - 开仓用户的SOL账户（接收资金）/ User SOL account to receive funds (must be order opener)
   * @param {Object} options - 可选参数 / Optional parameters
   * @param {number} options.computeUnits - 计算单元限制，默认1400000 / Compute units limit, default 1400000
   * @returns {Promise<Object>} 包含交易对象、签名者和账户信息的对象 / Object containing transaction, signers and account info
   *
   * @example
   * const result = await sdk.trading.closeShort({
   *   mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
   *   buyTokenAmount: new anchor.BN("1000000000"),
   *   maxSolAmount: new anchor.BN("100000000"),
   *   closeOrderId: 12345,  // 订单唯一编号
   *   closeOrderIndices: [10, 11, 12],  // 候选索引数组
   *   payer: wallet.publicKey,
   *   userSolAccount: orderOwnerPublicKey
   * });
   */
  async closeShort({ mintAccount, buyTokenAmount, maxSolAmount, closeOrderId, closeOrderIndices, payer, userSolAccount }, options = {}) {
    const { computeUnits = 1400000 } = options;

    // 1. 参数验证和转换 / Parameter validation and conversion
    const mint = typeof mintAccount === 'string' ? new PublicKey(mintAccount) : mintAccount;

    if (!anchor.BN.isBN(buyTokenAmount) || !anchor.BN.isBN(maxSolAmount)) {
      throw new Error('buyTokenAmount and maxSolAmount must be anchor.BN type');
    }

    // 转换 closeOrderId 为 anchor.BN (u64)
    const closeOrderIdBN = anchor.BN.isBN(closeOrderId) ? closeOrderId : new anchor.BN(closeOrderId);

    // 验证 closeOrderIndices 参数
    if (!Array.isArray(closeOrderIndices) || closeOrderIndices.length === 0) {
      throw new Error('closeOrderIndices must be a non-empty array');
    }

    if (closeOrderIndices.length > MAX_CANDIDATE_INDICES) {
      throw new Error(`closeOrderIndices array cannot exceed ${MAX_CANDIDATE_INDICES} elements`);
    }

    // 验证和转换 userSolAccount - 支持字符串或 PublicKey 对象
    let userSolAccountPubkey;
    if (!userSolAccount) {
      throw new Error('userSolAccount is required');
    }

    if (typeof userSolAccount === 'string') {
      try {
        userSolAccountPubkey = new PublicKey(userSolAccount);
      } catch (error) {
        throw new Error('userSolAccount must be a valid PublicKey string');
      }
    } else if (userSolAccount instanceof PublicKey) {
      userSolAccountPubkey = userSolAccount;
    } else if (userSolAccount.constructor && userSolAccount.constructor.name === 'PublicKey') {
      // 处理跨包 PublicKey 实例 - 提取字符串后重新创建
      try {
        userSolAccountPubkey = new PublicKey(userSolAccount.toString());
      } catch (error) {
        throw new Error('userSolAccount must be a valid PublicKey');
      }
    } else {
      throw new Error('userSolAccount must be a valid PublicKey or PublicKey string');
    }

    // 2. 计算 PDA 账户 / Calculate PDA accounts
    const accounts = this._calculatePDAAccounts(mint);

    // 3. 计算 OrderBook PDA 地址 / Calculate OrderBook PDA addresses
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('up_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('down_orderbook'), mint.toBuffer()],
      this.sdk.programId
    );

    // 4. 从 curve account 获取手续费接收账户 / Get fee recipient accounts from curve account
    const curveAccountInfo = await this.sdk.chain.getCurveAccount(mint);
    const feeRecipientAccount = new PublicKey(curveAccountInfo.feeRecipient);
    const baseFeeRecipientAccount = new PublicKey(curveAccountInfo.baseFeeRecipient);

    // 5. 构建交易指令 / Build transaction instructions
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });

    const closeShortIx = await this.sdk.program.methods
      .closeShort(
        buyTokenAmount,        // buy_token_amount: 希望买入的token数量 / Amount of tokens to buy
        maxSolAmount,          // max_sol_amount: 愿意给出的最大sol数量 / Maximum SOL amount to spend
        closeOrderIdBN,        // close_order_id: 订单的唯一编号 / Order unique ID
        closeOrderIndices      // close_order_indices: 平仓时订单的位置索引数组 / Close order indices array
      )
      .accounts({
        payer: payer,
        mintAccount: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        userSolAccount: userSolAccountPubkey,  // 开仓用户的SOL账户 / User SOL account (must be order opener)
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook
      })
      .instruction();

    // 6. 创建交易并添加指令 / Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);
    transaction.add(closeShortIx);

    // 7. 返回交易对象和相关信息 / Return transaction object and related info
    return {
      transaction,
      signers: [], // 平仓做空交易不需要额外的签名者，只需要 payer 签名 / Close short transaction doesn't need additional signers, only payer signature
      accounts: {
        mint: mint,
        curveAccount: accounts.curveAccount,
        poolTokenAccount: accounts.poolTokenAccount,
        poolSolAccount: accounts.poolSolAccount,
        payer: payer,
        userSolAccount: userSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        feeRecipientAccount: feeRecipientAccount,
        baseFeeRecipientAccount: baseFeeRecipientAccount
      },
      orderData: {
        closeOrderId: closeOrderIdBN.toString(),
        closeOrderIndices: closeOrderIndices
      }
    };
  }



  // ========== Debug File Management Methods ==========

  /**
   * 安全地写入调试日志
   * Safely write debug log
   * @private
   * @param {string} fileName - 文件名
   * @param {string} content - 内容
   */
  _writeDebugLog(fileName, content) {
    if (!IS_NODE || !this.sdk.debugLogPath || typeof this.sdk.debugLogPath !== 'string' || !fs || !path) {
      return; // 浏览器环境或文件系统不可用时直接返回
    }
    
    try {
      const fullPath = path.join(this.sdk.debugLogPath, fileName);
      fs.appendFileSync(fullPath, content);
    } catch (error) {
      console.warn(`Warning: Failed to write debug log to ${fileName}:`, error.message);
    }
  }

  // ========== PDA Calculation Methods ==========

  /**
   * 计算 PDA 账户
   * @private
   * @param {PublicKey} mintAccount - 代币铸造账户
   * @returns {Object} PDA 账户对象
   */
  _calculatePDAAccounts(mintAccount) {
    // 计算曲线账户 PDA
    const [curveAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('borrowing_curve'), mintAccount.toBuffer()],
      this.sdk.programId
    );

    // 计算池子代币账户 PDA
    const [poolTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_token'), mintAccount.toBuffer()],
      this.sdk.programId
    );

    // 计算池子 SOL 账户 PDA
    const [poolSolAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_sol'), mintAccount.toBuffer()],
      this.sdk.programId
    );

    return {
      curveAccount,
      poolTokenAccount,
      poolSolAccount
    };
  }




}

module.exports = TradingModule;
