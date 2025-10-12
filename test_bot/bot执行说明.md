# SpinPet 交易机器人执行说明

## 概述

SpinPet 交易机器人是一个用于执行完整交易计划的自动化工具，支持创建代币、买卖交易、做多做空、平仓等操作。

## 核心功能

### 1. 配置文件系统

机器人支持两种配置方式：

- **默认配置**: 使用 `test_bot/bot-config.js` 中的配置
- **自定义配置**: 通过 `-js` 参数指定任意配置文件

### 2. 交易操作支持

- `create-token`: 创建新代币
- `buy`: 买入交易
- `sell`: 卖出交易  
- `long`: 做多交易（保证金）
- `short`: 做空交易（保证金）
- `closeLong`: 平仓做多
- `closeShort`: 平仓做空

## 使用方法

### 基础命令

```bash
# 使用默认配置执行完整交易计划
node test_bot/bot-run.js

# 使用自定义配置文件执行
node test_bot/bot-run.js -js test_bot/bot-config-err2.js
node test_bot/bot-run.js -js test_bot/config-单空关.js
node test_bot/bot-run.js -js test_bot/config-单空止损.js
node test_bot/bot-run.js -js test_bot/config-空买平卖.js
node test_bot/bot-run.js -js test_bot/config-买空卖平.js
node test_bot/bot-run.js -js test_bot/config-单多止损.js
node test_bot/bot-run.js -js test_bot/config-单多关.js
node test_bot/bot-run.js -js test_bot/config-多order0溢出.js
node test_bot/bot-run.js -js test_bot/config-空order0溢出.js
node test_bot/bot-run.js -js test_bot/config-单多半关.js
node test_bot/bot-run.js -js test_bot/config-单空半关.js
node test_bot/bot-run.js -js test_bot/config-单空半关2.js
node test_bot/bot-run.js -js test_bot/config-单多半爆.js
node test_bot/bot-run.js -js test_bot/config-单空半爆.js
 
# 显示当前交易计划（不执行）
node test_bot/bot-run.js --show

# 重置状态后执行
node test_bot/bot-run.js --reset

# 出错时继续执行后续步骤
node test_bot/bot-run.js --continue-error
```

### 参数组合使用

```bash
# 使用自定义配置 + 重置状态
node test_bot/bot-run.js -js my-config.js --reset

# 使用自定义配置 + 出错继续执行
node test_bot/bot-run.js -js test_bot/bot-config-err2.js --continue-error

# 查看自定义配置的交易计划
node test_bot/bot-run.js -js test_bot/bot-config-err2.js --show
```

## 配置文件格式

自定义配置文件需要导出 `CONFIG` 对象：

```javascript
const CONFIG = {
  // 网络配置
  network: 'LOCALNET',
  walletIndex: 0,
  
  // 代币配置
  tokenInfo: {
    name: 'My Token',
    symbol: 'MT',
    uri: 'https://example.com/token.json'
  },
  
  // 交易计划配置
  tradingPlan: [
    {
      type: 'create-token',
      enabled: true,
      description: '创建代币',
      params: {}
    },
    {
      type: 'buy',
      enabled: true,
      description: '买入测试',
      params: {
        buyTokenAmount: '1000000000',
        maxSolAmount: '5000000000'
      }
    }
    // ... 更多步骤
  ],
  
  // 日志配置
  logFile: 'logs/trading.log'
};

module.exports = { CONFIG };
```

## 执行流程

1. **参数解析**: 解析命令行参数，处理 `-js` 自定义配置
2. **配置加载**: 加载并验证交易计划配置
3. **状态管理**: 检查执行状态，支持断点续传
4. **交易执行**: 按计划顺序执行各个交易步骤
5. **结果报告**: 生成详细的执行报告和状态总结
6. **数据查询**: 执行完成后查询最新的链上数据

## 状态管理

### 状态文件

机器人会自动保存执行状态到 `test_bot/bot-state-backup.json`，包含：

- 代币信息（mint地址、密钥对等）
- 交易历史记录
- 当前持仓状态
- 执行进度和错误信息

### 断点续传

默认情况下，机器人会跳过已完成的步骤，只执行未完成的部分。使用 `--reset` 参数可以重新开始整个流程。

## 日志系统

### 日志级别

- `INFO`: 一般执行信息
- `WARN`: 警告信息
- `ERROR`: 错误信息
- `DEBUG`: 调试信息

### 日志输出

- **控制台**: 实时显示所有日志信息
- **文件**: 保存到配置文件中指定的日志文件路径

## 错误处理

### 错误类型

1. **配置错误**: 配置文件格式不正确或缺少必需字段
2. **网络错误**: Solana网络连接问题
3. **交易错误**: 交易执行失败（余额不足、滑点过大等）
4. **合约错误**: 智能合约调用失败

### 错误恢复

- 默认遇到错误会停止执行
- 使用 `--continue-error` 可以跳过错误继续执行
- 错误信息会记录到状态文件和日志中

## 网络配置

支持三种网络环境：

- `MAINNET`: 主网环境
- `TESTNET`: 测试网环境  
- `LOCALNET`: 本地开发环境（默认）

## 安全注意事项

1. **私钥安全**: 确保钱包私钥文件的安全性
2. **网络环境**: 测试时建议使用测试网或本地网络
3. **参数验证**: 仔细检查交易参数，避免意外损失
4. **日志敏感信息**: 日志文件可能包含敏感信息，注意保护

## 常见问题

### Q: 如何创建自定义配置文件？
A: 复制 `test_bot/bot-config.js` 作为模板，修改其中的交易计划和参数。

### Q: 执行中断后如何继续？
A: 直接重新运行命令，机器人会自动跳过已完成的步骤。

### Q: 如何重新开始整个流程？
A: 使用 `--reset` 参数重置状态，或删除 `bot-state-backup.json` 文件。

### Q: 交易失败如何处理？
A: 检查日志文件中的错误信息，修正配置后重新执行。使用 `--continue-error` 可以跳过失败步骤继续执行。

## 示例场景

### 场景1: 完整的代币测试流程
```bash
node test_bot/bot-run.js -js test_bot/bot-config-full-test.js
```

### 场景2: 只测试交易功能（跳过代币创建）
```bash
node test_bot/bot-run.js -js test_bot/bot-config-trading-only.js
```

### 场景3: 错误恢复测试
```bash
node test_bot/bot-run.js -js test_bot/bot-config-err2.js --continue-error
```