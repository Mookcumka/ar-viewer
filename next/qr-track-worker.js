/* No payload decoding, network models or camera ownership here. Transferred pixels live only in memory. */
'use strict';
// Upstream jsfeat browser UMD exports via window; keep the vendor bytes unchanged in a worker.
const window=self;
importScripts('./vendor/jsfeat-min.js','./vendor/qr-locator.js','./qr-tracker.js');
const tracker=ARQrTracker.engine(jsfeat,ARQrLocator);
self.onmessage=event=>{
 const m=event.data;
 if(m.type==='reset'){tracker.reset();return;}
 if(m.type!=='frame')return;
 try{const targets=tracker.process({width:m.width,height:m.height,data:new Uint8ClampedArray(m.buffer)},m.at,(m.details||[]).slice(0,1).map(d=>({image:{width:d.width,height:d.height,data:new Uint8ClampedArray(d.buffer)},rect:d.rect})));self.postMessage({type:'tracks',epoch:m.epoch,seq:m.seq,at:m.at,detailSearched:tracker.detailSearched,targets});}
 catch(error){self.postMessage({type:'error',epoch:m.epoch,seq:m.seq,message:error.message});}
};
