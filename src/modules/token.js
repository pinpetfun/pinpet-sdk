const { ComputeBudgetProgram, PublicKey, Transaction, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
// Use buffer package consistently across all platforms
const { Buffer } = require('buffer');

// Metaplex Token Metadata Program ID
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/**
 * Token Module
 * Handles token creation, queries, balance and other operations
 */
class TokenModule {
  constructor(sdk) {
    this.sdk = sdk;
  }

  /**
   * Create new token
   * @param {Object} params - Creation parameters
   * @param {Keypair} params.mint - Token mint keypair
   * @param {string} params.name - Token name
   * @param {string} params.symbol - Token symbol
   * @param {string} params.uri - Metadata URI
   * @param {PublicKey} params.payer - Creator public key (payer)
   * @returns {Promise<Object>} Object containing transaction, signers and account info
   */
  async create({
    mint,
    name,
    symbol,
    uri,
    payer
  }) {
    console.log('Token Module - Create:', {
      mint: mint.publicKey.toString(),
      name,
      symbol,
      uri,
      payer: payer.toString()
    });

    // Calculate borrowing liquidity pool account address (borrowing_curve)
    const [curveAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("borrowing_curve"),
        mint.publicKey.toBuffer(),
      ],
      this.sdk.programId
    );

    // Calculate liquidity pool token account address (pool_token)
    const [poolTokenAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_token"),
        mint.publicKey.toBuffer(),
      ],
      this.sdk.programId
    );

    // Calculate liquidity pool SOL account address (pool_sol)
    const [poolSolAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("pool_sol"),
        mint.publicKey.toBuffer(),
      ],
      this.sdk.programId
    );

    // Calculate order book accounts (new)
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("up_orderbook"),
        mint.publicKey.toBuffer(),
      ],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("down_orderbook"),
        mint.publicKey.toBuffer(),
      ],
      this.sdk.programId
    );

    // Calculate Metaplex metadata account address
    const [metadataAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("metadata"),
        METADATA_PROGRAM_ID.toBuffer(),
        mint.publicKey.toBuffer(),
      ],
      METADATA_PROGRAM_ID
    );

    console.log('Calculated account addresses:');
    console.log('  Borrowing liquidity pool account:', curveAccount.toString());
    console.log('  Liquidity pool token account:', poolTokenAccount.toString());
    console.log('  Liquidity pool SOL account:', poolSolAccount.toString());
    console.log('  Up orderbook:', upOrderbook.toString());
    console.log('  Down orderbook:', downOrderbook.toString());
    console.log('  Metadata account:', metadataAccount.toString());
    console.log('  Params account:', this.sdk.paramsAccount?.toString() || 'Not set');

    // Validate required configuration
    if (!this.sdk.paramsAccount) {
      throw new Error('SDK paramsAccount not configured, please provide paramsAccount configuration during initialization');
    }

    // Create compute budget instruction
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400000
    });

    // Create transaction instructions
    const createIx = await this.sdk.program.methods
      .create(name, symbol, uri)
      .accounts({
        payer: payer,
        mintAccount: mint.publicKey,
        curveAccount: curveAccount,
        poolTokenAccount: poolTokenAccount,
        poolSolAccount: poolSolAccount,
        upOrderbook: upOrderbook,
        downOrderbook: downOrderbook,
        metadata: metadataAccount,
        metadataProgram: METADATA_PROGRAM_ID,
        params: this.sdk.paramsAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    // Create transaction and add instructions
    const transaction = new Transaction();
    transaction.add(modifyComputeUnits);
    transaction.add(createIx);

    console.log('Token creation transaction built, signers required:', [payer.toString(), mint.publicKey.toString()]);

    return {
      transaction,
      signers: [mint], // mint keypair needs to be a signer
      accounts: {
        mint: mint.publicKey,
        curveAccount,
        poolTokenAccount,
        poolSolAccount,
        upOrderbook,
        downOrderbook,
        metadataAccount,
        payer
      }
    };
  }

  /**
   * Create token and buy in one transaction
   * Merges create and buy instructions into a single transaction for a single signature submission
   *
   * @param {Object} params - Creation and buy parameters
   * @param {Keypair} params.mint - Token mint keypair
   * @param {string} params.name - Token name
   * @param {string} params.symbol - Token symbol
   * @param {string} params.uri - Metadata URI
   * @param {PublicKey} params.payer - Creator public key (payer)
   * @param {anchor.BN} params.buyTokenAmount - Amount of tokens to buy
   * @param {anchor.BN} params.maxSolAmount - Maximum SOL to spend
   * @param {Object} options - Optional parameters
   * @param {number} options.computeUnits - Compute units limit, default 1800000
   * @returns {Promise<Object>} Object containing transaction, signers and account info
   */
  async createAndBuy({
    mint,
    name,
    symbol,
    uri,
    payer,
    buyTokenAmount,
    maxSolAmount
  }, options = {}) {
    const { computeUnits = 1800000 } = options;

    console.log('Token Module - CreateAndBuy:', {
      mint: mint.publicKey.toString(),
      name,
      symbol,
      uri,
      payer: payer.toString(),
      buyTokenAmount: buyTokenAmount.toString(),
      maxSolAmount: maxSolAmount.toString()
    });

    // 1. Validate parameters
    if (!anchor.BN.isBN(buyTokenAmount) || !anchor.BN.isBN(maxSolAmount)) {
      throw new Error('buyTokenAmount and maxSolAmount must be anchor.BN type');
    }

    // 2. Call create method to get create transaction
    console.log('Step 1: Building create transaction...');
    const createResult = await this.create({
      mint,
      name,
      symbol,
      uri,
      payer
    });

    // 3. Fetch fee recipient addresses from params account
    // Since curve_account has not been created yet, cannot read from chain
    console.log('Step 2: Fetching fee recipient accounts from params...');

    // Get fee recipient accounts directly from SDK configuration (set during SDK initialization)
    // Avoid using program.account.params.fetch() due to potential provider configuration issues
    const feeRecipientAccount = this.sdk.feeRecipient;
    const baseFeeRecipientAccount = this.sdk.baseFeeRecipient;

    // Verify these accounts are configured
    if (!feeRecipientAccount || !baseFeeRecipientAccount) {
      throw new Error('Fee recipient accounts not configured in SDK options');
    }

    console.log('Fee recipient accounts:');
    console.log('  Partner fee recipient:', feeRecipientAccount.toString());
    console.log('  Base fee recipient:', baseFeeRecipientAccount.toString());

    // 4. Prepare additional accounts required for buy
    console.log('Step 3: Calculating buy-related accounts...');
    const mintPubkey = mint.publicKey;

    // Calculate user token account
    const userTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      payer
    );

    // Calculate cooldown PDA
    const [cooldownPDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('trade_cooldown'),
        mintPubkey.toBuffer(),
        payer.toBuffer()
      ],
      this.sdk.programId
    );

    // Calculate orderbook PDAs (reuse values calculated in create)
    const [upOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('up_orderbook'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    const [downOrderbook] = PublicKey.findProgramAddressSync(
      [Buffer.from('down_orderbook'), mintPubkey.toBuffer()],
      this.sdk.programId
    );

    console.log('Buy-related accounts:');
    console.log('  User token account:', userTokenAccount.toString());
    console.log('  Cooldown PDA:', cooldownPDA.toString());

    // 5. Check if user token account exists, create ATA instruction
    console.log('Step 4: Checking if user token account exists...');
    const userTokenAccountInfo = await this.sdk.connection.getAccountInfo(userTokenAccount);
    const createAtaIx = userTokenAccountInfo === null
      ? createAssociatedTokenAccountInstruction(
          payer,
          userTokenAccount,
          payer,
          mintPubkey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      : null;

    if (createAtaIx) {
      console.log('  User token account does not exist, will create it');
    } else {
      console.log('  User token account already exists');
    }

    // 6. Build buy instruction
    console.log('Step 5: Building buy instruction...');
    const buyIx = await this.sdk.program.methods
      .buy(buyTokenAmount, maxSolAmount)
      .accounts({
        payer: payer,
        mintAccount: mintPubkey,
        curveAccount: createResult.accounts.curveAccount,
        poolTokenAccount: createResult.accounts.poolTokenAccount,
        poolSolAccount: createResult.accounts.poolSolAccount,
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

    // 7. Merge transactions: create + buy
    console.log('Step 6: Merging create and buy transactions...');
    const transaction = new Transaction();

    // Set compute unit limit
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: computeUnits
    });
    transaction.add(modifyComputeUnits);

    // Add all instructions from create transaction (skip compute budget instruction from create)
    createResult.transaction.instructions.forEach(ix => {
      // Skip compute budget instruction from create transaction (we already added it)
      if (ix.programId.equals(ComputeBudgetProgram.programId)) {
        return;
      }
      transaction.add(ix);
    });

    // Add ATA creation instruction (if needed)
    if (createAtaIx) {
      transaction.add(createAtaIx);
    }

    // Add buy instruction
    transaction.add(buyIx);

    console.log('CreateAndBuy transaction built successfully:');
    console.log('  Total instructions:', transaction.instructions.length);
    console.log('  Compute units:', computeUnits);
    console.log('  Signers required:', [payer.toString(), mint.publicKey.toString()]);

    // 8. Return merged transaction
    return {
      transaction,
      signers: [mint],  // mint keypair needs to sign
      accounts: {
        // create accounts
        ...createResult.accounts,
        // buy accounts
        userTokenAccount,
        cooldown: cooldownPDA,
        feeRecipientAccount,
        baseFeeRecipientAccount
      }
    };
  }

}

module.exports = TokenModule;
