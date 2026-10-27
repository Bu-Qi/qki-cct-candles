import test from 'node:test';
import assert from 'node:assert/strict';
import {RpcPool,RPC_ENDPOINTS,rankedNodes,normalizeRpcURL} from '../dist/rpc-pool.js';
const CHAIN='0x'+(20181205).toString(16),RESERVES='0x'+['1','2','3'].map(x=>x.padStart(64,'0')).join('');
function fixture(specs){
 let tick=0;const calls=[];
 const fetchImpl=async(url,options)=>{
  const body=JSON.parse(options.body),s=specs[url];calls.push({url,...body});if(!s)throw Error('Unexpected URL '+url);
  if(s.delay)await new Promise(resolve=>setTimeout(resolve,s.delay));
  tick+=s.ms||1;
  if(s.offline)throw TypeError('Failed to fetch');
  if(s.badHttp)return {ok:false,status:503};
  let result=body.method==='eth_chainId'?(s.chain||CHAIN):body.method==='eth_blockNumber'?'0x'+(s.block||1000).toString(16):body.params[0].data==='0x0902f1ac'?RESERVES:'0x1234';
  if(body.method==='eth_call'&&body.params[0].data!=='0x0902f1ac'){
   if(s.hang)return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true})});
   if(s.failRead)throw TypeError('Failed to fetch');
   if(s.revert)return {ok:true,json:async()=>({id:body.id,error:{code:3,message:'execution reverted: no pair'}})};
  }
  if(s.empty&&body.method==='eth_call')result='0x';
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:s.wrongId?body.id+1:body.id,result})};
 };
 return {pool:new RpcPool({urls:Object.keys(specs),fetchImpl,now:()=>tick,timeoutMs:15}),calls};
}
test('configured pool contains exactly the eleven supplied HTTPS endpoints',()=>{
 assert.equal(RPC_ENDPOINTS.length,11);assert.equal(new Set(RPC_ENDPOINTS).size,11);
 assert.equal(normalizeRpcURL(' https://rpc1.qkirpc.org/ '),'https://rpc1.qkirpc.org');
 assert.throws(()=>normalizeRpcURL('http://rpc1.qkirpc.org'),/HTTPS/);
 assert.throws(()=>normalizeRpcURL('https://user:password@example.test'),/用户名或密码/);
});
test('selection excludes wrong chains, malformed/HTTP responses and stale fast nodes',async()=>{
 const x=fixture({'https://fast.test':{ms:2,block:990},'https://current.test':{ms:6,block:1000},'https://wrong.test':{chain:'0x38'},'https://empty.test':{empty:true},'https://bad-id.test':{wrongId:true},'https://http.test':{badHttp:true}});
 const state=await x.pool.useAutomatic();assert.equal(state.active.url,'https://current.test');assert.equal(state.reports.find(r=>r.url==='https://fast.test').status,'lagging');
 assert.equal(x.calls.filter(c=>c.url==='https://wrong.test').length,1);assert.equal(x.calls.filter(c=>c.url==='https://current.test').length,3);
 assert.deepEqual(x.calls.filter(c=>c.url==='https://current.test').map(c=>c.method),['eth_chainId','eth_blockNumber','eth_call']);
});
test('eligible nodes are ranked by measured latency; 5 blocks behind is still eligible',()=>{
 const ranked=rankedNodes([{url:'slow',ok:true,blockNumber:100,latencyMs:20},{url:'fast',ok:true,blockNumber:95,latencyMs:3},{url:'stale',ok:true,blockNumber:94,latencyMs:1}]);assert.deepEqual(ranked.map(x=>x.url),['fast','slow']);
});
test('read failures fail over; all current nodes failing never revives a stale node',async()=>{
 const specs={'https://a.test':{ms:3,block:1000},'https://b.test':{ms:6,block:1000},'https://stale.test':{ms:1,block:900}};const x=fixture(specs);await x.pool.useAutomatic();
 const selected=x.pool.active.url;specs[selected].failRead=true;
 assert.equal(await x.pool.request('eth_call',[{to:'0x1',data:'0xabcd'},'latest']),'0x1234');assert.notEqual(x.pool.active.url,selected);assert.equal(x.pool.failovers,1);
 specs['https://a.test'].failRead=true;specs['https://b.test'].failRead=true;
 await assert.rejects(x.pool.request('eth_call',[{to:'0x1',data:'0xabcd'},'latest']),/RPC 读取失败/);
 assert.equal(x.pool.active,null);assert.equal(x.pool.snapshot().reports.find(r=>r.url==='https://stale.test').status,'lagging');
});
test('a timed-out read switches to a healthy backup within the timeout',async()=>{
 const specs={'https://a.test':{ms:2},'https://b.test':{ms:5}};const x=fixture(specs);await x.pool.useAutomatic();specs[x.pool.active.url].hang=true;
 assert.equal(await x.pool.request('eth_call',[{to:'0x1',data:'0xabcd'},'latest']),'0x1234');assert.equal(x.pool.failovers,1);
});
test('contract reverts propagate directly; no failover and no write methods',async()=>{
 const specs={'https://a.test':{ms:2},'https://b.test':{ms:5}};const x=fixture(specs);await x.pool.useAutomatic();specs[x.pool.active.url].revert=true;const before=x.calls.length;
 await assert.rejects(x.pool.request('eth_call',[{to:'0x1',data:'0xabcd'},'latest']),/execution reverted/);assert.equal(x.calls.length,before+1);assert.equal(x.pool.failovers,0);
 await assert.rejects(x.pool.request('eth_sendRawTransaction',['0xdeadbeef']),/只读/);assert.equal(x.calls.length,before+1);
});
test('all unavailable endpoints surface an error without selecting a fake fastest node',async()=>{
 const x=fixture({'https://a.test':{offline:true},'https://b.test':{badHttp:true}});await assert.rejects(x.pool.useAutomatic(),/暂无可用/);assert.equal(x.pool.active,null);assert.equal(x.pool.measuring,false);
});
test('fixed mode validates the chain, honors the selected endpoint, and can return to automatic',async()=>{
 const specs={'https://a.test':{ms:2},'https://b.test':{ms:5}};const x=fixture(specs);await x.pool.useAutomatic();await x.pool.useEndpoint('https://b.test');assert.equal(x.pool.mode,'fixed');assert.equal(x.pool.active.url,'https://b.test');
 specs['https://b.test'].failRead=true;const before=x.calls.length;await assert.rejects(x.pool.request('eth_call',[{to:'0x1',data:'0xabcd'},'latest']),/RPC 读取失败/);assert.equal(x.calls.length,before+1);
 await x.pool.useAutomatic();assert.equal(x.pool.mode,'auto');assert.ok(x.pool.active);
});
