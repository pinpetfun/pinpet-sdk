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

    { 
      type: 'buy', 
      enabled: true, 
      description: '买入100,000个代币',
      params: {
        buyTokenAmount: '1000000000000',  // 100,000 tokens (精度 10^6)
        maxSolAmount: '500000000000'       // 最多花费5 SOL
      }
    },


    { 
      type: 'short', 
      enabled: true,  // 启用做空交易测试
      description: '做空交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    
        upPercentage: 0.05     // 止损 5%
      }
    },


    // // 步骤2：买入100,000个代币
    // { 
    //   type: 'buy', 
    //   enabled: true, 
    //   description: '买入100,000个代币',
    //   params: {
    //     buyTokenAmount: '100000000000',  // 100,000 tokens (精度 10^6)
    //     maxSolAmount: '500000000000'       // 最多花费5 SOL
    //   }
    // },

    { 
      type: 'sell', 
      enabled: true, 
      description: '卖出100000000000个代币',
      params: {
        sellTokenAmount: '100000000000',  // 50,000 tokens
        minSolOutput: '10'       // 最少得到1 SOL
      }
    },


    { 
      type: 'closeShort', 
      enabled: true,  // 启用平仓做空测试
      description: '半平仓做空交易（自动查找订单）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 50.0  
      }
    },
    { 
      type: 'closeShort', 
      enabled: true,  // 启用平仓做空测试
      description: '半平仓做空交易（自动查找订单）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 20.0  
      }
    },

    { 
      type: 'closeShort', 
      enabled: true,  // 启用平仓做空测试
      description: '半平仓做空交易（自动查找订单）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 30.0  
      }
    },

    //--------------
    { 
      type: 'closeShort', 
      enabled: true,  // 启用平仓做空测试
      description: '半平仓做空交易（自动查找订单）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 50.0  
      }
    },



    { 
      type: 'closeShort', 
      enabled: true,  // 启用平仓做空测试
      description: '半平仓做空交易（自动查找订单）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 100.0  
      }
    },

    
    { 
      type: 'sell', 
      enabled: true, 
      description: '卖出900000000000个代币',
      params: {
        sellTokenAmount: '900000000000',  // 50,000 tokens
        minSolOutput: '10'       // 最少得到1 SOL
      }
    },

    // { 
    //   type: 'sell', 
    //   enabled: true, 
    //   description: '卖出1100000000000个代币',
    //   params: {
    //     sellTokenAmount: '1100000000000',  // 50,000 tokens
    //     minSolOutput: '10'       // 最少得到1 SOL
    //   }
    // },






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