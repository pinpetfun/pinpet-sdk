# SpinPet SDK + Vite 集成指南

## 📋 配置要点

### 1. Vite 配置文件 (`vite.config.js`)

```javascript
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  // 优化依赖预构建
  optimizeDeps: {
    include: [
      '@solana/web3.js',
      '@coral-xyz/anchor',
      'pinpet-sdk',
      'buffer',
      'decimal.js'
    ],
    // 排除有问题的依赖，让 Vite 自动处理
    exclude: ['@solana/codecs']
  },
  
  // 构建配置
  build: {
    // 增加 chunk 大小限制（Solana 依赖比较大）
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // 外部化大型依赖（可选）
      external: [],
      output: {
        // 手动分块，避免单个 chunk 过大
        manualChunks: {
          'solana-web3': ['@solana/web3.js'],
          'anchor': ['@coral-xyz/anchor'],
          'pinpet-sdk': ['pinpet-sdk']
        }
      }
    }
  },
  
  // 开发服务器配置
  server: {
    // 解决跨域问题（如果需要）
    cors: true,
    // 可能需要的代理配置
    proxy: {
      '/api': {
        target: 'https://api.spin.pet',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },
  
  // 解析配置
  resolve: {
    alias: {
      // 确保 buffer polyfill 正确解析
      buffer: 'buffer',
      process: 'process/browser',
      stream: 'stream-browserify',
      util: 'util'
    }
  },
  
  // 定义全局变量
  define: {
    global: 'globalThis',
    'process.env': process.env
  }
})
```

### 2. 安装必要的依赖

```bash
npm install --save-dev vite

# Vite 需要的 polyfills
npm install buffer process stream-browserify util
```

### 3. package.json 脚本配置

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

## 🚀 使用示例

### 基础使用

```javascript
// main.js 或你的入口文件
import { Connection } from '@solana/web3.js'
import { PinPetSdk, getDefaultOptions } from 'pinpet-sdk'

// 获取默认配置
const options = getDefaultOptions('DEVNET') // 或 'MAINNET', 'LOCALNET'

// 创建连接
const connection = new Connection(options.solanaEndpoint)

// 初始化 SDK
const sdk = new PinPetSdk(connection, 'your-program-id', {
  ...options,
  defaultDataSource: 'fast' // 或 'chain'
})

// 使用 SDK
async function example() {
  try {
    // 获取代币信息
    const mintInfo = await sdk.fast.mint_info('your-mint-address')
    console.log('Token info:', mintInfo)
    
    // 获取价格
    const price = await sdk.data.price('your-mint-address')
    console.log('Current price:', price)
    
  } catch (error) {
    console.error('Error:', error)
  }
}

example()
```

### Vue 3 组件示例

```vue
<template>
  <div>
    <h2>SpinPet SDK Demo</h2>
    <div v-if="loading">Loading...</div>
    <div v-else>
      <p>Price: {{ price }}</p>
      <button @click="refreshPrice">Refresh Price</button>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { Connection } from '@solana/web3.js'
import { PinPetSdk, getDefaultOptions } from 'pinpet-sdk'

const price = ref(null)
const loading = ref(true)

let sdk = null

onMounted(async () => {
  try {
    // 初始化 SDK
    const options = getDefaultOptions('DEVNET')
    const connection = new Connection(options.solanaEndpoint)
    
    sdk = new PinPetSdk(connection, 'your-program-id', {
      ...options,
      defaultDataSource: 'fast'
    })
    
    await refreshPrice()
  } catch (error) {
    console.error('Initialization error:', error)
  } finally {
    loading.value = false
  }
})

const refreshPrice = async () => {
  if (!sdk) return
  
  try {
    loading.value = true
    const result = await sdk.data.price('your-mint-address')
    price.value = result
  } catch (error) {
    console.error('Price fetch error:', error)
  } finally {
    loading.value = false
  }
}
</script>
```

### React 组件示例

```jsx
import React, { useState, useEffect } from 'react'
import { Connection } from '@solana/web3.js'
import { PinPetSdk, getDefaultOptions } from 'pinpet-sdk'

function SpinPetDemo() {
  const [price, setPrice] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sdk, setSdk] = useState(null)

  useEffect(() => {
    const initSdk = async () => {
      try {
        const options = getDefaultOptions('DEVNET')
        const connection = new Connection(options.solanaEndpoint)
        
        const spinSdk = new PinPetSdk(connection, 'your-program-id', {
          ...options,
          defaultDataSource: 'fast'
        })
        
        setSdk(spinSdk)
        await refreshPrice(spinSdk)
      } catch (error) {
        console.error('Initialization error:', error)
      } finally {
        setLoading(false)
      }
    }

    initSdk()
  }, [])

  const refreshPrice = async (sdkInstance = sdk) => {
    if (!sdkInstance) return
    
    try {
      setLoading(true)
      const result = await sdkInstance.data.price('your-mint-address')
      setPrice(result)
    } catch (error) {
      console.error('Price fetch error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2>SpinPet SDK Demo</h2>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div>
          <p>Price: {price}</p>
          <button onClick={() => refreshPrice()}>Refresh Price</button>
        </div>
      )}
    </div>
  )
}

export default SpinPetDemo
```

## ⚠️ 常见问题和解决方案

### 1. Buffer 问题

如果遇到 `Buffer is not defined` 错误：

```javascript
// vite.config.js
export default defineConfig({
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    }
  },
  optimizeDeps: {
    include: ['buffer']
  }
})
```

### 2. Process 问题

如果遇到 `process is not defined` 错误：

```javascript
// vite.config.js
export default defineConfig({
  define: {
    'process.env': process.env
  }
})
```

### 3. 大包体积警告

Solana 相关依赖较大，可以配置：

```javascript
// vite.config.js
export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2000, // 提高警告阈值到 2MB
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-solana': ['@solana/web3.js', '@coral-xyz/anchor'],
          'vendor-spin': ['pinpet-sdk']
        }
      }
    }
  }
})
```

### 4. 开发环境 HMR 问题

如果热重载有问题：

```javascript
// vite.config.js
export default defineConfig({
  server: {
    hmr: {
      overlay: false // 关闭错误覆盖层
    }
  }
})
```

## 📦 生产构建优化

### 1. 代码分割

```javascript
// 动态导入 SDK
const loadSDK = async () => {
  const { PinPetSdk, getDefaultOptions } = await import('pinpet-sdk')
  return { PinPetSdk, getDefaultOptions }
}

// 在需要时加载
const { PinPetSdk, getDefaultOptions } = await loadSDK()
```

### 2. Tree Shaking

确保只导入需要的模块：

```javascript
// 好的做法
import { PinPetSdk } from 'pinpet-sdk'

// 避免全量导入
import * as SpinSDK from 'pinpet-sdk' // 这样会导入所有内容
```

### 3. 预加载优化

```html
<!-- index.html -->
<link rel="modulepreload" href="/node_modules/@solana/web3.js/lib/index.js">
<link rel="modulepreload" href="/node_modules/pinpet-sdk/dist/pinpet-sdk.esm.js">
```

## 🔧 调试技巧

### 1. 开发环境调试

```javascript
// 启用详细日志
const sdk = new PinPetSdk(connection, programId, {
  ...options,
  // 开发环境不设置 debugLogPath（浏览器环境不支持文件写入）
  debugLogPath: null
})
```

### 2. 网络问题调试

```javascript
// 使用代理或直接指定端点
const connection = new Connection(
  process.env.NODE_ENV === 'development' 
    ? '/api/solana' // 通过 Vite 代理
    : 'https://api.devnet.solana.com' // 生产环境直连
)
```

---

按照这个配置，你的 SpinPet SDK 应该能在 Vite 项目中顺利运行！