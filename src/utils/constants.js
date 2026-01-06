/**
 * SpinPet SDK default configuration constants
 */

// Default network configuration
const DEFAULT_NETWORKS = {
  MAINNET: {
    name: 'mainnet-beta',
    defaultDataSource: 'fast',
    solanaEndpoint: 'https://mainnet.helius-rpc.com/?api-key=7919f9f6-a6e8-4597-baf2-601f64ec9e5e',
    pinPetFastApiUrl: 'https://api.pinpet.fun/',
    feeRecipient: 'CmDe8JRAPJ7QpZNCb4ArVEyzyxYoCNL7WZw5qXLePULn',
    baseFeeRecipient: '2xhAfEfnH8wg7ZGujSijJi4Zt4ge1ZuwMypo7etntgXA',
    paramsAccount: 'CJSn3n4MVCg4qWQ7qb2nxzosYwfcRyBvmwhtM77ugu1V'
  },
  DEVNET: {
    name: 'devnet',
    defaultDataSource: 'fast',
    solanaEndpoint: 'https://devnet.helius-rpc.com/?api-key=666f279b-0b08-41cd-97f4-461811d7fc7a',
    pinPetFastApiUrl: 'https://devtestapi.pinpet.fun',
    feeRecipient: 'GesAj2dTn2wdNcxj4x8qsqS9aNRVPBPkE76aaqg7skxu',
    baseFeeRecipient: '5YHi1HsxobLiTD6NQfHJQpoPoRjMuNyXp4RroTvR6dKi',
    paramsAccount: '2KCtqW5zS3oje2rJBRVhVq2PoA8AYsai1u9b6jjMTpuq'
  },
  LOCALNET: {
    name: 'localnet',
    defaultDataSource: 'fast', // 'fast' or 'chain'
    solanaEndpoint: 'http://127.0.0.1:8899',
    pinPetFastApiUrl: 'http://127.0.0.1:3000',
    feeRecipient: 'GesAj2dTn2wdNcxj4x8qsqS9aNRVPBPkE76aaqg7skxu',
    baseFeeRecipient: '5YHi1HsxobLiTD6NQfHJQpoPoRjMuNyXp4RroTvR6dKi',
    paramsAccount: '2KCtqW5zS3oje2rJBRVhVq2PoA8AYsai1u9b6jjMTpuq'
  }
};



// Get default configuration
function getDefaultOptions(networkName = 'LOCALNET') {
  const networkConfig = DEFAULT_NETWORKS[networkName];
  
  return {
    ...networkConfig
  };
}

module.exports = {
  getDefaultOptions
};