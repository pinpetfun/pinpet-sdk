/**
 * 交易日志打印工具
 * 提供统一的交易成功后日志打印功能
 */

const { LAMPORTS_PER_SOL } = require('@solana/web3.js');

/**
 * 打印交易完成后的详细日志信息
 * @param {Object} options - 配置选项
 * @param {Object} options.connection - Solana连接对象
 * @param {string} options.signature - 交易签名
 * @param {Object} options.logger - 日志记录器，默认使用console（可选）
 * @param {string} options.title - 日志标题，如"做多交易"或"做空交易"（可选）
 */
async function printTransactionLogs(options) {
  const {
    connection,
    signature,
    logger = console,
    title = "交易"
  } = options;

  if (!connection || !signature) {
    logger.error('printTransactionLogs: 缺少必需参数 connection 或 signature');
    return;
  }

  try {
    // 获取交易详情和日志
    const txDetails = await connection.getTransaction(signature, {
      commitment: 'confirmed',
    });

    if (!txDetails) {
      logger.warn('无法获取交易详情');
      return;
    }

    // 打印CU消耗信息
    logger.log(`\n-------- ${title}CU消耗信息 --------`);
    if (txDetails && txDetails.meta) {
      if (txDetails.meta.computeUnitsConsumed !== undefined) {
        logger.log("消耗的CU值:", txDetails.meta.computeUnitsConsumed.toLocaleString());
      }
      if (txDetails.meta.fee !== undefined) {
        logger.log("交易费用:", txDetails.meta.fee, "lamports");
        logger.log("交易费用:", (txDetails.meta.fee / LAMPORTS_PER_SOL).toFixed(9), "SOL");
      }
    }
    logger.log(`-------- ${title}CU消耗信息结束 --------\n`);

    // 打印交易日志
    logger.log(`-------- ${title}链上程序日志输出 --------`);
    if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
      const programLogs = txDetails.meta.logMessages.filter(log =>
        log.includes('Program log:') && !log.includes('Program log: Instruction:')
      );
      
      if (programLogs.length > 0) {
        programLogs.forEach(log => {
          logger.log(log);
        });
      } else {
        logger.log('无程序日志输出');
      }
    } else {
      logger.log("无法获取交易日志");
    }
    logger.log(`-------- ${title}链上程序日志结束 --------\n`);

  } catch (error) {
    logger.error(`获取交易日志失败: ${error.message}`);
  }
}

/**
 * 打印交易完成后的详细日志信息（兼容BotGlobal日志系统）
 * @param {Object} options - 配置选项
 * @param {Object} options.connection - Solana连接对象
 * @param {string} options.signature - 交易签名
 * @param {Object} options.BotGlobal - BotGlobal对象，用于记录日志（可选）
 * @param {string} options.title - 日志标题，如"做多交易"或"做空交易"（可选）
 */
async function printTransactionLogsWithBotGlobal(options) {
  const {
    connection,
    signature,
    BotGlobal,
    title = "交易"
  } = options;

  if (!connection || !signature) {
    const errorMsg = 'printTransactionLogs: 缺少必需参数 connection 或 signature';
    if (BotGlobal) {
      BotGlobal.logMessage('error', errorMsg);
    } else {
      console.error(errorMsg);
    }
    return;
  }

  const logger = BotGlobal ? {
    log: (message, ...args) => {
      if (args.length > 0) {
        BotGlobal.logMessage('info', `${message} ${args.join(' ')}`);
      } else {
        BotGlobal.logMessage('info', message);
      }
    },
    warn: (message) => BotGlobal.logMessage('warn', message),
    error: (message) => BotGlobal.logMessage('error', message)
  } : console;

  try {
    // 获取交易详情和日志
    const txDetails = await connection.getTransaction(signature, {
      commitment: 'confirmed',
    });

    if (!txDetails) {
      logger.warn('无法获取交易详情');
      return;
    }

    // 打印CU消耗信息
    logger.log(`\n-------- ${title}CU消耗信息 --------`);
    if (txDetails && txDetails.meta) {
      if (txDetails.meta.computeUnitsConsumed !== undefined) {
        logger.log("消耗的CU值:", txDetails.meta.computeUnitsConsumed.toLocaleString());
      }
      if (txDetails.meta.fee !== undefined) {
        logger.log("交易费用:", txDetails.meta.fee, "lamports");
        logger.log("交易费用:", (txDetails.meta.fee / LAMPORTS_PER_SOL).toFixed(9), "SOL");
      }
    }
    logger.log(`-------- ${title}CU消耗信息结束 --------\n`);

    // 打印交易日志
    logger.log(`-------- ${title}链上程序日志输出 --------`);
    if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
      const programLogs = txDetails.meta.logMessages.filter(log =>
        log.includes('Program log:') && !log.includes('Program log: Instruction:')
      );
      
      if (programLogs.length > 0) {
        programLogs.forEach(log => {
          logger.log(log);
        });
      } else {
        logger.log('无程序日志输出');
      }
    } else {
      logger.log("无法获取交易日志");
    }
    logger.log(`-------- ${title}链上程序日志结束 --------\n`);

  } catch (error) {
    logger.error(`获取交易日志失败: ${error.message}`);
  }
}

module.exports = {
  printTransactionLogs,
  printTransactionLogsWithBotGlobal
};