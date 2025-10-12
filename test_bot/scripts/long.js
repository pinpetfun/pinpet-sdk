/**
 * 代币做多脚本
 * 使用 SpinPet SDK 执行保证金做多交易并更新全局状态
 */

const BotGlobal = require('../bot-manager');
const SdkFactory = require('../sdk-factory');
const anchor = require('@coral-xyz/anchor');
const { printTransactionLogsWithBotGlobal } = require('../transaction-logger');

/**
 * 执行做多交易
 * @param {Object} customParams - 自定义参数
 * @param {number} customParams.useSol - 使用的SOL数量 (lamports)
 * @param {number} customParams.downPercentage - 止损百分比 (如 0.1 表示10%)
 */
async function longTokens(customParams = null) {
  const startTime = Date.now();
  
  try {
    // 执行状态由 run-plan.js 统一管理
    BotGlobal.logMessage('info', '=== 开始执行做多交易 ===');
    
    // 1. 获取配置和状态
    const config = BotGlobal.getConfig();
    const state = BotGlobal.getState();
    
    // 检查代币是否已创建
    if (!state.state.token.mintAddress) {
      throw new Error('代币尚未创建，请先运行 create-token.js');
    }
    
    const mintAddress = state.state.token.mintAddress;
    BotGlobal.logMessage('info', `使用代币地址: ${mintAddress}`);
    
    // 2. 获取做多参数
    let longParams;
    if (customParams) {
      longParams = customParams;
      BotGlobal.logMessage('info', '使用自定义做多参数');
    } else {
      // 从配置中查找做多计划
      const longPlan = config.tradingPlan.find(plan => plan.type === 'long' && plan.enabled);
      if (!longPlan) {
        throw new Error('未找到启用的做多计划');
      }
      longParams = longPlan.params;
      BotGlobal.logMessage('info', `使用配置的做多参数: ${longPlan.description}`);
    }
    
    // 解析参数
    const useSol = longParams.useSol || 1000000000; // 默认 1 SOL
    const downPercentage = longParams.downPercentage || 0.1; // 默认 10%
    
    const useSolDisplay = (useSol / 1e9).toFixed(4);
    const downPercentageDisplay = (downPercentage * 100).toFixed(1);
    
    BotGlobal.logMessage('info', `使用SOL: ${useSolDisplay} SOL`);
    BotGlobal.logMessage('info', `止损百分比: ${downPercentageDisplay}%`);
    
    // 3. 获取SDK实例
    const { sdk, connection, wallet } = SdkFactory.getSdk();
    
    // 4. 获取当前价格
    BotGlobal.logMessage('info', '获取代币当前价格...');
    const currentPriceStr = await sdk.data.price(mintAddress);
    if (!currentPriceStr) {
      throw new Error('无法获取代币当前价格');
    }
    
    const currentPrice = BigInt(currentPriceStr);
    BotGlobal.logMessage('info', `当前价格: ${currentPriceStr}`);
    
    // 5. 计算买入代币数量
    BotGlobal.logMessage('info', '计算买入代币数量...');
    const priceAndTokenResult = sdk.curve.buyFromPriceWithSolInput(currentPrice, useSol);
    if (!priceAndTokenResult) {
      throw new Error('无法计算买入代币数量');
    }
    
    let [endPrice, buyTokenAmount] = priceAndTokenResult;
    const tokenAmountDisplay = (Number(buyTokenAmount) / 1e6).toFixed(0);
    
    BotGlobal.logMessage('info', `计算买入数量: ${tokenAmountDisplay} 个代币`);
    BotGlobal.logMessage('info', `预期价格变化: ${currentPriceStr} -> ${endPrice.toString()}`);
    
    // 6. 使用模拟器验证和调整买入数量
    BotGlobal.logMessage('info', '模拟买入交易验证流动性...');
    try {
      const buySimulation = await sdk.simulator.simulateTokenBuy(
        mintAddress,
        buyTokenAmount.toString(),
        null
      );
      
      if (buySimulation && buySimulation.suggestedTokenAmount) {
        const suggestedAmount = BigInt(buySimulation.suggestedTokenAmount);
        if (suggestedAmount > 0n && suggestedAmount < buyTokenAmount) {
          const suggestedDisplay = (Number(suggestedAmount) / 1e6).toFixed(0);
          BotGlobal.logMessage('info', `流动性调整: ${tokenAmountDisplay} -> ${suggestedDisplay} 个代币`);
          buyTokenAmount = suggestedAmount;
        }
      }
      
      BotGlobal.logMessage('info', `买入模拟结果:`);
      BotGlobal.logMessage('info', `  - 完成度: ${buySimulation.completion}%`);
      BotGlobal.logMessage('info', `  - 价格滑点: ${buySimulation.slippage}%`);
      BotGlobal.logMessage('info', `  - 建议买入: ${(Number(buySimulation.suggestedTokenAmount) / 1e6).toFixed(2)} 个代币`);
      BotGlobal.logMessage('info', `  - 需要SOL: ${(Number(buySimulation.suggestedSolAmount) / 1e9).toFixed(6)} SOL`);
      
    } catch (simError) {
      BotGlobal.logMessage('warn', `买入模拟失败，使用原始数量: ${simError.message}`);
    }
    
    // 7. 计算止损价格
    BotGlobal.logMessage('info', '计算止损价格...');
    const thinkClosePrice = (currentPrice * BigInt(Math.floor((1 - downPercentage) * 100))) / 100n;
    BotGlobal.logMessage('info', `预期止损价格 (下跌 ${downPercentageDisplay}%): ${thinkClosePrice.toString()}`);
    
    // 8. 使用模拟器计算止损参数
    BotGlobal.logMessage('info', '调用止损模拟器...');
    let stopLossResult;
    try {
      stopLossResult = await sdk.simulator.simulateLongStopLoss(
        mintAddress,
        buyTokenAmount.toString(),
        thinkClosePrice
      );
      
      if (!stopLossResult || !stopLossResult.executableStopLossPrice) {
        throw new Error('做多止损模拟器计算失败');
      }
      
      BotGlobal.logMessage('info', `止损模拟结果:`);
      BotGlobal.logMessage('info', `  - 可执行止损价格: ${stopLossResult.executableStopLossPrice.toString()}`);
      BotGlobal.logMessage('info', `  - 止损百分比: ${stopLossResult.stopLossPercentage?.toFixed(2)}%`);
      BotGlobal.logMessage('info', `  - 杠杆倍数: ${stopLossResult.leverage?.toFixed(2)}x`);
      BotGlobal.logMessage('info', `  - 预期SOL输出: ${(Number(stopLossResult.tradeAmount) / 1e9).toFixed(6)} SOL`);
      BotGlobal.logMessage('info', `  - 价格调整次数: ${stopLossResult.iterations}`);
      
    } catch (simError) {
      throw new Error(`做多止损模拟失败: ${simError.message}`);
    }
    
    // 9. 从模拟结果中获取参数
    const closePrice = stopLossResult.executableStopLossPrice.toString();
    const prevOrder = stopLossResult.prev_order_pda;
    const nextOrder = stopLossResult.next_order_pda;
    
    BotGlobal.logMessage('info', '订单链表位置:');
    BotGlobal.logMessage('info', `  - 前一个订单: ${prevOrder || 'null'}`);
    BotGlobal.logMessage('info', `  - 下一个订单: ${nextOrder || 'null'}`);
    
    // 10. 设置交易参数
    // 设置最大 SOL 数量和保证金 (根据实际需求调整)
    const maxSolAmount = new anchor.BN(useSol * 2); // 最大花费是使用SOL的2倍
    const marginSol = new anchor.BN(useSol * 5); // 保证金是使用SOL的5倍
    
    const maxSolDisplay = (Number(maxSolAmount) / 1e9).toFixed(4);
    const marginSolDisplay = (Number(marginSol) / 1e9).toFixed(4);
    
    BotGlobal.logMessage('info', `交易参数:`);
    BotGlobal.logMessage('info', `  - 买入代币数量: ${(Number(buyTokenAmount) / 1e6).toFixed(0)} 个`);
    BotGlobal.logMessage('info', `  - 最大SOL花费: ${maxSolDisplay} SOL`);
    BotGlobal.logMessage('info', `  - 保证金: ${marginSolDisplay} SOL`);
    BotGlobal.logMessage('info', `  - 平仓价格: ${closePrice}`);
    
    // 11. 检查钱包余额
    const walletBalance = await connection.getBalance(wallet.keypair.publicKey);
    const balanceSOL = (walletBalance / 1e9).toFixed(4);
    BotGlobal.logMessage('info', `钱包SOL余额: ${balanceSOL} SOL`);
    
    const requiredSOL = Number(maxSolAmount) + Number(marginSol);
    if (walletBalance < requiredSOL) {
      const requiredDisplay = (requiredSOL / 1e9).toFixed(4);
      BotGlobal.logMessage('warn', `钱包余额不足！需要 ${requiredDisplay} SOL，当前 ${balanceSOL} SOL`);
      // 继续执行，让链上交易来验证余额
    }
    
    // 12. 构建做多交易
    BotGlobal.logMessage('info', '开始构建做多交易...');
    const longResult = await sdk.trading.long({
      mintAccount: mintAddress,
      buyTokenAmount: new anchor.BN(buyTokenAmount.toString()),
      maxSolAmount: maxSolAmount,
      marginSol: marginSol,
      closePrice: new anchor.BN(closePrice),
      prevOrder: prevOrder,
      nextOrder: nextOrder,
      payer: wallet.keypair.publicKey
    });
    
    BotGlobal.logMessage('info', '做多交易已构建');
    BotGlobal.logMessage('info', '交易详情:');
    BotGlobal.logMessage('info', `  - 使用订单数: ${longResult.orderData.ordersUsed}`);
    BotGlobal.logMessage('info', `  - LP配对数: ${longResult.orderData.lpPairsCount}`);
    BotGlobal.logMessage('info', `  - 自建订单: ${longResult.accounts.selfOrder.toString()}`);
    
    // 13. 签名并发送交易
    BotGlobal.logMessage('info', '开始签名和发送做多交易...');
    
    // 设置交易参数
    longResult.transaction.feePayer = wallet.keypair.publicKey;
    longResult.transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    
    // 签名交易
    longResult.transaction.sign(wallet.keypair, ...longResult.signers);
    
    // 发送交易
    const signature = await connection.sendRawTransaction(
      longResult.transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      }
    );
    
    BotGlobal.logMessage('info', `做多交易已发送，签名: ${signature}`);
    
    // 14. 等待交易确认
    BotGlobal.logMessage('info', '等待交易确认...');
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error('做多交易失败: ' + JSON.stringify(confirmation.value.err));
    }
    
    // 打印交易日志
    await printTransactionLogsWithBotGlobal({
      connection: connection,
      signature: signature,
      BotGlobal: BotGlobal,
      title: "做多交易"
    });
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    BotGlobal.logMessage('info', `✅ 代币做多成功！耗时 ${duration} 秒`);
    BotGlobal.logMessage('info', `交易签名: ${signature}`);
    BotGlobal.logMessage('info', `订单PDA: ${longResult.accounts.selfOrder.toString()}`);
    
    // 15. 查询交易后的SOL余额
    const newWalletBalance = await connection.getBalance(wallet.keypair.publicKey);
    const solSpent = walletBalance - newWalletBalance;
    const solSpentDisplay = (solSpent / 1e9).toFixed(6);
    const newBalanceDisplay = (newWalletBalance / 1e9).toFixed(4);
    
    BotGlobal.logMessage('info', `花费SOL: ${solSpentDisplay} SOL`);
    BotGlobal.logMessage('info', `剩余SOL余额: ${newBalanceDisplay} SOL`);
    
    // 16. 更新全局状态 - 添加多头仓位
    const longPosition = {
      orderPda: longResult.accounts.selfOrder.toString(),
      mintAddress: mintAddress,
      buyTokenAmount: buyTokenAmount.toString(),
      marginSol: marginSol.toString(),
      closePrice: closePrice,
      openTime: new Date().toISOString(),
      leverage: stopLossResult.leverage?.toFixed(2) + 'x',
      stopLossPercentage: stopLossResult.stopLossPercentage?.toFixed(2) + '%'
    };
    
    // 获取当前长仓数组，如果不存在则创建
    const currentLongPositions = state.state.positions.longPositions || [];
    currentLongPositions.push(longPosition);
    BotGlobal.setState('positions.longPositions', currentLongPositions);
    
    // 17. 添加交易历史
    BotGlobal.addTradeHistory({
      type: 'long',
      description: `做多 ${(Number(buyTokenAmount) / 1e6).toFixed(0)} 个代币，止损 ${downPercentageDisplay}%`,
      status: 'completed',
      txSignature: signature,
      mintAddress: mintAddress,
      params: {
        useSol: useSol,
        downPercentage: downPercentage,
        buyTokenAmount: buyTokenAmount.toString(),
        maxSolAmount: maxSolAmount.toString(),
        marginSol: marginSol.toString(),
        closePrice: closePrice
      },
      results: {
        orderPda: longResult.accounts.selfOrder.toString(),
        solSpent: solSpent.toString(),
        leverage: stopLossResult.leverage?.toFixed(2) + 'x',
        stopLossPercentage: stopLossResult.stopLossPercentage?.toFixed(2) + '%',
        prevOrder: prevOrder,
        nextOrder: nextOrder
      },
      duration: duration + 's'
    });
    
    // 18. 执行完成状态由 run-plan.js 统一管理
    
    // 19. 保存状态
    BotGlobal.saveState();
    
    BotGlobal.logMessage('info', '=== 代币做多完成 ===');
    
    return {
      success: true,
      signature: signature,
      mintAddress: mintAddress,
      orderPda: longResult.accounts.selfOrder.toString(),
      buyTokenAmount: buyTokenAmount,
      solSpent: solSpent,
      marginSol: marginSol,
      closePrice: closePrice,
      leverage: stopLossResult.leverage?.toFixed(2) + 'x',
      accounts: longResult.accounts,
      duration: duration
    };
    
  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    BotGlobal.logMessage('error', `❌ 代币做多失败 (耗时 ${duration} 秒): ${error.message}`);
    // 错误状态由 run-plan.js 统一管理
    
    // 添加失败的交易历史
    BotGlobal.addTradeHistory({
      type: 'long',
      description: '代币做多失败',
      status: 'error',
      error: error.message,
      duration: duration + 's'
    });
    
    BotGlobal.saveState();
    
    throw error;
  }
}

// 如果直接运行此文件，执行做多
if (require.main === module) {
  // 可以通过命令行参数传递自定义参数
  const args = process.argv.slice(2);
  let customParams = null;
  
  // 解析命令行参数
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--useSol' && args[i + 1]) {
      if (!customParams) customParams = {};
      customParams.useSol = parseFloat(args[i + 1]) * 1e9; // 转换为lamports
      i++;
    } else if (args[i] === '--downPercentage' && args[i + 1]) {
      if (!customParams) customParams = {};
      customParams.downPercentage = parseFloat(args[i + 1]) / 100; // 转换为小数
      i++;
    }
  }
  
  // 使用用户需求的默认值：1 SOL, 10%
  if (!customParams) {
    customParams = {
      useSol: 1000000000,    // 1 SOL
      downPercentage: 0.1    // 10%
    };
  }
  
  console.log('使用参数:', {
    useSol: (customParams.useSol / 1e9).toFixed(4) + ' SOL',
    downPercentage: (customParams.downPercentage * 100).toFixed(1) + '%'
  });
  
  longTokens(customParams)
    .then((result) => {
      console.log('\n=== 做多执行结果 ===');
      console.log('成功:', result.success);
      console.log('交易签名:', result.signature);
      console.log('代币地址:', result.mintAddress);
      console.log('订单PDA:', result.orderPda);
      console.log('买入代币:', (Number(result.buyTokenAmount) / 1e6).toFixed(2), '个');
      console.log('花费SOL:', (Number(result.solSpent) / 1e9).toFixed(6), 'SOL');
      console.log('保证金:', (Number(result.marginSol) / 1e9).toFixed(4), 'SOL');
      console.log('平仓价格:', result.closePrice);
      console.log('杠杆倍数:', result.leverage);
      console.log('用时:', result.duration);
      
      // 显示状态报告
      console.log('\n');
      BotGlobal.printStatusReport();
    })
    .catch((error) => {
      console.error('\n=== 做多执行失败 ===');
      console.error('错误信息:', error.message);
      process.exit(1);
    });
}

module.exports = { longTokens };