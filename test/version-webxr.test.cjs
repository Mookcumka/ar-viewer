const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const identity=require('../version.js'),xr=require('../webxr.js');
test('capability detection fails closed without UA assumptions or session requests',async()=>{
 assert.equal(await xr.supported({},true),false);
 assert.equal(await xr.supported({xr:{isSessionSupported:async()=>true}},false),false);
 assert.equal(await xr.supported({xr:{isSessionSupported:async mode=>{assert.equal(mode,'immersive-ar');return true;}}},true),true);
 assert.equal(await xr.supported({xr:{isSessionSupported:async()=>{throw Error('policy');}}},true),false);
});
test('visible version is the immutable report identity and updates without inline HTML constants',()=>{
 const label={textContent:''}, context={document:{getElementById:id=>id==='app-version'?label:null}};vm.runInNewContext(read('version.js'),context);
 assert.equal(label.textContent,`v${identity.version} · ${identity.build}`);assert.equal(Object.isFrozen(context.ARViewerVersion),true);
 assert.match(identity.version,/^\d+\.\d+\.\d+(-[\w.]+)?$/);
 assert.ok(read('sw.js').includes('importScripts("./version.js")'));
});
test('portable runtime includes the new mandatory modules but no model fixtures',()=>{
 const script=read('qr-sheet/package.py');for(const name of ['version.js','webxr.js'])assert.ok(script.includes("'"+name+"'"));
 assert.ok(!script.split('def package')[0].includes('exporto-vectors.json'));
});
test('offline report distinguishes a complete old cache from the running application',async()=>{
 for(const match of [true,false]) {
  const label={textContent:''},scope='https://example.test/ar/',state={};
  const worker={state:'activated',scriptURL:scope+'sw.js',postMessage:(_,ports)=>ports[0].postMessage({ready:true,scope,version:identity.cacheVersion,appVersion:match?identity.version:'0.0.0',build:identity.build})};
  const reg={scope,active:worker,addEventListener(){},removeEventListener(){}};
  vm.runInNewContext(read('offline.js'),{document:{getElementById:()=>label},navigator:{serviceWorker:{register:async()=>reg}},location:{href:scope},URL,MessageChannel,setTimeout,clearTimeout,ARViewerVersion:identity,window:state});
  for(let i=0;i<40&&!state.AROfflineState;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(state.AROfflineState.ready,true);assert.equal(state.AROfflineState.readyForThisBuild,match);assert.equal(state.AROfflineState.matchesRunningApp,match);
  assert.equal(label.textContent.includes('Ресурсы сохранены'),match);
 }
});
