/**
 * 代币做空脚本
 * 使用 SpinPet SDK 执行保证金做空交易并更新全局状态
 */

const BotGlobal = require('../bot-manager');
const SdkFactory = require('../sdk-factory');
const anchor = require('@coral-xyz/anchor');
const { printTransactionLogsWithBotGlobal } = require('../transaction-logger');

/**
 * 执行做空交易
 * @param {Object} customParams - 自定义参数
 * @param {number} customParams.useSol - 使用的SOL数量 (lamports)
 * @param {number} customParams.upPercentage - 止损百分比 (如 0.15 表示15%)
 */
async function shortTokens(customParams = null) {
  const startTime = Date.now();
  
  try {
    // 执行状态由 run-plan.js 统一管理
    BotGlobal.logMessage('info', '=== 开始执行做空交易 ===');
    
    // 1. 获取配置和状态
    const config = BotGlobal.getConfig();
    const state = BotGlobal.getState();
    
    // 检查代币是否已创建
    if (!state.state.token.mintAddress) {
      throw new Error('代币尚未创建，请先运行 create-token.js');
    }
    
    const mintAddress = state.state.token.mintAddress;
    BotGlobal.logMessage('info', `使用代币地址: ${mintAddress}`);
    
    // 2. 获取做空参数
    let shortParams;
    if (customParams) {
      shortParams = customParams;
      BotGlobal.logMessage('info', '使用自定义做空参数');
    } else {
      // 从配置中查找做空计划
      const shortPlan = config.tradingPlan.find(plan => plan.type === 'short' && plan.enabled);
      if (!shortPlan) {
        throw new Error('未找到启用的做空计划');
      }
      shortParams = shortPlan.params;
      BotGlobal.logMessage('info', `使用配置的做空参数: ${shortPlan.description}`);
    }
    
    // 解析参数
    const useSol = shortParams.useSol || 1000000000; // 默认 1 SOL
    const upPercentage = shortParams.upPercentage || 0.15; // 默认 15%
    
    const useSolDisplay = (useSol / 1e9).toFixed(4);
    const upPercentageDisplay = (upPercentage * 100).toFixed(1);
    
    BotGlobal.logMessage('info', `使用SOL: ${useSolDisplay} SOL`);
    BotGlobal.logMessage('info', `止损百分比: ${upPercentageDisplay}%`);
    
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
    
    // 5. 计算借入卖出代币数量
    BotGlobal.logMessage('info', '计算借入卖出代币数量...');
    const priceAndTokenResult = sdk.curve.sellFromPriceWithSolOutput(currentPrice, useSol);
    if (!priceAndTokenResult) {
      throw new Error('无法计算借入卖出代币数量');
    }
    
    let [endPrice, borrowSellTokenAmount] = priceAndTokenResult;
    const tokenAmountDisplay = (Number(borrowSellTokenAmount) / 1e6).toFixed(0);
    
    BotGlobal.logMessage('info', `计算借入数量: ${tokenAmountDisplay} 个代币`);
    BotGlobal.logMessage('info', `预期价格变化: ${currentPriceStr} -> ${endPrice.toString()}`);
    
    // 6. 检查储备限制
    BotGlobal.logMessage('info', '检查储备限制...');
    const curveAccount = await sdk.chain.getCurveAccount(mintAddress);
    if (borrowSellTokenAmount >= curveAccount.borrowTokenReserve) {
      borrowSellTokenAmount = curveAccount.borrowTokenReserve / 5n;
      BotGlobal.logMessage('info', `调整借入数量（储备限制）: ${(Number(borrowSellTokenAmount) / 1e6).toFixed(0)} 个代币`);
    }
    
    // 7. 使用模拟器验证和调整借入数量
    BotGlobal.logMessage('info', '模拟卖出交易验证流动性...');
    try {
      const sellSimulation = await sdk.simulator.simulateTokenSell(
        mintAddress,
        borrowSellTokenAmount.toString(),
        null
      );
      
      if (sellSimulation && sellSimulation.suggestedTokenAmount) {
        const suggestedAmount = BigInt(sellSimulation.suggestedTokenAmount);
        if (suggestedAmount > 0n && suggestedAmount < borrowSellTokenAmount) {
          const suggestedDisplay = (Number(suggestedAmount) / 1e6).toFixed(0);
          BotGlobal.logMessage('info', `流动性调整: ${tokenAmountDisplay} -> ${suggestedDisplay} 个代币`);
          borrowSellTokenAmount = suggestedAmount;
        }
      }
      
      BotGlobal.logMessage('info', `卖出模拟结果:`);
      BotGlobal.logMessage('info', `  - 完成度: ${sellSimulation.completion}%`);
      BotGlobal.logMessage('info', `  - 价格滑点: ${sellSimulation.slippage}%`);
      BotGlobal.logMessage('info', `  - 建议卖出: ${(Number(sellSimulation.suggestedTokenAmount) / 1e6).toFixed(2)} 个代币`);
      BotGlobal.logMessage('info', `  - 获得SOL: ${(Number(sellSimulation.suggestedSolAmount) / 1e9).toFixed(6)} SOL`);
      
    } catch (simError) {
      BotGlobal.logMessage('warn', `卖出模拟失败，使用原始数量: ${simError.message}`);
    }
    
    // 8. 计算止损价格（上涨止损）
    BotGlobal.logMessage('info', '计算止损价格...');
    const thinkClosePrice = (currentPrice * BigInt(Math.floor((1 + upPercentage) * 100))) / 100n;
    BotGlobal.logMessage('info', `预期止损价格 (上涨 ${upPercentageDisplay}%): ${thinkClosePrice.toString()}`);
    
    // 9. 使用模拟器计算止损参数
    BotGlobal.logMessage('info', '调用止损模拟器...');
    let stopLossResult;
    try {
      stopLossResult = await sdk.simulator.simulateSellStopLoss(
        mintAddress,
        borrowSellTokenAmount.toString(),
        thinkClosePrice
      );
      
      if (!stopLossResult || !stopLossResult.executableStopLossPrice) {
        throw new Error('做空止损模拟器计算失败');
      }
      
      BotGlobal.logMessage('info', `止损模拟结果:`);
      BotGlobal.logMessage('info', `  - 可执行止损价格: ${stopLossResult.executableStopLossPrice.toString()}`);
      BotGlobal.logMessage('info', `  - 止损百分比: ${stopLossResult.stopLossPercentage?.toFixed(2)}%`);
      BotGlobal.logMessage('info', `  - 杠杆倍数: ${stopLossResult.leverage?.toFixed(2)}x`);
      BotGlobal.logMessage('info', `  - 需要SOL输入: ${(Number(stopLossResult.tradeAmount) / 1e9).toFixed(6)} SOL`);
      BotGlobal.logMessage('info', `  - 价格调整次数: ${stopLossResult.iterations}`);
      
    } catch (simError) {
      throw new Error(`做空止损模拟失败: ${simError.message}`);
    }
    
    // 10. 从模拟结果中获取参数
    const closePrice = stopLossResult.executableStopLossPrice.toString();
    const prevOrder = stopLossResult.prev_order_pda;
    const nextOrder = stopLossResult.next_order_pda;
    
    BotGlobal.logMessage('info', '订单链表位置:');
    BotGlobal.logMessage('info', `  - 前一个订单: ${prevOrder || 'null'}`);
    BotGlobal.logMessage('info', `  - 下一个订单: ${nextOrder || 'null'}`);
    
    // 11. 设置交易参数
    const minSolOutput = new anchor.BN('10000'); // 最小 SOL 输出（很小的值）
    const marginSol = new anchor.BN((useSol * 5).toString()); // 保证金是使用SOL的5倍
    
    const marginSolDisplay = (Number(marginSol) / 1e9).toFixed(4);
    
    BotGlobal.logMessage('info', `交易参数:`);
    BotGlobal.logMessage('info', `  - 借入卖出数量: ${(Number(borrowSellTokenAmount) / 1e6).toFixed(0)} 个`);
    BotGlobal.logMessage('info', `  - 最小SOL输出: ${minSolOutput.toString()} lamports`);
    BotGlobal.logMessage('info', `  - 保证金: ${marginSolDisplay} SOL`);
    BotGlobal.logMessage('info', `  - 平仓价格: ${closePrice}`);
    
    // 12. 检查钱包余额
    const walletBalance = await connection.getBalance(wallet.keypair.publicKey);
    const balanceSOL = (walletBalance / 1e9).toFixed(4);
    BotGlobal.logMessage('info', `钱包SOL余额: ${balanceSOL} SOL`);
    
    const requiredSOL = Number(marginSol);
    if (walletBalance < requiredSOL) {
      const requiredDisplay = (requiredSOL / 1e9).toFixed(4);
      BotGlobal.logMessage('warn', `钱包余额不足！需要 ${requiredDisplay} SOL，当前 ${balanceSOL} SOL`);
      // 继续执行，让链上交易来验证余额
    }
    
    // 13. 构建做空交易
    BotGlobal.logMessage('info', '开始构建做空交易...');
    const shortResult = await sdk.trading.short({
      mintAccount: mintAddress,
      borrowSellTokenAmount: new anchor.BN(borrowSellTokenAmount.toString()),
      minSolOutput: minSolOutput,
      marginSol: marginSol,
      closePrice: new anchor.BN(closePrice),
      prevOrder: prevOrder,
      nextOrder: nextOrder,
      payer: wallet.keypair.publicKey
    });
    
    BotGlobal.logMessage('info', '做空交易已构建');
    BotGlobal.logMessage('info', '交易详情:');
    BotGlobal.logMessage('info', `  - 使用订单数: ${shortResult.orderData.ordersUsed}`);
    BotGlobal.logMessage('info', `  - LP配对数: ${shortResult.orderData.lpPairsCount}`);
    BotGlobal.logMessage('info', `  - 自建订单: ${shortResult.accounts.selfOrder.toString()}`);
    
    // 14. 签名并发送交易
    BotGlobal.logMessage('info', '开始签名和发送做空交易...');
    
    // 设置交易参数
    shortResult.transaction.feePayer = wallet.keypair.publicKey;
    shortResult.transaction.recentBlockhash = (
      await connection.getLatestBlockhash()
    ).blockhash;
    
    // 签名交易
    shortResult.transaction.sign(wallet.keypair, ...shortResult.signers);
    
    // 发送交易
    const signature = await connection.sendRawTransaction(
      shortResult.transaction.serialize(),
      {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
        maxRetries: 3
      }
    );
    
    BotGlobal.logMessage('info', `做空交易已发送，签名: ${signature}`);
    
    // 15. 等待交易确认
    BotGlobal.logMessage('info', '等待交易确认...');
    const confirmation = await connection.confirmTransaction(signature, 'confirmed');
    
    if (confirmation.value.err) {
      throw new Error('做空交易失败: ' + JSON.stringify(confirmation.value.err));
    }
    
    // 打印交易日志
    await printTransactionLogsWithBotGlobal({
      connection: connection,
      signature: signature,
      BotGlobal: BotGlobal,
      title: "做空交易"
    });
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    BotGlobal.logMessage('info', `✅ 代币做空成功！耗时 ${duration} 秒`);
    BotGlobal.logMessage('info', `交易签名: ${signature}`);
    BotGlobal.logMessage('info', `订单PDA: ${shortResult.accounts.selfOrder.toString()}`);
    
    // 16. 查询交易后的SOL余额
    const newWalletBalance = await connection.getBalance(wallet.keypair.publicKey);
    const solSpent = walletBalance - newWalletBalance;
    const solSpentDisplay = (solSpent / 1e9).toFixed(6);
    const newBalanceDisplay = (newWalletBalance / 1e9).toFixed(4);
    
    BotGlobal.logMessage('info', `花费SOL: ${solSpentDisplay} SOL`);
    BotGlobal.logMessage('info', `剩余SOL余额: ${newBalanceDisplay} SOL`);
    
    // 17. 更新全局状态 - 添加空头仓位
    const shortPosition = {
      orderPda: shortResult.accounts.selfOrder.toString(),
      mintAddress: mintAddress,
      borrowSellTokenAmount: borrowSellTokenAmount.toString(),
      marginSol: marginSol.toString(),
      closePrice: closePrice,
      openTime: new Date().toISOString(),
      leverage: stopLossResult.leverage?.toFixed(2) + 'x',
      stopLossPercentage: stopLossResult.stopLossPercentage?.toFixed(2) + '%'
    };
    
    // 获取当前空仓数组，如果不存在则创建
    const currentShortPositions = state.state.positions.shortPositions || [];
    currentShortPositions.push(shortPosition);
    BotGlobal.setState('positions.shortPositions', currentShortPositions);
    
    // 18. 添加交易历史
    BotGlobal.addTradeHistory({
      type: 'short',
      description: `做空 ${(Number(borrowSellTokenAmount) / 1e6).toFixed(0)} 个代币，止损 ${upPercentageDisplay}%`,
      status: 'completed',
      txSignature: signature,
      mintAddress: mintAddress,
      params: {
        useSol: useSol,
        upPercentage: upPercentage,
        borrowSellTokenAmount: borrowSellTokenAmount.toString(),
        minSolOutput: minSolOutput.toString(),
        marginSol: marginSol.toString(),
        closePrice: closePrice
      },
      results: {
        orderPda: shortResult.accounts.selfOrder.toString(),
        solSpent: solSpent.toString(),
        leverage: stopLossResult.leverage?.toFixed(2) + 'x',
        stopLossPercentage: stopLossResult.stopLossPercentage?.toFixed(2) + '%',
        prevOrder: prevOrder,
        nextOrder: nextOrder
      },
      duration: duration + 's'
    });
    
    // 19. 执行完成状态由 run-plan.js 统一管理
    
    // 20. 保存状态
    BotGlobal.saveState();
    
    BotGlobal.logMessage('info', '=== 代币做空完成 ===');
    
    return {
      success: true,
      signature: signature,
      mintAddress: mintAddress,
      orderPda: shortResult.accounts.selfOrder.toString(),
      borrowSellTokenAmount: borrowSellTokenAmount,
      solSpent: solSpent,
      marginSol: marginSol,
      closePrice: closePrice,
      leverage: stopLossResult.leverage?.toFixed(2) + 'x',
      accounts: shortResult.accounts,
      duration: duration
    };
    
  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    BotGlobal.logMessage('error', `❌ 代币做空失败 (耗时 ${duration} 秒): ${error.message}`);
    // 错误状态由 run-plan.js 统一管理
    
    // 添加失败的交易历史
    BotGlobal.addTradeHistory({
      type: 'short',
      description: '代币做空失败',
      status: 'error',
      error: error.message,
      duration: duration + 's'
    });
    
    BotGlobal.saveState();
    
    throw error;
  }
}

// 如果直接运行此文件，执行做空
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
    } else if (args[i] === '--upPercentage' && args[i + 1]) {
      if (!customParams) customParams = {};
      customParams.upPercentage = parseFloat(args[i + 1]) / 100; // 转换为小数
      i++;
    }
  }
  
  // 使用用户需求的默认值：1 SOL, 15%
  if (!customParams) {
    customParams = {
      useSol: 1000000000,    // 1 SOL
      upPercentage: 0.15     // 15%
    };
  }
  
  console.log('使用参数:', {
    useSol: (customParams.useSol / 1e9).toFixed(4) + ' SOL',
    upPercentage: (customParams.upPercentage * 100).toFixed(1) + '%'
  });
  
  shortTokens(customParams)
    .then((result) => {
      console.log('\n=== 做空执行结果 ===');
      console.log('成功:', result.success);
      console.log('交易签名:', result.signature);
      console.log('代币地址:', result.mintAddress);
      console.log('订单PDA:', result.orderPda);
      console.log('借入代币:', (Number(result.borrowSellTokenAmount) / 1e6).toFixed(2), '个');
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
      console.error('\n=== 做空执行失败 ===');
      console.error('错误信息:', error.message);
      process.exit(1);
    });
}

module.exports = { shortTokens };