// Qkswap V2 pairs and token precision verified on-chain, 2026-10-28 (UTC+8).
// Prices are always read from actual Swap events; these entries contain no price data.
export const COMMON_TOKENS = [
  {
    "id": "CCT2",
    "symbol": "CCT2",
    "nativeSymbol": "CCT",
    "name": "Chain Chat Token",
    "address_hash": "0xe8377ecb0f32f0c16025d5cf360d6c9e2ea66adf",
    "decimals": 8,
    "color": "#52e4ac",
    "defaultQuote": "USDT",
    "pools": {
      "USDT": "0x10985efd0765636fc9b40185e721e9bbc1275c3d",
      "QKI": "0x670b2d0fc710a5c1fc9c00c3cede4bdc5ae22119"
    }
  },
  {
    "id": "GAS",
    "symbol": "GAS",
    "nativeSymbol": "GAS",
    "name": "GAS",
    "address_hash": "0x25b8405c47c41b7af5a204ec4486a46de99a6f31",
    "decimals": 18,
    "color": "#eda96b",
    "defaultQuote": "QKI",
    "pools": {
      "USDT": null,
      "QKI": "0xfc7dd16c8442e7d0ba8f1b9e7359c2335d31c7d3"
    }
  },
  {
    "id": "WQKI",
    "symbol": "WQKI",
    "nativeSymbol": "WQKI",
    "name": "QKI 封装币",
    "address_hash": "0x835f6df988b6f51c9477d49e96adbbc644ba97a2",
    "decimals": 18,
    "color": "#77b9f5",
    "defaultQuote": "USDT",
    "pools": {
      "USDT": "0x482284801bc4f44eb0912fbb4f6dff8815322145"
    }
  }
];
const byAddress=new Map(COMMON_TOKENS.map(t=>[t.address_hash,t]));
const tokenById=id=>COMMON_TOKENS.find(t=>t.id===id);
const wqki=tokenById('WQKI');
export const QUOTES={
 USDT:{address_hash:'0xdf0e293cc3c7ba051763ff6b026da0853d446e38',symbol:'USDT',decimals:6},
 QKI:{address_hash:wqki.address_hash,symbol:'QKI',decimals:wqki.decimals}
};
export function findCommonToken(address){return byAddress.get(String(address).toLowerCase())||null}
export function availableQuotes(address){const token=findCommonToken(address);return token?Object.keys(QUOTES).filter(q=>token.pools[q]):Object.keys(QUOTES)}
export function commonMarket(address,requestedQuote){
 const token=findCommonToken(address);if(!token)return null;
 const quoteId=token.pools[requestedQuote]?requestedQuote:token.defaultQuote;
 const pool=token.pools[quoteId];if(!pool)throw Error('此代币暂无可用的直接交易池');
 const quote=QUOTES[quoteId];
 if(token.address_hash===quote.address_hash)throw Error('代币与计价币不能相同');
 return {token:{...token},quote:{...quote},pool,quoteId,usedFallback:quoteId!==requestedQuote,baseIs0:BigInt(token.address_hash)<BigInt(quote.address_hash)};
}
