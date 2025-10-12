/**
 * SpinPet SDK 交易机器人配置 - closeRate 测试
 * 测试部分平仓功能
 */

// ========== 用户配置区域 ==========
const CONFIG = {
  // 网络配置
  network: 'LOCALNET',
  walletIndex: 0,
  
  // 代币配置
  tokenInfo: {
    name: 'CloseRate Test Token',
    symbol: 'CRT', 
    uri: 'https://example.com/closerate-test-token.json'
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

    // 步骤2：做空交易
    { 
      type: 'short', 
      enabled: true,  
      description: '做空交易 1 SOL，止损 35%',
      params: {
        useSol: 1000000000,    
        upPercentage: 0.35     
      }
    },

    // 步骤3：做多交易
    { 
      type: 'long', 
      enabled: true,  
      description: '做多交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    // 使用 1 SOL (lamports)
        downPercentage: 0.05    // 止损 5%
      }
    },

    // 步骤4：部分平仓做多（33.33%）
    { 
      type: 'closeLong', 
      enabled: true,  
      description: '平仓做多交易（33.33% 平仓）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 33.33  // 33.33% 平仓
      }  
    },
    
    // 步骤5：部分平仓做空（50%）
    { 
      type: 'closeShort', 
      enabled: true,  
      description: '平仓做空交易（50% 平仓）',
      params: {
        orderBy: 'start_time_asc',
        closeRate: 50.0  // 50% 平仓
      }  
    },

    // 步骤6：完全平仓做多（剩余100%）
    { 
      type: 'closeLong', 
      enabled: true,  
      description: '平仓做多交易（完全平仓）',
      params: {
        orderBy: 'start_time_desc',
        closeRate: 100.0  // 100% 平仓
      }  
    },

    // 步骤7：完全平仓做空（剩余100%）
    { 
      type: 'closeShort', 
      enabled: true,  
      description: '平仓做空交易（完全平仓）',
      params: {
        orderBy: 'start_time_asc',
        closeRate: 100.0  // 100% 平仓
      }  
    }
  ],
  
  // 日志配置
  logFile: 'logs/closeRate-test.log'
};

// ========== 模块导出 ==========
module.exports = {
  CONFIG
};

// 如果直接运行此文件，显示配置信息
if (require.main === module) {
  console.log('SpinPet 交易机器人配置文件 - closeRate 测试');
  console.log('当前配置：');
  console.log(JSON.stringify(CONFIG, null, 2));
}