import {parseCubin} from '../cubin.mjs';
import {loadRuntime} from './loader.mjs';
import {liftFunction} from './lift.mjs';
self.onmessage=async event=>{
  try{
    const {buffer,functionId}=event.data,cubin=parseCubin(buffer),fn=cubin.functions.find(f=>f.id===functionId);
    if(!fn)throw new Error('Selected function is absent from the cubin.');
    const {model,vocabulary}=await loadRuntime(cubin.architecture);
    self.postMessage({result:liftFunction(cubin,fn,model,vocabulary)});
  }catch(error){self.postMessage({error:error.message});}
};
