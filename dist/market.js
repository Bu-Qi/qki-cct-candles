export const SWAP='0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
export function compatiblePeriod(firstTime,lastTime,requested){
 const span=Math.max(0,lastTime-firstTime);
 if(span/requested<=29998)return requested;
 return [60,300,900,3600,14400,86400].find(p=>span/p<=1200)||86400;
}
export function parseSwap(log,base,quote,baseIs0){
 if(!/^0x[0-9a-f]{256}$/i.test(log.data||''))return null;
 const raw=log.data.slice(2).match(/.{64}/g).map(x=>BigInt('0x'+x));
 const bi=baseIs0?0:1,qi=1-bi;
 // Only ordinary two-sided swaps. Flash swaps with both inputs are excluded.
 const buy=raw[bi]===0n&&raw[bi+2]>0n&&raw[qi]>0n&&raw[qi+2]===0n;
 const sell=raw[bi]>0n&&raw[bi+2]===0n&&raw[qi]===0n&&raw[qi+2]>0n;
 if(!buy&&!sell)return null;
 const amount=Number(buy?raw[bi+2]:raw[bi])/10**Number(base.decimals);
 const value=Number(buy?raw[qi]:raw[qi+2])/10**Number(quote.decimals);
 const time=Date.parse(log.block_timestamp)/1000;
 if(!Number.isFinite(time)||!Number.isFinite(amount)||!Number.isFinite(value)||amount<=0||value<=0)return null;
 return {time,amount,value,price:value/amount,buy,hash:log.transaction_hash,index:log.index,block:log.block_number};
}
export function candles(trades,period){
 if(!trades.length)return [];
 const groups=new Map();
 for(const t of [...trades].sort((a,b)=>a.time-b.time||a.block-b.block||a.index-b.index)){
  const time=Math.floor((t.time+28800)/period)*period-28800;
  let c=groups.get(time);if(!c){c={time,open:t.price,high:t.price,low:t.price,close:t.price,volume:0,value:0,count:0};groups.set(time,c)}
  c.high=Math.max(c.high,t.price);c.low=Math.min(c.low,t.price);c.close=t.price;c.volume+=t.amount;c.value+=t.value;c.count++;
 }
 const actual=[...groups.values()],result=[];let prev=null;
 // Avoid runaway allocations on extremely sparse, multi-year markets.
 if((actual.at(-1).time-actual[0].time)/period>30000)throw Error('该范围跨度太长，请切换到更大的 K 线周期。');
 for(const c of actual){if(prev)for(let t=prev.time+period;t<c.time;t+=period)result.push({time:t,open:prev.close,high:prev.close,low:prev.close,close:prev.close,volume:0,value:0,count:0});result.push(c);prev=c;}
 return result;
}
export function movingAverage(data,n){let sum=0;return data.map((c,i)=>{sum+=c.close;if(i>=n)sum-=data[i-n].close;return i>=n-1?sum/n:null})}
