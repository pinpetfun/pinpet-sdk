/**
 * 平仓做多脚本
 * 使用 SpinPet SDK 平仓做多头寸并更新全局状态
 */

const BotGlobal = require('../bot-manager');
const SdkFactory = require('../sdk-factory');
const anchor = require('@coral-xyz/anchor');
const { printTransactionLogsWithBotGlobal } = require('../transaction-logger');

/**
 * 平仓做多交易
 * @param {Object} customParams - 自定义参数，支持 orderBy 参数
 */
async function closeLongTokens(customParams = null) {
  const startTime = Date.now();
  
  try {
    BotGlobal.logMessage('info', '=== 开始执行平仓做多交易 ===');
    
    // 1. 获取配置和状态
    const config = BotGlobal.getConfig();
    const state = BotGlobal.getState();
    
    // 检查代币是否已创建
    if (!state.state.token.mintAddress) {
      throw new Error('代币尚未创建，请先运行 create-token.js');
    }
    
    const mintAddress = state.state.token.mintAddress;
    BotGlobal.logMessage('info', `使用代币地址: ${mintAddress}`);
    
    // 2. 获取平仓参数
    let closeLongParams = customParams || {};
    if (!customParams) {
      // 从配置中查找平仓做多计划
      const closeLongPlan = config.tradingPlan.find(plan => plan.type === 'closeLong' && plan.enabled);
      if (closeLongPlan && closeLongPlan.params) {
        closeLongParams = closeLongPlan.params;
      }
    }
    
    // 获取 orderBy 参数，默认为 'start_time_desc'（先平新订单）
    const orderBy = closeLongParams.orderBy || 'start_time_desc';
    BotGlobal.logMessage('info', `使用订单排序方式: ${orderBy}`);
    
    // 获取 closeRate 参数，默认为 100.0（全部平仓）
    const closeRate = closeLongParams.closeRate || 100.0;
    BotGlobal.logMessage('info', `平仓比例: ${closeRate}%`);
    
    // 验证 closeRate 参数
    if (closeRate <= 0) {
      BotGlobal.logMessage('info', 'closeRate <= 0，跳过平仓操作');
      return {
        success: true,
        skipped: true,
        message: 'closeRate无效，必须大于0'
      };
    }
    
    // 2. 获取SDK实例
    const { sdk, connection, wallet } = SdkFactory.getSdk();
    
    // 3. 查找可平仓的做多订单
    BotGlobal.logMessage('info', '正在查找做多订单...');
    const userAddress = wallet.keypair.publicKey.toString();
    
    try {
      // 使用SDK的fast模块获取用户订单
      const userOrdersResult = await sdk.data.user_orders(
        userAddress,
        mintAddress,
        { page: 1, limit: 200, order_by: orderBy }
      );
      
      if (!userOrdersResult.success || !userOrdersResult.data.orders) {
        BotGlobal.logMessage('warn', '无法获取用户订单数据或无订单需要关闭');
        return {
          success: true,
          skipped: true,
          message: '没有找到可关闭的做多订单'
        };
      }
      
      // 查找做多订单 (order_type === 1)
      const longOrders = userOrdersResult.data.orders.filter(order => order.order_type === 1);
      
      if (longOrders.length === 0) {
        BotGlobal.logMessage('info', '没有找到做多订单，跳过平仓操作');
        return {
          success: true,
          skipped: true,
          message: '没有找到可关闭的做多订单'
        };
      }
      
      BotGlobal.logMessage('info', `找到 ${longOrders.length} 个做多订单`);
      
      // 选择第一个做多订单进行平仓
      const targetOrder = longOrders[0];
      const orderPda = targetOrder.order_pda;
      
      // 根据 closeRate 计算实际平仓数量
      let actualCloseAmount;
      if (closeRate >= 100.0) {
        // 全部平仓
        actualCloseAmount = targetOrder.lock_lp_token_amount;
      } else {
        // 部分平仓：使用整数运算避免精度问题
        const totalAmount = Number(targetOrder.lock_lp_token_amount);
        actualCloseAmount = Math.floor(totalAmount * closeRate / 100.0);
      }
      
      // 检查计算结果的有效性
      if (actualCloseAmount <= 0) {
        BotGlobal.logMessage('warn', '计算的平仓数量为0或负数，跳过平仓操作');
        return {
          success: true,
          skipped: true,
          message: '平仓数量太小，无法执行'
        };
      }
      
      const borrowAmount = actualCloseAmount; // 实际卖出数量
      
      BotGlobal.logMessage('info', `选择平仓订单:`);
      BotGlobal.logMessage('info', `  - 订单PDA: ${orderPda}`);
      BotGlobal.logMessage('info', `  - 订单总数量: ${(Number(targetOrder.lock_lp_token_amount) / 1e6).toFixed(2)} 个代币`);
      BotGlobal.logMessage('info', `  - 实际平仓数量: ${(Number(borrowAmount) / 1e6).toFixed(2)} 个代币 (${closeRate}%)`);
      BotGlobal.logMessage('info', `  - 保证金: ${(targetOrder.margin_sol_amount / 1e9).toFixed(4)} SOL`);
      BotGlobal.logMessage('info', `  - 价格区间: ${targetOrder.lock_lp_start_price} - ${targetOrder.lock_lp_end_price}`);
      
      // 4. 设置平仓参数
      const sellTokenAmount = new anchor.BN(borrowAmount.toString());
      const minSolOutput = new anchor.BN('1000'); // 设置一个很小的最小输出值，避免交易失败
      
      BotGlobal.logMessage('info', `平仓参数:`);
      BotGlobal.logMessage('info', `  - 卖出代币数量: ${(Number(sellTokenAmount) / 1e6).toFixed(2)} 个`);
      BotGlobal.logMessage('info', `  - 最小SOL输出: ${(Number(minSolOutput) / 1e9).toFixed(9)} SOL`);
      
      // 5. 检查钱包余额
      const walletBalance = await connection.getBalance(wallet.keypair.publicKey);
      const balanceSOL = (walletBalance / 1e9).toFixed(4);
      BotGlobal.logMessage('info', `钱包SOL余额: ${balanceSOL} SOL`);
      
      // 6. 构建平仓做多交易
      BotGlobal.logMessage('info', '开始构建平仓做多交易...');
      const closeLongResult = await sdk.trading.closeLong({
        mintAccount: mintAddress,
        closeOrder: orderPda,
        sellTokenAmount: sellTokenAmount,
        minSolOutput: minSolOutput,
        payer: wallet.keypair.publicKey
      });
      
      BotGlobal.logMessage('info', '平仓做多交易已构建');
      BotGlobal.logMessage('info', '交易详情:');
      BotGlobal.logMessage('info', `  - 使用订单数: ${closeLongResult.orderData.ordersUsed}`);
      BotGlobal.logMessage('info', `  - LP配对数: ${closeLongResult.orderData.lpPairsCount}`);
      
      // 7. 签名并发送交易
      BotGlobal.logMessage('info', '开始签名和发送平仓做多交易...');
      
      // 设置交易参数
      closeLongResult.transaction.feePayer = wallet.keypair.publicKey;
      closeLongResult.transaction.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
      
      // 签名交易
      closeLongResult.transaction.sign(wallet.keypair, ...closeLongResult.signers);
      
      // 发送交易
      const signature = await connection.sendRawTransaction(
        closeLongResult.transaction.serialize(),
        {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
          maxRetries: 1
        }
      );
      
      BotGlobal.logMessage('info', `平仓做多交易已发送，签名: ${signature}`);
      
      // 8. 等待交易确认
      BotGlobal.logMessage('info', '等待交易确认...');
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        throw new Error('平仓做多交易失败: ' + JSON.stringify(confirmation.value.err));
      }
      
      // 打印交易日志
      await printTransactionLogsWithBotGlobal({
        connection: connection,
        signature: signature,
        BotGlobal: BotGlobal,
        title: "平仓做多交易"
      });
      
      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);
      
      BotGlobal.logMessage('info', `✅ 平仓做多成功！耗时 ${duration} 秒`);
      BotGlobal.logMessage('info', `交易签名: ${signature}`);
      BotGlobal.logMessage('info', `关闭订单PDA: ${orderPda}`);
      
      // 9. 查询交易后的SOL余额
      const newWalletBalance = await connection.getBalance(wallet.keypair.publicKey);
      const solGained = newWalletBalance - walletBalance;
      const solGainedDisplay = (solGained / 1e9).toFixed(6);
      const newBalanceDisplay = (newWalletBalance / 1e9).toFixed(4);
      
      BotGlobal.logMessage('info', `获得SOL: ${solGainedDisplay} SOL`);
      BotGlobal.logMessage('info', `剩余SOL余额: ${newBalanceDisplay} SOL`);
      
      // 10. 更新全局状态 - 处理平仓后的多头仓位
      let currentLongPositions = state.state.positions.longPositions || [];
      let updatedLongPositions;
      
      if (closeRate >= 100.0) {
        // 全部平仓，移除该仓位
        updatedLongPositions = currentLongPositions.filter(pos => pos.orderPda !== orderPda);
        const closedPositionsCount = currentLongPositions.length - updatedLongPositions.length;
        BotGlobal.logMessage('info', `已完全平仓，移除 ${closedPositionsCount} 个多头仓位`);
      } else {
        // 部分平仓，更新仓位数量（如果存在的话）
        updatedLongPositions = currentLongPositions.map(pos => {
          if (pos.orderPda === orderPda) {
            const remainingAmount = Number(targetOrder.lock_lp_token_amount) - Number(borrowAmount);
            return {
              ...pos,
              remaining_amount: remainingAmount,
              partial_close_history: [
                ...(pos.partial_close_history || []),
                {
                  closeDate: new Date().toISOString(),
                  closedAmount: Number(borrowAmount),
                  closeRate: closeRate
                }
              ]
            };
          }
          return pos;
        });
        BotGlobal.logMessage('info', `部分平仓 ${closeRate}%，更新仓位信息`);
      }
      
      BotGlobal.setState('positions.longPositions', updatedLongPositions);
      
      // 11. 添加交易历史
      BotGlobal.addTradeHistory({
        type: 'closeLong',
        description: `平仓做多 ${(Number(sellTokenAmount) / 1e6).toFixed(0)} 个代币 (${closeRate}%)`,
        status: 'completed',
        txSignature: signature,
        mintAddress: mintAddress,
        params: {
          closeOrder: orderPda,
          sellTokenAmount: sellTokenAmount.toString(),
          minSolOutput: minSolOutput.toString(),
          closeRate: closeRate,
          originalAmount: targetOrder.lock_lp_token_amount.toString()
        },
        results: {
          orderClosed: orderPda,
          solGained: solGained.toString(),
          marginRecovered: targetOrder.margin_sol_amount.toString(),
          isPartialClose: closeRate < 100.0,
          closeRate: closeRate
        },
        duration: duration + 's'
      });
      
      // 12. 保存状态
      BotGlobal.saveState();
      
      BotGlobal.logMessage('info', '=== 平仓做多完成 ===');
      
      return {
        success: true,
        signature: signature,
        mintAddress: mintAddress,
        orderClosed: orderPda,
        sellTokenAmount: sellTokenAmount,
        solGained: solGained,
        marginRecovered: targetOrder.margin_sol_amount,
        duration: duration
      };
      
    } catch (error) {
      console.error('closeLongTokens 报错:',error);
      throw new Error(`查找或处理用户订单失败: ${error.message}`);
      
    }
    
  } catch (error) {
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);
    
    BotGlobal.logMessage('error', `❌ 平仓做多失败 (耗时 ${duration} 秒): ${error.message}`);
    console.error(error);
    
    // 添加失败的交易历史
    BotGlobal.addTradeHistory({
      type: 'closeLong',
      description: '平仓做多失败',
      status: 'error',
      error: error.message,
      duration: duration + 's'
    });
    
    BotGlobal.saveState();
    
    throw error;
  }
}

// 如果直接运行此文件，执行平仓做多
if (require.main === module) {
  closeLongTokens()
    .then((result) => {
      if (result.skipped) {
        console.log('\n=== 平仓做多跳过 ===');
        console.log('原因:', result.message);
      } else {
        console.log('\n=== 平仓做多执行结果 ===');
        console.log('成功:', result.success);
        console.log('交易签名:', result.signature);
        console.log('代币地址:', result.mintAddress);
        console.log('关闭订单PDA:', result.orderClosed);
        console.log('卖出代币:', (Number(result.sellTokenAmount) / 1e6).toFixed(2), '个', `(${result.results?.closeRate || 100}%)`);
        console.log('获得SOL:', (Number(result.solGained) / 1e9).toFixed(6), 'SOL');
        console.log('回收保证金:', (Number(result.marginRecovered) / 1e9).toFixed(4), 'SOL');
        console.log('用时:', result.duration);
      }
      
      // 显示状态报告
      console.log('\n');
      BotGlobal.printStatusReport();
    })
    .catch((error) => {
      console.error('\n=== 平仓做多执行失败 ===');
      console.error('错误信息:', error.message);
      process.exit(1);
    });
}

module.exports = { closeLongTokens };