/**
 * SpinPet SDK default configuration constants
 */

// Default network configuration
const DEFAULT_NETWORKS = {
  MAINNET: {
    name: 'mainnet-beta',
    defaultDataSource: 'chain',
    solanaEndpoint: 'https://mainnet.helius-rpc.com/?api-key=666f279b-0b08-41cd-97f4-461811d7fc7a',
    spin_fast_api_url: 'https://api.spin.pet',
    fee_recipient: '4nffmKaNrex34LkJ99RLxMt2BbgXeopUi8kJnom3YWbv',
    base_fee_recipient: '8fJpd2nteqkTEnXf4tG6d1MnP9p71KMCV4puc9vaq6kv',
    params_account: 'DVRnPDW1MvUhRhDfE1kU6aGHoQoufBCmQNbqUH4WFgUd'
  },
  DEVNET: {
    name: 'devnet',
    defaultDataSource: 'chain',
    solanaEndpoint: 'https://devnet.helius-rpc.com/?api-key=666f279b-0b08-41cd-97f4-461811d7fc7a',
    spin_fast_api_url: 'https://devtestapi.spin.pet',
    fee_recipient: 'GesAj2dTn2wdNcxj4x8qsqS9aNRVPBPkE76aaqg7skxu',
    base_fee_recipient: '5YHi1HsxobLiTD6NQfHJQpoPoRjMuNyXp4RroTvR6dKi',
    params_account: '8VWPLdFVW3Vi2U6uo3ypjRL5mCcYWXKgD4Saj2MEEeHc'
  },
  LOCALNET: {
    name: 'localnet',
    defaultDataSource: 'chain', // 'fast' or 'chain'
    solanaEndpoint: 'http://192.168.18.5:8899',
    spin_fast_api_url: 'http://192.168.18.5:8080',
    fee_recipient: 'GesAj2dTn2wdNcxj4x8qsqS9aNRVPBPkE76aaqg7skxu',
    base_fee_recipient: '5YHi1HsxobLiTD6NQfHJQpoPoRjMuNyXp4RroTvR6dKi',
    params_account: '8VWPLdFVW3Vi2U6uo3ypjRL5mCcYWXKgD4Saj2MEEeHc'
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