/**
 * SpinPet SDK 交易机器人配置
 * 只包含用户配置信息
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


    // 步骤2：买入100,000个代币
    { 
      type: 'buy', 
      enabled: true, 
      description: '买入100,000个代币',
      params: {
        buyTokenAmount: '98800000000000',  // 100,000 tokens (精度 10^6)
        maxSolAmount: '500000000000'       // 最多花费5 SOL
      }
    },

    { 
      type: 'long', 
      enabled: true,  // 启用做多交易测试
      description: '做多交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    // 使用 1 SOL (lamports)
        downPercentage: 0.05    // 止损 5%
      }
    },

    // 步骤3：卖出50,000个代币（50%）
    { 
      type: 'sell', 
      enabled: true, 
      description: '卖出50,000个代币',
      params: {
        sellTokenAmount: '98800000000000',  // 50,000 tokens
        minSolOutput: '10'       // 最少得到1 SOL
      }
    },






  ],
  
  // 日志配置
  logFile: 'logs/trading.log'
};

// ========== 模块导出 ==========
module.exports = {
  CONFIG
};

// 如果直接运行此文件，显示配置信息
if (require.main === module) {
  console.log('SpinPet 交易机器人配置文件');
  console.log('当前配置：');
  console.log(JSON.stringify(CONFIG, null, 2));
}