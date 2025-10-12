/**
 * SpinPet SDK 交易机器人配置
 * 示例：使用 orderBy 参数控制平仓顺序
 */

// ========== 用户配置区域 ==========
const CONFIG = {
  // 网络配置
  network: 'LOCALNET',
  walletIndex: 0,
  
  // 代币配置
  tokenInfo: {
    name: 'TestBot Token',
    symbol: 'TBT', 
    uri: 'https://example.com/testbot-token.json'
  },
  
  // 交易计划配置
  tradingPlan: [
    // 步骤1：创建代币
    { 
      type: 'create-token', 
      enabled: true, 
      description: '创建测试代币',
      params: {} 
    },

    // 步骤2：做多交易
    { 
      type: 'long', 
      enabled: true,  // 启用做多交易测试
      description: '做多交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    // 使用 1 SOL (lamports)
        downPercentage: 0.05    // 止损 5%
      }
    },

    // 步骤3：平仓做多
    { 
      type: 'closeLong', 
      enabled: true,  // 启用平仓做多测试
      description: '平仓做多交易（先平新订单）',
      params: {
        orderBy: 'start_time_desc'  // 'start_time_desc': 先平新订单, 'start_time_asc': 先平旧订单
      }  
    },

    // 步骤4：做空交易
    { 
      type: 'short', 
      enabled: true,  // 启用做空交易测试
      description: '做空交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    
        upPercentage: 0.05     // 止损 5%
      }
    },

    // 步骤5：平仓做空
    { 
      type: 'closeShort', 
      enabled: true,  // 启用平仓做空测试
      description: '平仓做空交易（先平旧订单）',
      params: {
        orderBy: 'start_time_asc'  // 'start_time_desc': 先平新订单, 'start_time_asc': 先平旧订单
      }
    },

    // 步骤6：买入现货
    { 
      type: 'buy', 
      enabled: false, 
      description: '买入100,000个代币',
      params: {
        buyTokenAmount: '100000000000',  // 100,000 tokens (精度 10^6)
        maxSolAmount: '500000000000'     // 最多花费5 SOL
      }
    },

    // 步骤7：卖出现货
    { 
      type: 'sell', 
      enabled: false, 
      description: '卖出50,000个代币',
      params: {
        sellTokenAmount: '50000000000',  // 50,000 tokens
        minSolOutput: '1000000000'       // 最少得到1 SOL
      }
    },
  ],
  
  // 日志配置
  logFile: 'logs/trading.log'
};

// ========== 使用说明 ==========
/**
 * orderBy 参数说明：
 * 
 * 在 closeLong 和 closeShort 类型的交易中，可以使用 orderBy 参数控制平仓顺序：
 * 
 * 1. 'start_time_desc': 按订单开始时间降序排列，先平仓最新的订单
 *    - 适用场景：想要先处理最近的订单，可能是因为市场条件变化
 * 
 * 2. 'start_time_asc': 按订单开始时间升序排列，先平仓最旧的订单
 *    - 适用场景：按照先进先出(FIFO)原则处理订单
 * 
 * 如果不指定 orderBy 参数：
 * - closeLong 默认使用 'start_time_desc'（先平新订单）
 * - closeShort 默认使用 'start_time_asc'（先平旧订单）
 * 
 * 示例配置：
 * params: {
 *   orderBy: 'start_time_desc'  // 或 'start_time_asc'
 * }
 */

// ========== 模块导出 ==========
module.exports = {
  CONFIG
};

// 如果直接运行此文件，显示配置信息
if (require.main === module) {
  console.log('SpinPet 交易机器人配置文件');
  console.log('当前配置：');
  console.log(JSON.stringify(CONFIG, null, 2));
  console.log('\n运行命令：');
  console.log('node test_bot/bot-run.js -js test_bot/bot-config-with-orderby.js');
}