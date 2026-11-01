import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const entry = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const schema = readFileSync(resolve(root, 'setup_playtime_airdrops.sql'), 'utf8');
const assetRequests = [];
const hostHtml = `<!doctype html><meta charset="utf-8">
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style>
<iframe id="addon" sandbox="allow-scripts" src="/api/addons/installed/dune-airdrop-addon/content/web/index.html"></iframe>
<script>
window.__bridgeLog=[];window.__schemaReady=false;window.__stored=null;window.__version=0;
window.__denyStorage=false;window.__ambiguous=true;window.__delivered=[];
addEventListener('message', event => {
 const frame=document.querySelector('iframe');
 if(event.source!==frame.contentWindow||event.origin!=='null')return;
 const m=event.data;if(m.type!=='dune-addon-request')return;
 window.__bridgeLog.push({action:m.action,payload:m.payload});
 let result={rows:[]},error='';const p=m.payload||{},q=p.query||'';
 if(m.action==='database.query') {
  if(q.includes('to_regclass')&&window.__schemaReady)result={rows:[{config_table:'config',playtime_table:'playtime',queue_table:'queue'}]};
  if(q.includes("ILIKE '%container%'"))result={rows:[{id:'9999999999999',class:'/Game/Chest',owner_account_id:'test-account'}]};
  if(q.includes('FROM dune.inventories WHERE id ='))result={rows:[{account_id:'test-account'}]};
 }
 if(m.action==='database.execute'){result={rowCount:1};if(q.includes('CREATE SCHEMA'))window.__schemaReady=true;}
 if(m.action==='addon.storage.get')result={found:window.__version>0,value:window.__stored,version:window.__version};
 if(m.action==='addon.storage.put'){
  if(window.__denyStorage)error='Storage unavailable';
  else if(p.expectedVersion!==(window.__version||null))error='Storage changed';
  else {window.__stored=p.value;result={ok:true,version:++window.__version};}
 }
 if(m.action==='admin.items.grant'){
  if(!window.__delivered.includes(p.requestId))window.__delivered.push(p.requestId);
  if(window.__ambiguous)error='Bridge request timed out';else result={ok:true};
 }
 event.source.postMessage({type:'dune-addon-response',addonId:m.addonId,requestId:m.requestId,ok:!error,result,error},'*');
});</script>`;

const server = createServer((request, response) => {
  if (request.url === '/favicon.ico') return response.writeHead(204).end();
  if (request.url === '/host.html') {
    response.writeHead(200, {'content-type':'text/html','set-cookie':'console_session=synthetic; SameSite=Strict; HttpOnly'});
    return response.end(hostHtml);
  }
  if (request.url === '/api/addons/installed/dune-airdrop-addon/content/web/index.html') {
    if (!request.headers.cookie?.includes('console_session=synthetic')) return response.writeHead(401).end();
    response.writeHead(200, {'content-type':'text/html', 'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; frame-ancestors 'self'; sandbox allow-scripts"});
    return response.end(entry);
  }
  assetRequests.push(request.url); response.writeHead(404).end();
});
await new Promise(resolveServer => server.listen(0,'127.0.0.1',resolveServer));
const browser = await chromium.launch({headless:true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : {})});
try {
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 page.on('dialog',()=>{throw new Error('Native dialogs are unavailable in the Console sandbox.');});
 await page.goto('http://127.0.0.1:'+server.address().port+'/host.html');
 const addon=page.frameLocator('#addon');
 await addon.getByText('Setup Required',{exact:true}).waitFor();
 const frame=()=>page.frames().find(f=>f.url().endsWith('/web/index.html'));
 assert.equal(await frame().evaluate(()=>{try{void window.localStorage;return false;}catch{return true;}}),true);
 const countWrites=()=>page.evaluate(()=>__bridgeLog.filter(e=>e.action==='database.execute').length);
 await addon.getByRole('button',{name:'INIT SCHEMA',exact:true}).click();
 await addon.getByRole('alertdialog').waitFor();assert.equal(await countWrites(),0);
 await page.keyboard.press('Escape');assert.equal(await countWrites(),0);
 await addon.getByRole('button',{name:'INIT SCHEMA',exact:true}).click();
 await addon.getByRole('alertdialog').getByRole('button',{name:'Continue',exact:true}).click();
 await addon.getByText('Console Connected',{exact:true}).waitFor();
 const queries=await page.evaluate(()=>__bridgeLog.filter(e=>e.action==='database.execute'));
 assert.equal(queries[0].payload.query,schema);
 await addon.locator('#tabLootBtn').click();
 await addon.locator('#container-row-9999999999999').click();
 await addon.locator('#openSpawnModalBtn').click();
 await addon.locator('#spawnItemTemplateInput').fill('TestSword');
 await addon.locator('#spawnItemQtyInput').fill('3');
 await page.evaluate(()=>{__denyStorage=true;});
 await addon.locator('#spawnItemConfirmBtn').click();
 await addon.getByText('Spawn request rejected: Storage unavailable',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>__bridgeLog.filter(e=>e.action==='admin.items.grant').length),0);
 await page.evaluate(()=>{__denyStorage=false;});
 await addon.locator('#spawnItemConfirmBtn').click();
 await addon.locator('#spawnItemTemplateInput:disabled').waitFor();
 const pending=await page.evaluate(()=>__stored);
 assert.equal(pending.status,'UNCERTAIN');
 // The Console closes/reopens the iframe from its authenticated parent.
 // An opaque child initiating its own navigation would drop Strict cookies.
 await page.evaluate(()=>{
  const previous=document.querySelector('#addon');
  previous.replaceWith(previous.cloneNode());
 });
 await addon.locator('#spawnItemTemplateInput:disabled').waitFor({state:'attached'});
 assert.equal(await addon.locator('#spawnItemTemplateInput').inputValue(),'TestSword');
 await page.evaluate(()=>{__ambiguous=false;});
 await addon.locator('#tabLootBtn').click();
 await addon.locator('#openSpawnModalBtn').click();
 await addon.locator('#spawnItemConfirmBtn').click();
 await addon.getByText('Successfully spawned 3x TestSword',{exact:true}).waitFor();
 const grants=await page.evaluate(()=>__bridgeLog.filter(e=>e.action==='admin.items.grant'));
 assert.equal(grants.length,2);assert.equal(grants[0].payload.requestId,pending.id);
 assert.equal(grants[1].payload.requestId,pending.id);
 assert.equal(await page.evaluate(()=>__delivered.length),1);
 assert.equal(await page.evaluate(()=>__stored),null);
 for(const operation of ['approve','resolve']) {
  const before=await countWrites();
  await frame().evaluate(operation=>{
   if(operation==='approve')void window.approveHistoricalDelivery('1');
   else {window.openDeliveryResolution('1');void window.resolveUncertainDelivery('retry');}
  },operation);
  await addon.getByRole('alertdialog').waitFor();
  await addon.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await countWrites(),before);
  await frame().evaluate(operation=>{
   if(operation==='approve')void window.approveHistoricalDelivery('1');
   else void window.resolveUncertainDelivery('retry');
  },operation);
  await addon.getByRole('alertdialog').getByRole('button',{name:'Continue',exact:true}).click();
  await page.waitForFunction(n=>__bridgeLog.filter(e=>e.action==='database.execute').length===n,before+1);
 }
 assert.deepEqual(assetRequests,[]);assert.deepEqual(errors,[]);
 console.log('PASS: exact Console CSP, opaque-origin storage, confirmations, write failure, reload and idempotent retry.');
} finally {await browser.close();await new Promise(resolveServer=>server.close(resolveServer));}
