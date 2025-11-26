const anchor = require('@coral-xyz/anchor');
const { PublicKey } = require('@solana/web3.js');
// 统一使用 buffer 包，所有平台一致
const { Buffer } = require('buffer');

// 环境检测和条件加载
const IS_NODE = typeof process !== 'undefined' && process.versions && process.versions.node;

// 确保全局可用（兼容现有代码）
if (typeof global !== 'undefined' && !global.Buffer) {
  global.Buffer = Buffer;
}

let fs, path;
if (IS_NODE) {
  try {
    fs = require('fs');
    path = require('path'); 
  } catch (e) {
    console.warn('File system modules not available');
  }
}
const TradingModule = require('./modules/trading');
const TokenModule = require('./modules/token');
const ParamModule = require('./modules/param');
const FastModule = require('./modules/fast');
const SimulatorModule = require('./modules/simulator');
const ChainModule = require('./modules/chain');
const ToolsModule = require('./modules/tools');
const OrderUtils = require('./utils/orderUtils');
const CurveAMM = require('./utils/curve_amm');
const spinpetIdl = require('./idl/pinpet.json');

/**
 * SpinPet SDK Main Class
 * Provides modular interfaces for interacting with SpinPet protocol
 */
class PinPetSdk {
  /**
   * Constructor
   * @param {Connection} connection - Solana connection instance
   * @param {Wallet|Keypair} wallet - Wallet instance
   * @param {PublicKey|string} programId - Program ID
   * @param {Object} options - Configuration options (optional)
   */
  constructor(connection, programId, options = {}) {
    //console.log("PinPetSdk options=",options)
    // Save configuration options
    this.options = options;
    
    // Validate defaultDataSource configuration
    if (options.defaultDataSource && !['fast', 'chain'].includes(options.defaultDataSource)) {
      throw new Error('defaultDataSource must be "fast" or "chain"');
    }

   //console.log("options.defaultDataSource",options.defaultDataSource)
    //this.defaultDataSource = options.defaultDataSource || 'fast';
    this.defaultDataSource = options.defaultDataSource || 'chain';

    console.log('Data source method:', this.defaultDataSource);
    
    // Basic configuration
    this.connection = connection;
    //this.wallet = wallet instanceof anchor.Wallet ? wallet : new anchor.Wallet(wallet);
    this.programId = typeof programId === 'string' ? new PublicKey(programId) : programId;
    
    // Initialize account configuration with options
    this.feeRecipient = this._parsePublicKey(this.options.feeRecipient);
    this.baseFeeRecipient = this._parsePublicKey(this.options.baseFeeRecipient);
    this.paramsAccount = this._parsePublicKey(this.options.paramsAccount);
    this.pinPetFastApiUrl = this.options.pinPetFastApiUrl;

    // Maximum number of orders that can be processed at once in the contract
    this.MAX_ORDERS_COUNT = 9
    // Maximum number of orders to fetch during queries
    this.FIND_MAX_ORDERS_COUNT = 1000

    // 在流动性不足时, 建议实际使用流动性的比例, 分每 (1000=100%)
    this.SUGGEST_LIQ_RATIO = 975; // 97.5% (1000=100%)

    // 只在 Node.js 环境中启用调试日志
    this.debugLogPath = IS_NODE && fs ? (this.options.debugLogPath || null) : null;
    
    // 初始化调试文件
    this._initDebugFiles();


    // Initialize Anchor program
    this.program = this._initProgram(this.options);
    
    // Initialize functional modules
    this.trading = new TradingModule(this);
    this.token = new TokenModule(this);
    this.param = new ParamModule(this);
    this.fast = new FastModule(this);
    this.simulator = new SimulatorModule(this);
    this.chain = new ChainModule(this);
    this.tools = new ToolsModule(this);

    // Initialize curve AMM utility
    this.curve = CurveAMM;
    
    /**
     * 统一数据接口 - 根据 defaultDataSource 配置自动路由到 fast 或 chain 模块
     * Unified data interface - automatically routes to fast or chain module based on defaultDataSource config
     * 
     * @example
     * // 使用默认数据源获取订单
     * const ordersData = await sdk.data.orders(mint, { type: 'down_orders' });
     * 
     * // 临时指定数据源
     * const ordersData = await sdk.data.orders(mint, { 
     *   type: 'down_orders',
     *   dataSource: 'chain'  // 临时使用链上数据源
     * });
     * 
     * // 获取用户订单
     * const userOrders = await sdk.data.user_orders(user, mint, {
     *   page: 1,
     *   limit: 200,
     *   order_by: 'start_time_desc'
     * });
     */
    this.data = {
      /**
       * 获取代币订单数据
       * @param {string} mint - 代币地址
       * @param {Object} options - 查询参数，支持 dataSource 字段临时指定数据源
       * @returns {Promise<Object>} 订单数据
       */
      orders: (mint, options = {}) => this._getDataWithSource('orders', [mint, options]),
      
      /**
       * 获取代币价格数据
       * @param {string} mint - 代币地址
       * @param {Object} options - 查询参数，支持 dataSource 字段临时指定数据源
       * @returns {Promise<string>} 价格字符串
       */
      price: (mint, options = {}) => this._getDataWithSource('price', [mint, options]),
      
      /**
       * 获取用户订单数据
       * @param {string} user - 用户地址
       * @param {string} mint - 代币地址
       * @param {Object} options - 查询参数，支持 dataSource 字段临时指定数据源
       * @returns {Promise<Object>} 用户订单数据
       */
      user_orders: (user, mint, options = {}) => this._getDataWithSource('user_orders', [user, mint, options])
    };
  }

  /**
   * Parse PublicKey
   * @private
   * @param {PublicKey|string|null} key - Key to parse
   * @returns {PublicKey|null}
   */
  _parsePublicKey(key) {
    if (!key) return null;
    return typeof key === 'string' ? new PublicKey(key) : key;
  }

  /**
   * Initialize Anchor program instance
   * @private
   */
  _initProgram(options = {}) {
    const provider = new anchor.AnchorProvider(
      this.connection,
      {
        commitment: options.commitment,
        preflightCommitment: options.preflightCommitment,
        skipPreflight: options.skipPreflight || false,
        maxRetries: options.maxRetries,
        ...options
      }
    );
    
    anchor.setProvider(provider);
    
    // Create program instance using imported IDL
    return new anchor.Program(spinpetIdl, this.programId);
  }


  // ========== Debug File Management Methods ==========

  /**
   * 初始化调试文件，删除旧文件
   * Initialize debug files, delete old files
   * @private
   */
  _initDebugFiles() {
    if (!this.debugLogPath || !IS_NODE || !fs || !path) {
      return; // 浏览器环境或文件系统不可用
    }

    try {
      const files = ['orderPda.txt', 'orderOpen.txt'];
      files.forEach(file => {
        const filePath = path.join(this.debugLogPath, file);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    } catch (error) {
      console.warn('Warning: Failed to initialize debug files:', error.message);
    }
  }

  /**
   * 安全地写入调试日志
   * Safely write debug log
   * @private
   * @param {string} fileName - 文件名
   * @param {string} content - 内容
   */
  _writeDebugLog(fileName, content) {
    if (!this.debugLogPath || !IS_NODE || !fs || !path) {
      return; // 静默失败，不报错
    }

    try {
      const filePath = path.join(this.debugLogPath, fileName);
      fs.appendFileSync(filePath, content);
    } catch (error) {
      console.warn(`Warning: Failed to write debug log to ${fileName}:`, error.message);
    }
  }

  // ========== Unified Data Interface Routing Method ==========

  /**
   * Route data requests based on configuration
   * 
   * @private
   * @param {string} method - Method name
   * @param {Array} args - Arguments array
   * @returns {Promise} Returns result from corresponding module method
   */
  _getDataWithSource(method, args) {
    // Extract dataSource configuration from last parameter
    const lastArg = args[args.length - 1] || {};
    const dataSource = lastArg.dataSource || this.defaultDataSource;
    
    // Route to corresponding module based on data source
    const module = dataSource === 'chain' ? this.chain : this.fast;
    
    if (!module[method]) {
      throw new Error(`Method ${method} does not exist in ${dataSource} module`);
    }
    
    return module[method](...args);
  }

}

module.exports = PinPetSdk;
