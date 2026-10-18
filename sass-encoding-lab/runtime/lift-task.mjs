import {loadRuntime} from './loader.mjs';
import {liftFunction} from './lift.mjs';

// Each comparison pane owns a task; cancelling one never affects the other.
export function startCubinLift(cubin,fn){
  if(!cubin.canSlice)throw new Error('Browser lifting requires Volta or newer 128-bit SASS.');
  if(fn.count>25000)throw new Error('This browser version lifts functions up to 25,000 instructions.');
  let worker=null,rejectPending=null,cancelled=false;
  const aborted=()=>new DOMException('Lifting cancelled.','AbortError');
  const promise=(async()=>{
    if(typeof Worker!=='undefined'){
      try{return await new Promise((resolve,reject)=>{
        rejectPending=reject;
        worker=new Worker(new URL('./worker.mjs',import.meta.url),{type:'module'});
        worker.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);
        worker.onerror=()=>reject(new Error('Browser lifting worker failed. Try generating this function again.'));
        const bytes=cubin.bytes.slice();worker.postMessage({buffer:bytes.buffer,functionId:fn.id},[bytes.buffer]);
      });}finally{worker?.terminate();worker=null;rejectPending=null;}
    }
    const {model,vocabulary}=await loadRuntime(cubin.architecture);
    if(cancelled)throw aborted();
    return liftFunction(cubin,fn,model,vocabulary);
  })();
  return {promise,cancel(){cancelled=true;worker?.terminate();rejectPending?.(aborted());}};
}
