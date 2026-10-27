import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSwap,candles,movingAverage} from '../dist/market.js';
const pack=a=>'0x'+a.map(v=>BigInt(v).toString(16).padStart(64,'0')).join('');
const base={decimals:8},quote={decimals:6};
const log=(a,when='2026-10-24T07:51:27Z',index=0)=>({data:pack(a),block_timestamp:when,block_number:10,transaction_hash:'0xabc',index});
const sell=parseSwap(log([0,2500000000000,317214230,0]),base,quote,false);
assert.equal(sell.buy,false);assert.equal(sell.amount,25000);assert.equal(sell.value,317.21423);assert.equal(sell.price,317.21423/25000);
const buy=parseSwap(log([36006245,0,0,296800403150]),base,quote,false);assert.equal(buy.buy,true);assert.equal(buy.amount,2968.0040315);assert.equal(buy.value,36.006245);
assert.equal(parseSwap(log([1,1,1,1]),base,quote,false),null);
const inverted=parseSwap(log([296800403150,0,0,36006245]),base,quote,true);assert.equal(inverted.price,buy.price);assert.equal(inverted.buy,false);
const trades=[{time:0,price:2,amount:10,value:20,block:1,index:0},{time:30,price:4,amount:1,value:4,block:1,index:1},{time:180,price:3,amount:2,value:6,block:2,index:0}];
const cs=candles(trades,60);assert.equal(cs.length,4);assert.deepEqual([cs[0].open,cs[0].high,cs[0].low,cs[0].close,cs[0].volume,cs[0].value],[2,4,2,4,11,24]);assert.equal(cs[1].count,0);assert.equal(cs[1].close,4);assert.equal(cs[1].volume,0);assert.equal(cs[3].close,3);
const daily=candles([{...trades[0],time:Date.parse('2026-10-24T15:59:59Z')/1000},{...trades[1],time:Date.parse('2026-10-24T16:00:00Z')/1000}],86400);assert.equal(daily.length,2);assert.equal(new Date(daily[1].time*1000).toISOString(),'2026-10-24T16:00:00.000Z');
assert.deepEqual(movingAverage([{close:2},{close:4},{close:6}],2),[null,3,5]);
const seed=JSON.parse(readFileSync(new URL('../dist/seed.json',import.meta.url)));const actual=seed.items.map(x=>parseSwap(x,base,quote,false)).filter(Boolean);assert.equal(actual.length,seed.items.length);assert.ok(actual.every(t=>t.price>.001&&t.price<.1));const cb=candles(actual,900);assert.equal(cb.reduce((s,c)=>s+c.count,0),actual.length);assert.ok(Math.abs(cb.reduce((s,c)=>s+c.volume,0)-actual.reduce((s,t)=>s+t.amount,0))<.00001);console.log('PASS: swap directions and decimals; OHLC and volume; zero-volume gaps; UTC+8 daily boundary; MA; real-data conservation ('+actual.length+' swaps).');

// Known pairs must preserve pricing and direction across 6-, 8- and 18-decimal tokens.
const {COMMON_TOKENS,QUOTES,findCommonToken,availableQuotes,commonMarket}=await import('../dist/common-tokens.js');
const {compatiblePeriod}=await import('../dist/market.js');
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/common-swaps.json',import.meta.url)));
assert.equal(fixtures.length,3);
for(const f of fixtures){const token=COMMON_TOKENS.find(t=>t.id===f.tokenId),market=commonMarket(token.address_hash,f.quote);assert.equal(market.pool,f.pool);assert.equal(market.usedFallback,false);const trade=parseSwap(f.log,market.token,market.quote,market.baseIs0);assert.ok(trade,f.tokenId+' must produce a candle');assert.equal(trade.buy,f.expected.buy);for(const field of ['amount','value','price'])assert.ok(Math.abs(trade[field]-Number(f.expected[field]))/Number(f.expected[field])<1e-12,`${f.tokenId}: ${field} has wrong units`);}
const w=COMMON_TOKENS.find(t=>t.id==='WQKI'),u=QUOTES.USDT;
const swap=fixtures.find(f=>f.tokenId==='WQKI').log;const direct=parseSwap(swap,w,QUOTES.USDT,true),inverse=parseSwap(swap,u,QUOTES.QKI,false);assert.ok(Math.abs(direct.price*inverse.price-1)<1e-12);assert.equal(direct.buy,!inverse.buy);assert.equal(direct.amount,inverse.value);
const gas=COMMON_TOKENS.find(t=>t.id==='GAS');assert.deepEqual(availableQuotes(gas.address_hash),['QKI']);assert.equal(commonMarket(gas.address_hash,'USDT').quoteId,'QKI');assert.equal(commonMarket(gas.address_hash,'USDT').usedFallback,true);
assert.equal(commonMarket(w.address_hash,'QKI').quoteId,'USDT');
assert.equal(findCommonToken('0xE8377eCb0F32f0C16025d5cF360D6C9e2EA66Adf').symbol,'CCT2');assert.equal(commonMarket('0x1111111111111111111111111111111111111111','USDT'),null);
const yearAgo=Date.parse('2025-11-05T02:17:57Z')/1000,latest=Date.parse('2026-10-21T19:23:52Z')/1000;assert.equal(compatiblePeriod(yearAgo,latest,900),86400);assert.equal(compatiblePeriod(0,24*3600,900),900);
assert.doesNotThrow(()=>candles([{time:yearAgo,price:1,amount:1,value:1,block:1,index:0},{time:latest,price:2,amount:1,value:2,block:2,index:0}],compatiblePeriod(yearAgo,latest,900)));
console.log('PASS: three real token/pair fixtures; inverse WQKI/USDT prices; unsupported/self quote fallback; CCT2 address resolution; sparse history period selection.');
