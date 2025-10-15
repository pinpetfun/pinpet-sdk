const { ComputeBudgetProgram, PublicKey, Transaction, Keypair, SystemProgram, SYSVAR_RENT_PUBKEY } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const anchor = require('@coral-xyz/anchor');
// 统一使用 buffer 包，所有平台一致
const { Buffer } = require('buffer');

// Metaplex Token Metadata 程序ID
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
    console.log('  Metadata account:', metadataAccount.toString());
    console.log('  Params account:', this.sdk.paramsAccount?.toString() || 'Not set');

    // Validate required configuration
    if (!this.sdk.paramsAccount) {
      throw new Error('SDK paramsAccount not configured, please provide params_account configuration during initialization');
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
        metadataAccount,
        payer
      }
    };
  }


}

module.exports = TokenModule;
