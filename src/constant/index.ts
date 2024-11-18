export const QUEUE = {
  TOKEN_MONITORING: {
    name: 'token-monitoring',
    processes: {
      INITIAL_MONITORING: 'initial-monitoring',
      POSITION_MONITORING: 'position-monitoring'
    }
  },
  TOKEN_ANALYTICS: {
    name: 'token-analytics',
    processes: {
    }
  },
  NOTIFICATIONS: {
    name: 'notifications',
    processes: {
    }
  }
}

export const COINGECKO_SOL_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd';