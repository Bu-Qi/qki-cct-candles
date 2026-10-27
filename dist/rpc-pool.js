// All calls are read-only. Availability and timing are measured in the visitor's browser.
export const RPC_ENDPOINTS=Object.freeze([
 'https://116.62.144.117',
 'https://118.178.121.168',
 'https://101.132.39.198',
 'https://8.210.130.36',
 'https://139.224.206.117',
 'https://rpc1.qkirpc.org',
 'https://rpc2.qkirpc.org',
 'https://rpc3.qkirpc.org',
 'https://rpc1.qkiscan.io',
 'https://rpc2.qkiscan.io',
 'https://rpc3.qkiscan.io'
]);
const CHAIN_ID=20181205n;
const PROBE_CALL=[{to:'0x10985efd0765636fc9b40185e721e9bbc1275c3d',data:'0x0902f1ac'},'latest'];
const READ_METHODS=new Set(['eth_chainId','eth_blockNumber','eth_call']);
export function normalizeRpcURL(value){
 const url=new URL(String(value).trim());
 if(url.protocol!=='https:')throw Error('RPC 必须使用 HTTPS');
 if(url.username||url.password)throw Error('请勿在 RPC 地址中包含用户名或密码');
 url.hash='';return url.href.replace(/\/$/,'');
}
export function rankedNodes(reports,maxLag=5,referenceHead=0){
 const ready=reports.filter(r=>r.ok&&Number.isSafeInteger(r.blockNumber)&&Number.isFinite(r.latencyMs));
 if(!ready.length)return [];
 const head=Math.max(referenceHead,...ready.map(r=>r.blockNumber));
 return ready.filter(r=>head-r.blockNumber<=maxLag).sort((a,b)=>a.latencyMs-b.latencyMs);
}
class RpcResponseError extends Error{
 constructor(error){super(error.message||'RPC 返回错误');this.code=error.code;this.name='RpcResponseError'}
}
function isCallError(error){return error instanceof RpcResponseError&&(error.code===-32602||/revert|invalid opcode|invalid argument/i.test(error.message))}
function readableError(error){
 if(error?.name==='AbortError'||error?.name==='TimeoutError')return '请求超时';
 if(error instanceof TypeError&&/fetch|network|load failed/i.test(error.message))return '连接失败（网络、证书或跨域限制）';
 return error?.message||'连接失败';
}
export class RpcPool{
 constructor({urls=RPC_ENDPOINTS,fetchImpl=globalThis.fetch,now=()=>performance.now(),timeoutMs=3500,maxLag=5,ttlMs=120000,onUpdate=()=>{}}={}){
  this.urls=[...new Set(urls.map(normalizeRpcURL))];this.fetchImpl=fetchImpl;this.now=now;this.timeoutMs=timeoutMs;this.maxLag=maxLag;this.ttlMs=ttlMs;this.onUpdate=onUpdate;
  this.mode='auto';this.active=null;this.reports=this.urls.map(url=>({url,status:'idle',ok:false}));this.measuring=false;this.lastScan=0;this.failovers=0;this.referenceHead=0;this._generation=0;this._id=0;this._scanPromise=null;
 }
 snapshot(){
  const good=this.reports.filter(r=>r.ok),head=good.length?Math.max(this.referenceHead,...good.map(r=>r.blockNumber)):this.referenceHead;
  return {mode:this.mode,active:this.active?{...this.active}:null,measuring:this.measuring,lastScan:this.lastScan,failovers:this.failovers,
   reports:this.reports.map(r=>({...r,lag:r.ok?head-r.blockNumber:null,status:r.ok&&head-r.blockNumber>this.maxLag?'lagging':r.status,selected:r.url===this.active?.url}))};
 }
 _emit(){this.onUpdate(this.snapshot())}
 async _rpc(url,method,params){
  const id=++this._id,controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{
   const response=await this.fetchImpl(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params}),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok)throw Error(`HTTP ${response.status}`);
   const data=await response.json();
   if(!data||Array.isArray(data)||data.id!==id)throw Error('RPC 响应格式或请求编号不匹配');
   if(data.error)throw new RpcResponseError(data.error);
   if(typeof data.result!=='string'||!/^0x[0-9a-f]*$/i.test(data.result))throw Error('RPC 返回了无效数据');
   if((method==='eth_chainId'||method==='eth_blockNumber')&&data.result==='0x')throw Error('RPC 未返回链或区块信息');
   return data.result;
  }catch(error){if(controller.signal.aborted)throw Error(`请求超时（${this.timeoutMs} ms）`);throw error}
  finally{clearTimeout(timer)}
 }
 async _probe(url){
  const samples=[];
  const timed=async(method,params=[])=>{const begin=this.now(),value=await this._rpc(url,method,params);samples.push(Math.max(0,this.now()-begin));return value};
  try{
   const chain=await timed('eth_chainId');if(BigInt(chain)!==CHAIN_ID)throw Error(`链 ID 不匹配（${BigInt(chain)}）`);
   const block=Number(BigInt(await timed('eth_blockNumber')));if(!Number.isSafeInteger(block)||block<=0)throw Error('区块高度无效');
   const reserves=await timed('eth_call',PROBE_CALL);if(!/^0x[0-9a-f]{192}$/i.test(reserves))throw Error('无法正确读取 QKI 交易池');
   return {url,ok:true,status:'ready',blockNumber:block,latencyMs:Math.round(samples.reduce((s,n)=>s+n,0)/samples.length),checkedAt:Date.now()};
  }catch(error){return {url,ok:false,status:'error',error:readableError(error),checkedAt:Date.now()}}
 }
 _choose(){this.active=rankedNodes(this.reports,this.maxLag,this.referenceHead)[0]||null}
 useAutomatic(){
  if(this.mode==='auto'&&this._scanPromise)return this._scanPromise;
  const gen=++this._generation;this.mode='auto';this.active=null;this.measuring=true;this.reports=this.urls.map(url=>({url,status:'checking',ok:false}));this._emit();
  const work=(async()=>{
   await Promise.all(this.urls.map(async(url,index)=>{const report=await this._probe(url);if(gen!==this._generation)return;this.reports[index]=report;if(report.ok)this.referenceHead=Math.max(this.referenceHead,report.blockNumber);this._choose();this._emit()}));
   if(gen!==this._generation)return this.snapshot();
   this.measuring=false;this.lastScan=Date.now();this._choose();this._emit();
   if(!this.active)throw Error('提供的 RPC 暂无可用节点；可重新测速或设置自定义节点。');
   return this.snapshot();
  })();
  this._scanPromise=work;work.finally(()=>{if(this._scanPromise===work)this._scanPromise=null}).catch(()=>{});return work;
 }
 async useEndpoint(value){
  const url=normalizeRpcURL(value),gen=++this._generation;this.mode='fixed';this.active=null;this.measuring=true;this._scanPromise=null;
  this.reports=this.reports.map(r=>r.status==='checking'?{url:r.url,status:'idle',ok:false}:r);
  const old=this.reports.findIndex(r=>r.url===url),pending={url,status:'checking',ok:false};if(old<0)this.reports.push(pending);else this.reports[old]=pending;this._emit();
  const report=await this._probe(url);if(gen!==this._generation)return this.snapshot();
  this.reports[this.reports.findIndex(r=>r.url===url)]=report;if(report.ok)this.referenceHead=Math.max(this.referenceHead,report.blockNumber);this.active=report.ok?report:null;this.measuring=false;this.lastScan=Date.now();this._emit();
  if(!this.active)throw Error(report.error);return this.snapshot();
 }
 async request(method,params=[]){
  if(!READ_METHODS.has(method))throw Error('该连接仅支持只读 RPC 查询');
  if(this.mode==='auto'){
   if(this._scanPromise)await this._scanPromise;
   else if(!this.active||Date.now()-this.lastScan>this.ttlMs)await this.useAutomatic();
  }
  const gen=this._generation,candidates=this.mode==='fixed'?(this.active?[this.active]:[]):rankedNodes(this.reports,this.maxLag,this.referenceHead);
  if(!candidates.length)throw Error('当前没有可用的 QKI RPC，请重新测速或选择其他节点。');
  let lastError;
  for(const candidate of candidates){
   if(gen!==this._generation)return this.request(method,params);
   try{const result=await this._rpc(candidate.url,method,params);if(gen!==this._generation)return this.request(method,params);this.active=candidate;this._emit();return result}
   catch(error){
    if(gen!==this._generation)return this.request(method,params);
    if(isCallError(error))throw error;
    lastError=error;const report=this.reports.find(r=>r.url===candidate.url);if(report)Object.assign(report,{ok:false,status:'error',error:readableError(error)});
    if(this.mode==='auto'){this._choose();if(this.active)this.failovers++}else this.active=null;this._emit();
   }
  }
  throw Error('RPC 读取失败：'+readableError(lastError));
 }
}
