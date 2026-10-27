import {SWAP,parseSwap,candles,movingAverage,compatiblePeriod} from './market.js';
import {COMMON_TOKENS,QUOTES,findCommonToken,availableQuotes,commonMarket} from './common-tokens.js';
import {RPC_ENDPOINTS,RpcPool,normalizeRpcURL} from './rpc-pool.js';
const $=id=>document.getElementById(id),API='https://api1.qkiscan.io',CCT='0xe8377ecb0f32f0c16025d5cf360d6c9e2ea66adf',USDT='0xdf0e293cc3c7ba051763ff6b026da0853d446e38',FACTORY='0x4cb5b19e8316743519072170886355b0e2c717cf',DEFAULT_POOL='0x10985efd0765636fc9b40185e721e9bbc1275c3d';
const known=QUOTES;
let base={...findCommonToken(CCT)},quote={...known.USDT},pool=DEFAULT_POOL,baseIs0=false,raw=[],trades=[],bars=[],cursor=null,period=900,generation=0,busy=false,isSnapshot=false,lastSync=null,lineMode=false,maEnabled=new Set([5,10,20]);
let marketError=false;let visible=120,end=0,hover=null,drag=null,ma={};const chart=$('chart'),ctx=chart.getContext('2d');let W=0,H=0,plot={};
const rpcClient=new RpcPool({onUpdate:renderRpc});
const address=x=>/^0x[0-9a-f]{40}$/i.test(x),short=x=>x.slice(0,6)+'…'+x.slice(-4),key=x=>x.transaction_hash+':'+x.index;
const number=(x,d=2)=>Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
function price(x){if(!Number.isFinite(x))return '—';return x>=100?number(x,3):x>=1?x.toFixed(5):x>=.00001?x.toFixed(8):x.toExponential(4)}
function date(t,full=false){return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',...(full?{year:'numeric'}:{})}).format(new Date(t*1000))}
function time(t){return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(t*1000))}
function notice(s,error=false){$('notice').textContent=s;$('notice').classList.toggle('error',error)}
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',3500)}
async function json(url,opts={}){const r=await fetch(url,{...opts,signal:AbortSignal.timeout(18000)});if(!r.ok)throw Error(r.status===429?'接口请求频繁，请稍后刷新。':`数据接口返回 ${r.status}`);const d=await r.json();if(d.error)throw Error(d.error.message||String(d.error));return d}
async function call(to,data){const result=await rpcClient.request('eth_call',[{to,data},'latest']);if(!/^0x[0-9a-f]+$/i.test(result||''))throw Error('RPC 未返回有效合约数据');return result}
function renderRpc(state){
 const complete=state.reports.filter(r=>r.status!=='idle'&&r.status!=='checking').length,active=state.active;
 let message;
 if(state.measuring)message=state.mode==='fixed'?'正在验证所选节点，仅执行只读查询…':`正在测速 ${complete}/${RPC_ENDPOINTS.length}，仅测试只读接口…${active?' 当前最快 '+active.url+' · '+active.latencyMs+' ms':''}`;
 else if(active)message=`${state.mode==='auto'?'自动择优':'固定节点'} · ${active.url} · ${active.latencyMs} ms · 区块 ${active.blockNumber}${state.failovers?' · 已切换 '+state.failovers+' 次':''}`;
 else message=state.mode==='auto'?'这些 RPC 在当前浏览器暂不可用，可重新测速或设置自定义节点。K 线索引行情仍可加载。':'固定节点不可用，请更换节点或恢复自动择优。';
 $('rpc-status').textContent=message;$('rpc-status').classList.toggle('unavailable',!state.measuring&&!active);
 $('rpc-badge').textContent=state.measuring?(state.mode==='fixed'?'RPC 节点验证中':`RPC 测速 ${complete}/${RPC_ENDPOINTS.length}`):active?`RPC ${state.mode==='auto'?'自动':'固定'} · ${active.latencyMs} ms`:'RPC 暂不可用';
 for(const id of ['rpc-retest','rpc-choice','save-rpc'])$(id).disabled=state.measuring;
 if(state.mode==='auto')$('rpc-choice').value='auto';
 else if(active)$('rpc-choice').value=RPC_ENDPOINTS.includes(active.url)?active.url:'custom';
 const reports=state.measuring?state.reports:[...state.reports].sort((a,b)=>Number(b.selected)-Number(a.selected)||Number(b.ok)-Number(a.ok)||(a.latencyMs??Infinity)-(b.latencyMs??Infinity));
 const fragment=document.createDocumentFragment();
 for(const r of reports){
  const row=document.createElement('tr');if(r.selected)row.className='selected';
  const status=r.selected?'使用中'+(r.lag>5?` · 落后 ${r.lag} 块`:''):r.status==='checking'?'测速中…':r.status==='idle'?'未测速':r.status==='lagging'?`落后 ${r.lag} 块，已跳过`:r.ok?'可用':r.error||'不可用';
  for(const value of [r.url.replace(/^https:\/\//,''),r.ok?r.latencyMs+' ms':'—',r.ok?String(r.blockNumber):'—',status]){const cell=document.createElement('td');cell.textContent=value;row.append(cell)}
  row.lastChild.className=r.status==='lagging'?'rpc-lagging':r.ok?'rpc-ready':r.status==='error'?'rpc-error':'';fragment.append(row);
 }
 $('rpc-results').replaceChildren(fragment);
}
async function useAutoRpc(inform=false){
 try{localStorage.setItem('qki-chart-rpc-mode','auto')}catch{}
 try{const state=await rpcClient.useAutomatic();if(inform&&state.active)toast('已选择最快可用节点：'+state.active.url)}catch(error){if(inform)toast(error.message)}
}
async function useFixedRpc(value){
 try{const url=normalizeRpcURL(value);await rpcClient.useEndpoint(url);$('rpc').value=url;try{localStorage.setItem('qki-chart-rpc-mode','fixed');localStorage.setItem('qki-chart-rpc',url)}catch{}toast('节点已通过 QKI 链与合约读取验证')}
 catch(error){toast('节点未通过验证：'+error.message)}
}
function initRpc(){
 const custom=$('rpc-choice').querySelector('option[value="custom"]');
 for(const url of RPC_ENDPOINTS){const option=document.createElement('option');option.value=url;option.textContent=url;$('rpc-choice').insertBefore(option,custom)}
 let mode='auto',saved='';try{mode=localStorage.getItem('qki-chart-rpc-mode')||'auto';saved=localStorage.getItem('qki-chart-rpc')||''}catch{}
 $('rpc').value=saved;
 if(mode==='fixed'&&saved)rpcClient.useEndpoint(saved).catch(()=>{});else useAutoRpc();
}
async function tokenInfo(a){const preset=findCommonToken(a);if(preset)return {...preset};const t=await json(`${API}/api/v2/tokens/${a}`);if(t.decimals==null)throw Error('无法读取代币精度');return {address_hash:a.toLowerCase(),symbol:t.symbol||short(a),decimals:Number(t.decimals)}}
async function loadLogs(p,params){return json(`${API}/api/v2/addresses/${p}/logs?`+new URLSearchParams(params||{topic:SWAP}))}
function setBusy(b){busy=b;for(const id of ['search','more','refresh','quote'])$(id).disabled=b;document.querySelectorAll('[data-token-id]').forEach(button=>button.disabled=b);}
function initCommonTokens(){
 const fragment=document.createDocumentFragment();
 for(const token of COMMON_TOKENS){
  const button=document.createElement('button');button.className='token-chip';button.type='button';button.dataset.tokenId=token.id;button.style.setProperty('--token-color',token.color);button.setAttribute('aria-label',`查看 ${token.id} / ${token.defaultQuote} K 线`);button.setAttribute('aria-pressed','false');button.title=`${token.name}\n${token.address_hash}`;
  const icon=document.createElement('span');icon.className='token-mark';icon.textContent=token.id==='USDT'?'₮':token.id==='WQKI'?'Q':token.id.charAt(0);
  const label=document.createElement('span');label.className='token-chip-label';const name=document.createElement('strong');name.textContent=token.id;const pair=document.createElement('small');pair.textContent=`/ ${token.defaultQuote}`;label.append(name,pair);
  const arrow=document.createElement('span');arrow.className='token-arrow';arrow.textContent='↗';button.append(icon,label,arrow);
  button.onclick=()=>{if(busy)return;$('token').value=token.address_hash;$('quote').value=token.defaultQuote;$('manual-pool').value='';selectMarket()};fragment.append(button);
 }
 $('common-tokens').replaceChildren(fragment);
}
function saveCache(){try{localStorage.setItem('qki-chart:'+pool,JSON.stringify({items:raw.slice(0,6000),next:cursor,fetchedAt:Date.now()/1000}))}catch{}}
function compact(x){return {data:x.data,block_timestamp:x.block_timestamp,block_number:x.block_number,transaction_hash:x.transaction_hash,index:x.index}}
function merge(items){const all=new Map(raw.map(x=>[key(x),x]));for(const x of items)if(x.topics?.[0]===SWAP||(!x.topics&&x.data?.length===258))all.set(key(x),compact(x));raw=[...all.values()].sort((a,b)=>b.block_number-a.block_number||b.index-a.index)}
function updateHeader(){
 $('pair-name').replaceChildren(document.createTextNode(base.symbol+' '));const sp=document.createElement('span');sp.textContent='/ '+quote.symbol;$('pair-name').append(sp);$('coin-icon').textContent=base.symbol.slice(0,1);$('pool-link').href=`https://scan.qki.dev/address/${pool}`;$('pool-link').textContent='流动池 '+short(pool)+' ↗';$('price-unit').textContent=quote.symbol;$('volume-unit').textContent=quote.symbol;$('trade-unit').textContent='价格 / '+quote.symbol;$('trade-amount').textContent='数量 / '+base.symbol;
 for(const button of document.querySelectorAll('[data-token-id]')){const token=COMMON_TOKENS.find(t=>t.id===button.dataset.tokenId),active=token.address_hash===base.address_hash;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))}
 for(const option of $('quote').options)option.disabled=!availableQuotes(base.address_hash).includes(option.value);
}
function render(reset=false){
 trades=raw.map(x=>parseSwap(x,base,quote,baseIs0)).filter(Boolean).sort((a,b)=>b.time-a.time||b.block-a.block||b.index-a.index);
 updateHeader();
 if(trades.length){const next=compatiblePeriod(trades.at(-1).time,trades[0].time,period);if(next!==period){period=next;for(const button of $('periods').children)button.classList.toggle('selected',Number(button.dataset.sec)===period);toast('该代币历史跨度较长，已自动使用更大的 K 线周期')}}
 try{bars=candles(trades,period)}catch(e){notice(e.message,true);bars=[]}
 ma=Object.fromEntries([5,10,20].map(n=>[n,movingAverage(bars,n)]));
 if(reset){visible=Math.min(120,Math.max(20,bars.length));end=bars.length} else end=Math.min(bars.length,Math.max(1,end));
 if(trades.length){const latest=trades[0],old=trades.at(-1),delta=(latest.price/old.price-1)*100;
  $('price').textContent=price(latest.price);$('change').textContent=(delta>=0?'+':'')+delta.toFixed(2)+'% 范围内';$('change').className=delta>=0?'up':'down';$('high').textContent=price(Math.max(...trades.map(t=>t.price)));$('low').textContent=price(Math.min(...trades.map(t=>t.price)));$('volume').textContent=number(trades.reduce((s,t)=>s+t.value,0),2);$('count').textContent=number(trades.length,0)+' 笔';$('coverage').textContent=date(old.time,true)+' — '+date(latest.time,true);$('coverage-note').textContent=`仅统计当前池内已加载成交；最早一根 K 线可能不完整。最新成交 ${date(latest.time)}。`;
 }else{for(const id of ['price','change','high','low','volume','count'])$(id).textContent='—';$('coverage').textContent='尚无可解析成交';$('coverage-note').textContent='请检查代币、计价币与流动池，或加载更早成交。'}
 const frag=document.createDocumentFragment();for(const t of trades.slice(0,40)){const a=document.createElement('a');a.className='trade';a.href=`https://scan.qki.dev/tx/${t.hash}`;a.target='_blank';a.rel='noopener';a.title=(t.buy?'买入':'卖出')+' · '+date(t.time,true)+' · '+t.hash;for(const [v,c] of [[time(t.time),'time'],[price(t.price),t.buy?'up':'down'],[number(t.amount,2),'']]){const s=document.createElement('span');s.textContent=v;s.className=c;a.append(s)}frag.append(a)}$('trades').replaceChildren(frag);if(!trades.length)$('trades').textContent='此范围没有可显示成交';
 $('empty-chart').style.display=bars.length?'none':'flex';$('source-status').textContent=isSnapshot?'缓存快照 · 正在尝试更新':lastSync?'索引数据 · 更新于 '+time(lastSync):'等待连接';$('more').disabled=busy||!cursor;legend();draw();
}
async function refresh(quiet=false){
 if(busy||(quiet&&marketError))return;const gen=generation,p=pool;setBusy(true);if(!quiet)notice('正在读取最新链上成交…');
 try{const existing=new Set(raw.map(key));let fetched=[],next=null,overlap=!raw.length;
  for(let i=0;i<8;i++){const page=await loadLogs(p,next);if(gen!==generation)return;fetched.push(...page.items);next=page.next_page_params;if(!raw.length||page.items.some(x=>existing.has(key(x)))){overlap=true;break}if(!next)break}
  const wasEmpty=!raw.length;if(!overlap){raw=[];cursor=next;notice('数据间隔较大，已切换为连续的最新成交范围；可继续加载更早成交。')}else if(wasEmpty)cursor=next;
  const atRight=end>=bars.length;merge(fetched);isSnapshot=false;lastSync=Date.now()/1000;render(wasEmpty||atRight);saveCache();if(overlap)notice(`已连接 · ${number(trades.length,0)} 笔实际成交 · 每 30 秒尝试更新 · 统计范围见下方。`);
 }catch(e){if(gen!==generation)return;notice((raw.length?'更新失败，保留已加载数据。':'连接失败，未显示模拟数据。')+' '+e.message,true);render();}
 finally{if(gen===generation){setBusy(false);$('more').disabled=!cursor}}
}
async function loadMore(){if(busy||!cursor)return;const gen=generation;setBusy(true);notice('正在加载更早的链上成交…');try{let added=0;for(let i=0;i<4&&cursor;i++){const d=await loadLogs(pool,cursor);if(gen!==generation)return;merge(d.items);cursor=d.next_page_params;added+=d.items.length;render(true)}saveCache();notice(`已加载 ${number(trades.length,0)} 笔成交。${cursor?'可继续向前加载。':'已到达该池可用历史起点。'}`)}catch(e){notice('历史加载中断，已保留成功获取的成交。'+e.message,true)}finally{if(gen===generation){setBusy(false);$('more').disabled=!cursor}}}
async function selectMarket(){if(busy)return;const a=$('token').value.trim().toLowerCase(),q=$('quote').value,manual=$('manual-pool').value.trim().toLowerCase();if(!address(a)){notice('请输入有效的 0x 开头、40 位十六进制代币合约地址。',true);return}if(manual&&!address(manual)){notice('手动流动池地址格式不正确。',true);return}
 marketError=false;setBusy(true);notice('正在查找交易对并核对代币信息…');const gen=++generation;
 try{let b,qt,p;const preset=manual?null:commonMarket(a,q);
  if(preset){b=preset.token;qt=preset.quote;p=preset.pool;$('quote').value=preset.quoteId;if(preset.usedFallback)toast(`${b.symbol} 暂无 ${q} 直接池，已使用 ${preset.quoteId} 计价`)}
  else{b=await tokenInfo(a);qt={...known[q]};
   if(a===qt.address_hash)throw Error('代币与计价币不能相同');p=manual||('0x'+(await call(FACTORY,'0xe6a43905'+a.slice(2).padStart(64,'0')+qt.address_hash.slice(2).padStart(64,'0'))).slice(-40).toLowerCase());if(/^0x0{40}$/.test(p))throw Error(`未找到 ${b.symbol}/${qt.symbol} 的直接交易池，请更换计价币。`);
   const [t0,t1]=await Promise.all([call(p,'0x0dfe1681'),call(p,'0xd21220a7')]);const pairTokens=[t0,t1].map(t=>'0x'+t.slice(-40).toLowerCase());if(!pairTokens.includes(a)||!pairTokens.includes(qt.address_hash))throw Error('该流动池的两个代币与所选合约、计价币不匹配');
  }
  if(gen!==generation)return;base=b;quote=qt;pool=p;baseIs0=BigInt(a)<BigInt(qt.address_hash);raw=[];trades=[];bars=[];cursor=null;lastSync=null;end=0;isSnapshot=false;
  try{const c=JSON.parse(localStorage.getItem('qki-chart:'+pool));if(c?.items?.length){raw=c.items;cursor=c.next;isSnapshot=true}}catch{}
  if(!raw.length&&pool===DEFAULT_POOL){try{const seed=await json('./seed.json');if(gen!==generation)return;raw=seed.items;cursor=seed.next;isSnapshot=true}catch{}}
  render(true);setBusy(false);await refresh();
 }catch(e){if(gen===generation){marketError=true;notice('无法打开该交易对：'+e.message+'；可在下方连接设置中更换 RPC 或指定流动池。',true);setBusy(false)}}
}
function legend(index=bars.length-1){const c=bars[index];const p=$('periods').querySelector('.selected')?.textContent||'';$('chart-label').textContent=`${base.symbol} / ${quote.symbol} · ${p}`;
 $('ohlc').textContent=c?`开 ${price(c.open)}  高 ${price(c.high)}  低 ${price(c.low)}  收 ${price(c.close)}${c.count===0?' · 无成交':''}`:'等待成交数据';for(const n of [5,10,20])$('ma'+n).textContent=ma[n]?.[index]!=null?price(ma[n][index]):'—';}
function draw(){
 const box=$('canvas-wrap').getBoundingClientRect();W=box.width;H=box.height;const dpr=window.devicePixelRatio||1;chart.width=Math.round(W*dpr);chart.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);if(!bars.length)return;
 const n=Math.max(10,Math.min(visible,bars.length)),e=Math.max(1,Math.min(end||bars.length,bars.length)),s=Math.max(0,e-n),arr=bars.slice(s,e);if(!arr.length)return;
 const left=12,right=W<500?78:88,top=20,bottom=H-30,volTop=H*.79,priceBottom=H*.71,width=W-left-right,step=width/arr.length;
 let lo=Math.min(...arr.map(c=>c.low)),hi=Math.max(...arr.map(c=>c.high));for(const n of maEnabled)for(let i=s;i<e;i++)if(ma[n][i]!=null){lo=Math.min(lo,ma[n][i]);hi=Math.max(hi,ma[n][i])}const pad=(hi-lo||hi*.02)*.12;hi+=pad;lo=Math.max(0,lo-pad);if(hi===lo)hi=lo+1;
 const y=p=>top+(hi-p)/(hi-lo)*(priceBottom-top),x=i=>left+(i-s+.5)*step;plot={left,right,width,step,s,e,arr,top,priceBottom,volTop,bottom,hi,lo,y,x};
 ctx.lineWidth=1;ctx.font='10px ui-monospace,Consolas,monospace';ctx.textBaseline='middle';ctx.strokeStyle='#20303c';ctx.fillStyle='#6b8295';
 for(let i=0;i<=4;i++){const yy=top+(priceBottom-top)*i/4;ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(W-right,yy);ctx.stroke();ctx.fillText(price(hi-(hi-lo)*i/4),W-right+9,yy)}
 const ticks=Math.min(W<500?3:5,arr.length);for(let i=0;i<ticks;i++){const ix=s+Math.round(i*(arr.length-1)/Math.max(1,ticks-1)),xx=x(ix);ctx.strokeStyle='#182733';ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();ctx.fillStyle='#6b8295';ctx.textAlign=i===0?'left':i===ticks-1?'right':'center';ctx.fillText(date(bars[ix].time),xx,H-12)}ctx.textAlign='left';
 ctx.save();ctx.beginPath();ctx.rect(left,top,width,priceBottom-top+2);ctx.clip();
 if(lineMode){ctx.strokeStyle='#52e4ac';ctx.lineWidth=1.5;ctx.beginPath();arr.forEach((c,i)=>i?ctx.lineTo(x(s+i),y(c.close)):ctx.moveTo(x(s+i),y(c.close)));ctx.stroke()}else{arr.forEach((c,i)=>{const xx=x(s+i),color=c.close>=c.open?'#52d9a5':'#ec7185';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(xx,y(c.high));ctx.lineTo(xx,y(c.low));ctx.stroke();ctx.fillRect(xx-Math.max(1,step*.6)/2,Math.min(y(c.open),y(c.close)),Math.max(1,Math.min(14,step*.6)),Math.max(1,Math.abs(y(c.open)-y(c.close))))})}
 for(const n of maEnabled){ctx.strokeStyle={5:'#d9b769',10:'#76a9f2',20:'#be95e7'}[n];ctx.lineWidth=1;ctx.beginPath();let started=false;for(let i=s;i<e;i++)if(ma[n][i]!=null){if(started)ctx.lineTo(x(i),y(ma[n][i]));else{ctx.moveTo(x(i),y(ma[n][i]));started=true}}ctx.stroke()}
 ctx.restore();
 const vmax=Math.max(...arr.map(c=>c.volume),1);ctx.fillStyle='#6b8295';ctx.fillText('VOL  '+base.symbol,left,volTop-12);arr.forEach((c,i)=>{const h=c.volume/vmax*(bottom-volTop);ctx.fillStyle=c.close>=c.open?'#28584c':'#613541';ctx.fillRect(x(s+i)-Math.max(1,step*.6)/2,bottom-h,Math.max(1,Math.min(14,step*.6)),h)});
 const last=arr.at(-1),yy=y(last.close);ctx.strokeStyle=last.close>=last.open?'#52d9a565':'#ec718565';ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(W-right,yy);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=last.close>=last.open?'#244d40':'#5e303e';ctx.fillRect(W-right,yy-10,right-3,20);ctx.fillStyle='#e9f5f0';ctx.fillText(price(last.close),W-right+6,yy);
 if(hover&&hover.x>=left&&hover.x<W-right&&hover.y>top&&hover.y<bottom){const ix=Math.max(s,Math.min(e-1,s+Math.floor((hover.x-left)/step))),xx=x(ix);ctx.strokeStyle='#7891a288';ctx.setLineDash([3,4]);ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.moveTo(left,hover.y);ctx.lineTo(W-right,hover.y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#263b4c';const tw=Math.min(150,W-20),tx=Math.max(5,Math.min(W-tw-5,xx-tw/2));ctx.fillRect(tx,H-24,tw,23);ctx.fillStyle='#d3e1eb';ctx.textAlign='center';ctx.fillText(date(bars[ix].time),tx+tw/2,H-12);ctx.textAlign='left';legend(ix)}else legend(e-1);
}
$('search').onclick=selectMarket;$('token').addEventListener('keydown',e=>{if(e.key==='Enter')selectMarket()});$('refresh').onclick=()=>refresh();$('more').onclick=loadMore;
$('quote').addEventListener('change',()=>{if(!busy)selectMarket()});
$('periods').onclick=e=>{const b=e.target.closest('[data-sec]');if(!b)return;period=Number(b.dataset.sec);for(const x of $('periods').children)x.classList.toggle('selected',x===b);render(true)};
document.querySelectorAll('[data-ma]').forEach(b=>b.onclick=()=>{const n=Number(b.dataset.ma);maEnabled.has(n)?maEnabled.delete(n):maEnabled.add(n);b.classList.toggle('ma-on',maEnabled.has(n));draw()});
$('chart-type').onclick=()=>{lineMode=!lineMode;$('chart-type').textContent=lineMode?'K线':'折线';draw()};$('reset').onclick=()=>{visible=Math.max(20,bars.length);end=bars.length;hover=null;draw()};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('chart-panel').requestFullscreen()}catch{toast('当前浏览器不支持全屏，可使用浏览器缩放。')}};
$('save-rpc').onclick=()=>useFixedRpc($('rpc').value);
$('qq-join').addEventListener('click',()=>toast('若未打开 QQ，请复制群号 718614283，在 QQ 中搜索「夸克新手村」加群。'));
$('qq-copy').onclick=async()=>{try{await navigator.clipboard.writeText('718614283');toast('群号 718614283 已复制，可在 QQ 中搜索加群。')}catch{toast('复制未成功，请选中群号 718614283 手动复制。')}};
$('rpc-retest').onclick=()=>useAutoRpc(true);
$('rpc-choice').onchange=()=>{const choice=$('rpc-choice').value;if(choice==='auto')useAutoRpc(true);else if(choice==='custom')$('rpc').focus();else useFixedRpc(choice)};
$('export').onclick=()=>{if(!bars.length){toast('请先加载成交数据');return}const header='time_utc,time_utc8,open,high,low,close,volume_'+base.symbol+',turnover_'+quote.symbol+',swap_count';const csv='\uFEFF'+header+'\r\n'+bars.map(c=>[new Date(c.time*1000).toISOString(),date(c.time,true),c.open,c.high,c.low,c.close,c.volume,c.value,c.count].join(',')).join('\r\n');const u=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download=`${base.symbol}-${quote.symbol}-${period}s.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);toast('已导出当前加载范围的 K 线')};
chart.addEventListener('wheel',e=>{e.preventDefault();visible=Math.max(10,Math.min(bars.length||10,Math.round(visible*(e.deltaY>0?1.18:.84))));draw()},{passive:false});
chart.addEventListener('pointerdown',e=>{chart.setPointerCapture(e.pointerId);drag={x:e.offsetX,end};hover=null});chart.addEventListener('pointermove',e=>{if(drag){end=Math.max(Math.min(visible,bars.length),Math.min(bars.length,drag.end-Math.round((e.offsetX-drag.x)/(plot.step||1))));hover=null}else hover={x:e.offsetX,y:e.offsetY};draw()});chart.addEventListener('pointerup',()=>drag=null);chart.addEventListener('pointercancel',()=>drag=null);chart.addEventListener('pointerleave',()=>{if(!drag){hover=null;draw()}});
new ResizeObserver(()=>draw()).observe($('canvas-wrap'));document.addEventListener('fullscreenchange',()=>requestAnimationFrame(draw));
function clock(){$('clock').textContent=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date())}clock();setInterval(clock,1000);setInterval(()=>{if(!document.hidden)refresh(true)},30000);
initCommonTokens();initRpc();await selectMarket();
