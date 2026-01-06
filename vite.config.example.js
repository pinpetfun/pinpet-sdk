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
      'decimal.js',
      'bs58',
      'axios'
    ],
    // 排除有问题的依赖，让 Vite 自动处理
    exclude: ['@solana/codecs']
  },
  
  // 构建配置
  build: {
    // 增加 chunk 大小限制（Solana 依赖比较大）
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // 手动分块，避免单个 chunk 过大
        manualChunks: {
          'solana-web3': ['@solana/web3.js'],
          'anchor': ['@coral-xyz/anchor'], 
          'pinpet-sdk': ['pinpet-sdk'],
          'utils': ['buffer', 'decimal.js', 'bs58']
        }
      }
    }
  },
  
  // 开发服务器配置
  server: {
    cors: true,
    // SpinPet API 代理配置
    proxy: {
      '/api/spin': {
        target: 'https://api.spin.pet',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spin/, '')
      },
      '/api/devnet': {
        target: 'https://devtestapi.spin.pet', 
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/devnet/, '')
      }
    }
  },
  
  // 解析配置
  resolve: {
    alias: {
      // 确保 polyfills 正确解析
      buffer: 'buffer',
      process: 'process/browser',
      stream: 'stream-browserify', 
      util: 'util',
      crypto: 'crypto-browserify'
    }
  },
  
  // 定义全局变量
  define: {
    global: 'globalThis',
    'process.env': process.env
  }
})