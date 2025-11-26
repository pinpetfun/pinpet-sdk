const anchor = require('@coral-xyz/anchor');
const { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');

/**
 * Tools Module
 * Provides trading utility functions: approve trade and close cooldown PDA
 */
class ToolsModule {
  /**
   * Constructor
   * @param {PinPetSdk} sdk - SDK instance
   */
  constructor(sdk) {
    this.sdk = sdk;
  }

  /**
   * Approve current token balance for trading
   *
   * Use Cases:
   * 1. After receiving tokens from another address and wanting to trade immediately
   * 2. Reactivating cooldown PDA
   *
   * @param {Object} params - Parameters
   * @param {PublicKey|string} params.mint - Token mint address
   * @param {Keypair} params.wallet - User wallet for signing
   * @returns {Promise<Object>} Transaction object and related account info
   *
   * @example
   * const result = await sdk.tools.approveTrade({
   *   mint: 'xxxxx',
   *   wallet: userKeypair
   * });
   *
   * const signature = await this.sdk.connection.sendTransaction(
   *   result.transaction,
   *   [wallet]
   * );
   */
  async approveTrade(params) {
    const { mint, wallet } = params;

    // Validate parameters
    if (!mint) {
      throw new Error('mint parameter is required');
    }
    if (!wallet) {
      throw new Error('wallet parameter is required');
    }

    // Convert mint to PublicKey
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;
    const walletPubkey = wallet.publicKey;

    // Calculate required PDA account addresses
    const [curveAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('borrowing_curve'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    const [poolTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_token'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    const [poolSolAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from('pool_sol'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('up_orderbook'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('down_orderbook'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    // Calculate user token account
    const userTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      walletPubkey
    );

    // Calculate trade cooldown PDA
    const [cooldown] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('trade_cooldown'),
        mintPubkey.toBuffer(),
        walletPubkey.toBuffer()
      ],
      this.sdk.programId
    );

    // Get curve account to fetch fee recipient addresses
    // Use manual fetch method to avoid provider issues
    const curveAccountInfo = await this.sdk.connection.getAccountInfo(curveAccount);
    if (!curveAccountInfo) {
      throw new Error(`Curve account does not exist for mint: ${mint}`);
    }

    const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);
    let curveAccountData;
    try {
      curveAccountData = accountsCoder.decode('BorrowingBondingCurve', curveAccountInfo.data);
    } catch (e1) {
      try {
        curveAccountData = accountsCoder.decode('borrowingBondingCurve', curveAccountInfo.data);
      } catch (e2) {
        throw new Error(`Cannot decode curve account: ${e1.message}`);
      }
    }

    // Build transaction
    const transaction = await this.sdk.program.methods
      .approveTrade()
      .accounts({
        payer: walletPubkey,
        mintAccount: mintPubkey,
        curveAccount: curveAccount,
        poolTokenAccount: poolTokenAccount,
        poolSolAccount: poolSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        userTokenAccount: userTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        feeRecipientAccount: curveAccountData.feeRecipient,
        baseFeeRecipientAccount: curveAccountData.baseFeeRecipient,
        cooldown: cooldown,
      })
      .transaction();

    // Get latest blockhash
    const { blockhash } = await this.sdk.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletPubkey;

    // Return result
    return {
      transaction,
      signers: [],
      accounts: {
        payer: walletPubkey,
        mintAccount: mintPubkey,
        curveAccount: curveAccount,
        userTokenAccount: userTokenAccount,
        cooldown: cooldown,
      }
    };
  }

  /**
   * Manually close TradeCooldown PDA and reclaim rent
   *
   * Conditions:
   * 1. Can only close your own PDA (verified through seeds)
   *
   * Use Cases:
   * - User wants to reclaim rent
   * - Clean up unused PDAs
   * - Admin batch cleanup of expired PDAs
   *
   * Notes:
   * - No need to verify token balance, can be recreated via approve_trade after closing
   * - After PDA is closed, next buy or approve will automatically recreate it
   *
   * @param {Object} params - Parameters
   * @param {PublicKey|string} params.mint - Token mint address
   * @param {Keypair} params.wallet - User wallet for signing
   * @returns {Promise<Object>} Transaction object and related account info
   *
   * @example
   * const result = await sdk.tools.closeTradeCooldown({
   *   mint: 'xxxxx',
   *   wallet: userKeypair
   * });
   *
   * const signature = await this.sdk.connection.sendTransaction(
   *   result.transaction,
   *   [wallet]
   * );
   */
  async closeTradeCooldown(params) {
    const { mint, wallet } = params;

    // Validate parameters
    if (!mint) {
      throw new Error('mint parameter is required');
    }
    if (!wallet) {
      throw new Error('wallet parameter is required');
    }

    // Convert mint to PublicKey
    const mintPubkey = typeof mint === 'string' ? new PublicKey(mint) : mint;
    const walletPubkey = wallet.publicKey;

    // Calculate user token account
    const userTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      walletPubkey
    );

    // Calculate trade cooldown PDA
    const [cooldown] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('trade_cooldown'),
        mintPubkey.toBuffer(),
        walletPubkey.toBuffer()
      ],
      this.sdk.programId
    );

    // Get cooldown account to fetch bump
    // Use manual fetch method to avoid provider issues
    const cooldownAccountInfo = await this.sdk.connection.getAccountInfo(cooldown);
    if (!cooldownAccountInfo) {
      throw new Error(`Cooldown PDA does not exist for mint: ${mint} and wallet: ${wallet.publicKey.toString()}`);
    }

    const accountsCoder = new anchor.BorshAccountsCoder(this.sdk.program.idl);
    let cooldownAccountData;
    try {
      cooldownAccountData = accountsCoder.decode('TradeCooldown', cooldownAccountInfo.data);
    } catch (e1) {
      try {
        cooldownAccountData = accountsCoder.decode('tradeCooldown', cooldownAccountInfo.data);
      } catch (e2) {
        throw new Error(`Cannot decode cooldown account: ${e1.message}`);
      }
    }

    // Build transaction
    const transaction = await this.sdk.program.methods
      .closeTradeCooldown()
      .accounts({
        payer: walletPubkey,
        mintAccount: mintPubkey,
        userTokenAccount: userTokenAccount,
        cooldown: cooldown,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .transaction();

    // Get latest blockhash
    const { blockhash } = await this.sdk.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletPubkey;

    // Return result
    return {
      transaction,
      signers: [],
      accounts: {
        payer: walletPubkey,
        mintAccount: mintPubkey,
        userTokenAccount: userTokenAccount,
        cooldown: cooldown,
      },
      cooldownInfo: {
        lastTradeTime: cooldownAccountData.lastTradeTime,
        approvalTokenAmount: cooldownAccountData.approvalTokenAmount,
        bump: cooldownAccountData.bump,
      }
    };
  }
}

module.exports = ToolsModule;
