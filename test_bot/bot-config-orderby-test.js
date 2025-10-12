/**
 * SpinPet SDK 交易机器人配置 - orderBy 参数测试
 * 测试 closeLong 和 closeShort 的 orderBy 参数功能
 */

// ========== 用户配置区域 ==========
const CONFIG = {
  // 网络配置
  network: 'LOCALNET',
  walletIndex: 0,
  
  // 代币配置
  tokenInfo: {
    name: 'OrderBy Test Token',
    symbol: 'OBT', 
    uri: 'https://example.com/orderby-test-token.json'
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
      enabled: true,
      description: '做多交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    // 使用 1 SOL (lamports)
        downPercentage: 0.05    // 止损 5%
      }
    },

    // 步骤3：第二个做多交易
    { 
      type: 'long', 
      enabled: true,
      description: '第二个做多交易 0.5 SOL，止损 3%',
      params: {
        useSol: 500000000,     // 使用 0.5 SOL (lamports)
        downPercentage: 0.03   // 止损 3%
      }
    },

    // 步骤4：平仓做多 - 使用 start_time_desc（先平新订单）
    { 
      type: 'closeLong', 
      enabled: true,
      description: '平仓做多交易 - 先平新订单',
      params: {
        orderBy: 'start_time_desc'  // 按时间降序，先平仓最新的订单
      }  
    },

    // 步骤5：平仓做多 - 使用 start_time_asc（先平旧订单）
    { 
      type: 'closeLong', 
      enabled: true,
      description: '平仓做多交易 - 先平旧订单',
      params: {
        orderBy: 'start_time_asc'   // 按时间升序，先平仓最旧的订单
      }  
    },

    // 步骤6：做空交易
    { 
      type: 'short', 
      enabled: false,  // 暂时禁用
      description: '做空交易 1 SOL，止损 5%',
      params: {
        useSol: 1000000000,    
        upPercentage: 0.05     // 止损 5%
      }
    },

    // 步骤7：第二个做空交易
    { 
      type: 'short', 
      enabled: false,  // 暂时禁用
      description: '第二个做空交易 0.5 SOL，止损 3%',
      params: {
        useSol: 500000000,    
        upPercentage: 0.03     // 止损 3%
      }
    },

    // 步骤8：平仓做空 - 使用 start_time_desc（先平新订单）
    { 
      type: 'closeShort', 
      enabled: false,  // 暂时禁用
      description: '平仓做空交易 - 先平新订单',
      params: {
        orderBy: 'start_time_desc'  // 按时间降序，先平仓最新的订单
      }  
    },

    // 步骤9：平仓做空 - 使用 start_time_asc（先平旧订单）
    { 
      type: 'closeShort', 
      enabled: false,  // 暂时禁用
      description: '平仓做空交易 - 先平旧订单',
      params: {
        orderBy: 'start_time_asc'   // 按时间升序，先平仓最旧的订单
      }  
    },
  ],
  
  // 日志配置
  logFile: 'logs/trading-orderby-test.log'
};

// ========== 模块导出 ==========
module.exports = {
  CONFIG
};

// 如果直接运行此文件，显示配置信息
if (require.main === module) {
  console.log('SpinPet 交易机器人配置文件 - orderBy 参数测试');
  console.log('当前配置：');
  console.log(JSON.stringify(CONFIG, null, 2));
  console.log('\n使用说明:');
  console.log('1. 此配置文件用于测试 closeLong 和 closeShort 的 orderBy 参数功能');
  console.log('2. orderBy 参数支持两种值:');
  console.log('   - start_time_desc: 按时间降序，先平仓最新的订单');
  console.log('   - start_time_asc: 按时间升序，先平仓最旧的订单');
  console.log('3. 运行命令:');
  console.log('   node test_bot/bot-run.js -js test_bot/bot-config-orderby-test.js');
}