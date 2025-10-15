# SpinPet SDK

A JavaScript SDK for interacting with SpinPet protocol-related Solana Anchor smart contracts. The SDK supports both Node.js and browser environments, providing modular functionality for trading, token management, order management, and more.

## Installation 

```bash
npm install spin-sdk
```

**NPM Package**: https://www.npmjs.com/package/spin-sdk

## Table of Contents

1. [SDK Initialization](#sdk-initialization)
2. [Core Configuration](#core-configuration)
3. [Trading Module - Trading Functions](#trading-module---trading-functions)
4. [Fast Module - Data Retrieval](#fast-module---data-retrieval)
5. [Token Module - Token Management](#token-module---token-management)
6. [Param Module - Parameter Management](#param-module---parameter-management)
7. [Simulator Module - Trading Simulation](#simulator-module---trading-simulation)
8. [Chain Module - On-chain Data Queries](#chain-module---on-chain-data-queries)
9. [Utility Methods](#utility-methods)
10. [Unified Data Interface Documentation](#unified-data-interface-documentation)

---

## SDK Initialization

### Constructor

```javascript
new SpinPetSdk(connection, programId, options)
```

**Parameters:**
- `connection` *(Connection)*: Solana connection instance
- `programId` *(PublicKey|string)*: Program ID
- `options` *(Object)*: Optional configuration parameters

**options Configuration:**
```javascript
{
  fee_recipient: "4nffmKaNrex34LkJ99RLxMt2BbgXeopUi8kJnom3YWbv",           // Fee recipient account
  base_fee_recipient: "8fJpd2nteqkTEnXf4tG6d1MnP9p71KMCV4puc9vaq6kv",      // Base fee recipient account
  params_account: "DVRnPDW1MvUhRhDfE1kU6aGHoQoufBCmQNbqUH4WFgUd",          // Parameters account
  spin_fast_api_url: "http://192.168.18.36:8080",                         // FastAPI URL
  defaultDataSource: "fast",                                              // Default data source, "fast" or "chain"
  commitment: "confirmed",                                                 // Commitment level
  preflightCommitment: "processed",                                        // Preflight commitment level
  skipPreflight: false,                                                    // Whether to skip preflight
  maxRetries: 3,                                                          // Maximum retry count
  debug_log_path: null                                                    // Debug log path (optional)
}
```

**Example:**
```javascript
const { Connection, PublicKey } = require('@solana/web3.js');
const { SpinPetSdk, getDefaultOptions, SPINPET_PROGRAM_ID } = require('spin-sdk');

// Create connection
const connection = new Connection('http://localhost:8899', 'confirmed');

// Get default configuration
const options = getDefaultOptions('LOCALNET');

// Initialize SDK (Note: wallet parameter is no longer required)
const sdk = new SpinPetSdk(
  connection, 
  SPINPET_PROGRAM_ID, 
  {
    ...options,  // Include network-specific configuration
    defaultDataSource: 'fast'  // 'fast' or 'chain'
  }
);
```

---

## Core Configuration

### Constant Configuration

- `sdk.MAX_ORDERS_COUNT`: 10 - Maximum orders processed per transaction
- `sdk.FIND_MAX_ORDERS_COUNT`: 1000 - Maximum orders fetched when querying
- `sdk.SUGGEST_LIQ_RATIO`: 975 - Suggested liquidity ratio when insufficient, in basis points (1000=100%)

### Unified Data Interface

SDK provides `sdk.data` unified data interface that automatically routes to fast or chain modules based on `defaultDataSource` configuration:

```javascript
// Get orders using default data source
const ordersData = await sdk.data.orders(mint, { type: 'down_orders' });

// Temporarily specify data source
const ordersData = await sdk.data.orders(mint, { 
  type: 'down_orders',
  dataSource: 'chain'  // Temporarily use chain data source
});

// Get price data
const price = await sdk.data.price(mint);

// Get user orders
const userOrders = await sdk.data.user_orders(user, mint, {
  page: 1,
  limit: 200,
  order_by: 'start_time_desc'
});
```

---

## Trading Module - Trading Functions

### sdk.trading.buy() - Buy Tokens

```javascript
await sdk.trading.buy(params, options)
```

**Parameters:**
- `params.mintAccount` *(string|PublicKey)*: Token mint account address
- `params.buyTokenAmount` *(anchor.BN)*: Amount of tokens to purchase
- `params.maxSolAmount` *(anchor.BN)*: Maximum SOL to spend
- `params.payer` *(PublicKey)*: Payer public key
- `options.computeUnits` *(number)*: Compute units limit, default 1400000

**Return Value:**
```javascript
{
  transaction: Transaction,           // Transaction object
  signers: [],                       // Signers array (empty array, only payer signature needed)
  accounts: {                        // Related account information
    mint: PublicKey,
    curveAccount: PublicKey,
    poolTokenAccount: PublicKey,
    poolSolAccount: PublicKey,
    userTokenAccount: PublicKey,
    payer: PublicKey
  },
  orderData: {                       // Order data information
    ordersUsed: number,              // Number of orders used
    lpPairsCount: number,            // LP pairs count
    lpPairs: Array,                  // LP pairs array
    orderAccounts: Array             // Order accounts array
  }
}
```

**Example:**
```javascript
const result = await sdk.trading.buy({
  mintAccount: "HZBos3RNhExDcAtzmdKXhTd4sVcQFBiT3FDBgmBBMk7",
  buyTokenAmount: new anchor.BN("1000000000"),    // 1 token (assuming 9 decimals)
  maxSolAmount: new anchor.BN("2000000000"),      // 2 SOL
  payer: wallet.publicKey
});

// Sign and send transaction
const signature = await connection.sendTransaction(result.transaction, [wallet.payer]);
```

### sdk.trading.sell() - Sell Tokens

```javascript
await sdk.trading.sell(params, options)
```

**Parameters:**
- `params.mintAccount` *(string|PublicKey)*: Token mint account address
- `params.sellTokenAmount` *(anchor.BN)*: Amount of tokens to sell
- `params.minSolOutput` *(anchor.BN)*: Minimum SOL output
- `params.payer` *(PublicKey)*: Payer public key
- `options.computeUnits` *(number)*: Compute units limit, default 1400000

**Return Value:** Same as `buy()` method

### sdk.trading.long() - Margin Long

```javascript
await sdk.trading.long(params, options)
```

**Parameters:**
- `params.mintAccount` *(string|PublicKey)*: Token mint account address
- `params.buyTokenAmount` *(anchor.BN)*: Amount of tokens to purchase
- `params.maxSolAmount` *(anchor.BN)*: Maximum SOL to spend
- `params.marginSol` *(anchor.BN)*: Margin amount
- `params.closePrice` *(anchor.BN)*: Close price
- `params.prevOrder` *(PublicKey|null)*: Previous order
- `params.nextOrder` *(PublicKey|null)*: Next order
- `params.payer` *(PublicKey)*: Payer public key
- `options.computeUnits` *(number)*: Compute units limit, default 1400000

### sdk.trading.short() - Margin Short

```javascript
await sdk.trading.short(params, options)
```

### sdk.trading.closeLong() - Close Long Position

```javascript
await sdk.trading.closeLong(params, options)
```

### sdk.trading.closeShort() - Close Short Position

```javascript
await sdk.trading.closeShort(params, options)
```

---

## Fast Module - Data Retrieval

### sdk.fast.mints() - Get Token List

```javascript
await sdk.fast.mints(options)
```

**Parameters:**
- `options.page` *(number)*: Page number, default 1
- `options.limit` *(number)*: Items per page, default 10
- `options.sort_by` *(string)*: Sort method, default 'slot_asc'

### sdk.fast.mint_info() - Get Token Details

```javascript
await sdk.fast.mint_info(mint)
```

**Parameters:**
- `mint` *(string|Array)*: Token address or array of addresses

### sdk.fast.orders() - Get Order Data

```javascript
await sdk.fast.orders(mint, options)
```

**Parameters:**
- `mint` *(string)*: Token address
- `options.type` *(string)*: Order type, "up_orders" (short) or "down_orders" (long)
- `options.page` *(number)*: Page number, default 1
- `options.limit` *(number)*: Items per page, default 500

### sdk.fast.price() - Get Token Price

```javascript
await sdk.fast.price(mint)
```

**Parameters:**
- `mint` *(string)*: Token address

**Return Value:**
- `string`: Latest price string

### sdk.fast.user_orders() - Get User Orders

```javascript
await sdk.fast.user_orders(user, mint, options)
```

**Parameters:**
- `user` *(string)*: User address
- `mint` *(string)*: Token address
- `options.page` *(number)*: Page number, default 1
- `options.limit` *(number)*: Items per page, default 200
- `options.order_by` *(string)*: Sort method, default 'start_time_desc'

---

## Token Module - Token Management

### sdk.token.create() - Create New Token

```javascript
await sdk.token.create(params)
```

**Parameters:**
- `params.mint` *(Keypair)*: Token mint keypair
- `params.name` *(string)*: Token name
- `params.symbol` *(string)*: Token symbol
- `params.uri` *(string)*: Metadata URI
- `params.payer` *(PublicKey)*: Creator public key

---

## Param Module - Parameter Management

### sdk.param.createParams() - Create Partner Parameters

```javascript
await sdk.param.createParams(params)
```

**Parameters:**
- `params.partner` *(PublicKey)*: Partner public key

### sdk.param.getParams() - Get Partner Parameters

```javascript
await sdk.param.getParams(partner)
```

### sdk.param.getAdmin() - Get Admin Account

```javascript
await sdk.param.getAdmin()
```

---

## Simulator Module - Trading Simulation

### sdk.simulator.simulateTokenBuy() - Simulate Token Buy Transaction

This function simulates a token buy transaction for a specified token amount by analyzing existing short orders (up_orders) to calculate liquidity requirements, price impact, and feasibility analysis.

```javascript
await sdk.simulator.simulateTokenBuy(mint, buyTokenAmount, passOrder)
```

**Parameters:**
- `mint` *(string)*: Token mint account address
- `buyTokenAmount` *(bigint|string|number)*: Target purchase token amount (u64 format, precision 10^6)
- `passOrder` *(string|null)*: Optional skip order PDA address

**Return Value:**
```javascript
{
  // Complete liquidity calculation result
  liqResult: {
    free_lp_sol_amount_sum: bigint,        // Total available free liquidity SOL amount
    free_lp_token_amount_sum: bigint,      // Total available free liquidity token amount
    lock_lp_sol_amount_sum: bigint,        // Total locked liquidity SOL amount
    lock_lp_token_amount_sum: bigint,      // Total locked liquidity token amount
    has_infinite_lp: boolean,              // Whether includes infinite liquidity
    pass_order_id: number,                 // Skipped order index position in array
    force_close_num: number,               // Number of orders requiring force closure
    ideal_lp_sol_amount: bigint,           // Ideal SOL usage amount
    real_lp_sol_amount: bigint             // Actual SOL usage amount
  },
  
  // Transaction completion analysis
  completion: string,                      // Purchase completion percentage
  
  // Price slippage analysis
  slippage: string,                        // Price slippage percentage
  
  // Suggested trading parameters
  suggestedTokenAmount: string,            // Suggested token purchase amount
  suggestedSolAmount: string               // Suggested SOL amount needed
}
```

### sdk.simulator.simulateTokenSell() - Simulate Token Sell Transaction

This function simulates a token sell transaction for a specified token amount by analyzing existing long orders (down_orders).

```javascript
await sdk.simulator.simulateTokenSell(mint, sellTokenAmount, passOrder)
```

### sdk.simulator.simulateLongStopLoss() - Simulate Long Stop Loss Analysis

This function simulates stop loss price calculation for long positions by analyzing existing order linked lists.

```javascript
await sdk.simulator.simulateLongStopLoss(mint, buyTokenAmount, stopLossPrice, lastPrice, ordersData)
```

### sdk.simulator.simulateSellStopLoss() - Simulate Short Stop Loss Analysis

This function simulates stop loss price calculation for short positions by analyzing existing short order linked lists.

```javascript
await sdk.simulator.simulateSellStopLoss(mint, sellTokenAmount, stopLossPrice, lastPrice, ordersData)
```

---

## Chain Module - On-chain Data Queries

Chain module provides functionality to read account data directly from the Solana blockchain. When auxiliary servers are unavailable, this module can be used to obtain real-time on-chain data including liquidity pool status, account balances, etc.

### sdk.chain.getCurveAccount() - Get Complete Liquidity Pool Data

This is the core method of the Chain module, used to get complete lending liquidity pool account data for a specified token.

```javascript
await sdk.chain.getCurveAccount(mint)
```

**Parameters:**
- `mint` *(string|PublicKey)*: Token mint account address

**Return Value:**
```javascript
{
  // Core Reserve Data
  lpTokenReserve: bigint,              // LP Token reserve amount
  lpSolReserve: bigint,                // LP SOL reserve amount
  price: bigint,                       // Current token price
  borrowTokenReserve: bigint,          // Borrow Token reserve amount
  borrowSolReserve: bigint,            // Borrow SOL reserve amount

  // Fee and Parameter Configuration
  swapFee: number,                     // Swap fee rate in basis points
  borrowFee: number,                   // Borrow fee rate in basis points
  feeDiscountFlag: boolean,            // Fee discount flag
  feeSplit: number,                    // Fee split ratio
  borrowDuration: number,              // Borrow duration in seconds
  bump: number,                        // curve_account PDA bump seed

  // Account Addresses
  baseFeeRecipient: string,            // Base fee recipient address
  feeRecipient: string,                // Fee recipient address
  mint: string,                        // Token mint account address
  upHead: string|null,                 // Up orders linked list head
  downHead: string|null,               // Down orders linked list head
  poolTokenAccount: string,            // Pool token account address
  poolSolAccount: string,              // Pool SOL account address

  // Balance Information
  baseFeeRecipientBalance: number,     // Base fee recipient SOL balance
  feeRecipientBalance: number,         // Fee recipient SOL balance
  poolTokenBalance: bigint,            // Pool token account token balance
  poolSolBalance: number,              // Pool SOL account SOL balance

  // Metadata
  _metadata: {
    accountAddress: string,            // curve_account complete address
    mintAddress: string                // Input token mint address
  }
}
```

### sdk.chain.getCurveAccountBatch() - Batch Get Liquidity Pool Data

```javascript
await sdk.chain.getCurveAccountBatch(mints)
```

### sdk.chain.getCurveAccountAddress() - Calculate Liquidity Pool Address

```javascript
sdk.chain.getCurveAccountAddress(mint)
```

---

## Utility Methods

### SDK Built-in Utility Methods

SDK provides convenient utility methods that can be called directly through SDK instance:

#### sdk.buildLpPairs() - Build LP Pairs Array

```javascript
sdk.buildLpPairs(orders, direction, price)
```

#### sdk.buildOrderAccounts() - Build Order Accounts Array

```javascript
sdk.buildOrderAccounts(orders)
```

#### sdk.findPrevNext() - Find Previous and Next Order Nodes

```javascript
sdk.findPrevNext(orders, findOrderPda)
```

#### sdk.findOrderIndex() - Get Order Position in Array

```javascript
sdk.findOrderIndex(orders, targetOrderPda)
```

### Network Configuration

```javascript
const { getDefaultOptions } = require('spin-sdk');

// Get default configuration
const options = getDefaultOptions('MAINNET');  // 'MAINNET' | 'TESTNET' | 'LOCALNET'
```

**Available Networks:**
- `MAINNET`: Mainnet configuration
- `TESTNET`: Testnet configuration  
- `LOCALNET`: Local network configuration

---

## Unified Data Interface Documentation

### Data Source Configuration

SDK supports two data sources:

1. **fast** - API data source (default): Fast data retrieval through FastAPI server, fast but requires API service dependency
2. **chain** - On-chain data source: Direct blockchain data reading, more reliable but may have delays

### Configuration Methods

```javascript
// Global configuration of default data source
const sdk = new SpinPetSdk(connection, programId, {
  ...options,
  defaultDataSource: 'fast'  // or 'chain'
});

// Use default data source
const ordersData = await sdk.data.orders(mint, { type: 'down_orders' });

// Temporarily specify data source
const ordersData = await sdk.data.orders(mint, { 
  type: 'down_orders',
  dataSource: 'chain'  // Temporarily use chain data source
});
```

### Core Unified Interfaces

#### sdk.data.orders() - Get Order Data (Unified Interface)

```javascript
await sdk.data.orders(mint, options)
```

**Parameters:**
- `mint` *(string)*: Token mint account address
- `options` *(Object)*: Query options

**options Parameters:**
```javascript
{
  type: "down_orders" | "up_orders",    // Required: Order type
                                        // "down_orders" = Long orders (buy low)
                                        // "up_orders" = Short orders (sell high)
  
  page: number,                         // Optional: Page number, default 1
  limit: number,                        // Optional: Items per page, default 500
  dataSource: "fast" | "chain"          // Optional: Temporarily specify data source
}
```

#### sdk.data.price() - Get Price Data (Unified Interface)

```javascript
await sdk.data.price(mint, options)
```

**Parameters:**
- `mint` *(string)*: Token mint account address
- `options` *(Object, optional)*: Query options

**Return Value:**
- **Type**: `string`
- **Format**: u128 price string
- **Example**: `"13514066072452801812769"`

#### sdk.data.user_orders() - Get User Orders (Unified Interface)

```javascript
await sdk.data.user_orders(user, mint, options)
```

**Parameters:**
- `user` *(string)*: User wallet address
- `mint` *(string)*: Token mint account address
- `options` *(Object, optional)*: Query options

---

## Complete Usage Example

```javascript
const { Connection, PublicKey } = require('@solana/web3.js');
const anchor = require('@coral-xyz/anchor');
const { SpinPetSdk, getDefaultOptions, SPINPET_PROGRAM_ID } = require('spin-sdk');

async function example() {
  // 1. Create connection
  const connection = new Connection('http://localhost:8899', 'confirmed');
  
  // 2. Get default configuration
  const options = getDefaultOptions('LOCALNET');
  
  // 3. Initialize SDK (Note: wallet parameter removed)
  const sdk = new SpinPetSdk(connection, SPINPET_PROGRAM_ID, {
    ...options,
    defaultDataSource: 'fast'
  });
  
  // 4. Use various features
  
  // Get token list
  const mints = await sdk.fast.mints();
  console.log('Token list:', mints.data.mints);
  
  // Get token details
  const mintInfo = await sdk.fast.mint_info(mints.data.mints[0]);
  console.log('Token details:', mintInfo.data.details[0]);
  
  // Use unified data interface to get orders and price
  const ordersData = await sdk.data.orders(mints.data.mints[0], { type: 'down_orders' });
  const price = await sdk.data.price(mints.data.mints[0]);
  
  // Simulate buy
  const buyAnalysis = await sdk.simulator.simulateTokenBuy(
    mints.data.mints[0], 
    '1000000000'  // 1 token
  );
  console.log('Buy analysis:', buyAnalysis);
  
  // Execute buy transaction (needs to provide payer parameter)
  const buyResult = await sdk.trading.buy({
    mintAccount: mints.data.mints[0],
    buyTokenAmount: new anchor.BN("1000000000"),
    maxSolAmount: new anchor.BN("2000000000"),
    payer: yourWalletPublicKey  // Need to provide payer public key
  });
  
  // Sign and send transaction (needs external wallet signature)
  const signature = await connection.sendTransaction(buyResult.transaction, [yourWalletKeypair]);
  console.log('Transaction signature:', signature);
}
```

---

## Important Notes

1. **SDK Initialization**: Starting from the new version, the SDK constructor no longer requires the `wallet` parameter. The `payer` parameter needs to be provided in each method during transactions.

2. **Numerical Precision**: All amount-related parameters need to use `anchor.BN` type. Note that SOL precision is 10^9, token precision is usually 10^6 or 10^9.

3. **Transaction Signing**: The `transaction` object returned by SDK needs to be signed and sent by users themselves. SDK does not automatically execute transactions. Supports various wallet adapters.

4. **Data Source Selection**: Global data source can be configured through `defaultDataSource`, or temporarily specified through `dataSource` parameter in specific methods.

5. **Order Queries**: Before executing close operations, order data needs to be obtained first through `sdk.data.orders()` or corresponding modules, and processed using utility methods.

6. **Network Configuration**: Different network environments require corresponding configuration parameters. It's recommended to use `getDefaultOptions()` to get them.

7. **Error Handling**: All async methods may throw exceptions. It's recommended to use try-catch for error handling.

8. **Debug Features**: Debug logging can be enabled through `debug_log_path` configuration for easier problem tracking during development.

---

## License

MIT

## Contributing

Please refer to the contributing guidelines in the repository.

## Support

For issues and questions, please visit the [GitHub repository](https://github.com/your-repo/spin-sdk).