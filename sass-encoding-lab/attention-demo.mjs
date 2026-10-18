import {parseCubin} from './cubin.mjs';
import {parseIR} from './ir.mjs';
import {startCubinLift} from './runtime/lift-task.mjs';

export function mountAttentionDemo({comparison}) {
  const button=document.getElementById('attention-load');
  if(!button)return;
  const status=document.getElementById('attention-status'),error=document.getElementById('attention-error');
  const chapters=[...document.querySelectorAll('#attention-stages > li')];
  if(chapters.length){
    const steps=[...document.querySelectorAll('[data-attention-step]')];
    const previous=document.getElementById('attention-story-prev'),next=document.getElementById('attention-story-next');
    let chapter=0;
    const show=index=>{
      chapter=index;
      chapters.forEach((item,i)=>{item.hidden=i!==index;});
      steps.forEach((step,i)=>step.setAttribute('aria-pressed',String(i===index)));
      previous.disabled=index===0;
      next.textContent=index===chapters.length-1?'Compare the binaries →':'Next chapter →';
      document.getElementById('attention-story-progress').textContent=`Chapter ${index+1} of ${chapters.length}`;
    };
    steps.forEach((step,index)=>step.addEventListener('click',()=>show(index)));
    previous.addEventListener('click',()=>show(Math.max(0,chapter-1)));
    next.addEventListener('click',()=>chapter===chapters.length-1?button.click():show(chapter+1));
    document.getElementById('attention-story-controls').hidden=false;
    show(0);
  }
  let active=null;
  button.addEventListener('click',async()=>{
    button.disabled=true;error.textContent='';status.textContent='Loading the bundled input and rebuilt program…';
    const run={controller:new AbortController(),tasks:[]};active=run;
    try {
      const base=new URL('./examples/fa3/',import.meta.url),response=await fetch(new URL('manifest.json',base),{signal:run.controller.signal});
      if(!response.ok)throw new Error('The bundled example manifest could not be loaded.');
      const manifest=await response.json();
      if(!globalThis.crypto?.subtle)throw new Error('This example requires HTTPS or localhost to verify its binary hashes.');
      const inputs=await Promise.all(['source','target'].map(async key=>{
        const meta=manifest[key],response=await fetch(new URL(meta.file,base),{signal:run.controller.signal});
        if(!response.ok)throw new Error('The bundled '+key+' cubin could not be loaded.');
        const bytes=await response.arrayBuffer();
        if(bytes.byteLength!==meta.bytes||bytes.byteLength>64*1024*1024)throw new Error('The bundled '+key+' cubin has an unexpected size.');
        const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        if(digest!==meta.sha256)throw new Error('The bundled '+key+' cubin checksum does not match the bundled manifest.');
        const cubin=parseCubin(bytes),fn=cubin.functions.find(fn=>fn.name===meta.kernel);
        if(!fn)throw new Error('The selected '+key+' kernel is missing from the bundled cubin.');
        return {cubin,fn,digest,meta};
      }));
      if(active!==run)return;
      for(const {cubin,fn} of inputs)run.tasks.push(startCubinLift(cubin,fn));
      const snapshots=await Promise.all(run.tasks.map(async(task,index)=>{
        const {cubin,fn,digest,meta}=inputs[index],result=await task.promise;
        const parsed=parseIR(result.text,meta.file).functions[0];
        if(!parsed)throw new Error('The bundled '+meta.file+' did not produce an inspectable function.');
        return {...parsed,source:meta.file+' · native pass browser lift',architecture:cubin.architecture,generatedId:fn.id,digest,stats:result.stats};
      }));
      if(active!==run)return;
      active=null;button.disabled=false;
      status.textContent=`Ready: FA2 ${snapshots[0].stats.instructions.toLocaleString()} words → rebuilt ${snapshots[1].stats.instructions.toLocaleString()} words. Loaded from the included cubins; no GPU execution.`;
      comparison.capture('a',snapshots[0]);comparison.capture('b',snapshots[1]);
      document.getElementById('compare-title')?.focus();
    } catch(cause) {
      if(active===run){error.textContent=cause.message;status.textContent='The example could not be loaded. You can retry or download the included cubins.';}
    } finally {
      for(const task of run.tasks)task.cancel();
      if(active===run){active=null;button.disabled=false;}
    }
  });
  return {cancel(){
    if(!active)return;
    const run=active;active=null;run.controller.abort();
    for(const task of run.tasks)task.cancel();
    button.disabled=false;status.textContent='Example loading cancelled. Your comparison was kept.';
  }};
}
