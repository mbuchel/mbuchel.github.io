import {parseEncoding,parsePC} from './core.mjs';
import {catalog} from './opcode-data.mjs';
import {loadRuntime} from './runtime/loader.mjs';
import {decodeInstruction} from './runtime/decoder.mjs';
import {printInstruction} from './runtime/ast.mjs';
import {instructionHTML} from './assembly.mjs';
export const instructionText=printInstruction;
export function mountDecodedPair({getDraft,onArchitecture}){
  const select=document.getElementById('decode-arch'),status=document.getElementById('decode-status'),outputs=Object.fromEntries(['a','b'].map(side=>[side,{line:document.getElementById('decoded-'+side),meta:document.getElementById('decoded-'+side+'-meta')}]));
  let architectures=[],ticket=0;
  const canonical=label=>/^(?:sm_?)?(\d+a?)$/i.exec(label.trim())?.[1].toLowerCase()||'';
  function refresh(){
    const current=++ticket,draft=getDraft(),sm=canonical(draft.architecture),validArch=architectures.includes(sm);select.value=validArch?sm:'';
    if(!validArch){status.textContent='Choose an SM architecture to decode both instructions.';for(const {line,meta} of Object.values(outputs)){line.textContent='Select architecture above';meta.textContent='';}return;}
    const pending=[];for(const side of ['a','b']){const out=outputs[side];try{const value=parseEncoding(draft[side+'Raw'],draft.format),pc=parsePC(draft[side==='a'?'pcA':'pcB']??'0x0');pending.push({side,value,pc});out.line.textContent='Decoding…';out.meta.textContent=`sm_${sm} · PC 0x${pc.toString(16)}`;}catch(error){out.line.textContent='Decode unavailable';out.meta.textContent=error.message;}}
    if(!pending.length)return;status.textContent='Repository-derived JavaScript decoder · targets use each instruction’s PC.';
    loadRuntime(sm).then(({model})=>{if(current!==ticket)return;for(const {side,value,pc} of pending){const inst=decodeInstruction(model,value,pc),out=outputs[side];if(inst.decoded)out.line.innerHTML=instructionHTML(instructionText(inst));else out.line.textContent='HIDDEN · no supported decoding';out.meta.textContent=`sm_${model.sm} · PC 0x${pc.toString(16)}${inst.decoded?'':' · raw encoding retained'}`;}}).catch(error=>{if(current!==ticket)return;for(const {side} of pending){outputs[side].line.textContent='Decode unavailable';outputs[side].meta.textContent=error.message;}});
  }
  select.addEventListener('change',()=>{if(select.value)onArchitecture('sm_'+select.value);});
  catalog().then(data=>{architectures=data.architectures.map(a=>a.name.replace('SM',''));select.innerHTML='<option value="">Choose architecture…</option>'+architectures.map(sm=>`<option value="${sm}">sm_${sm}</option>`).join('');select.disabled=false;refresh();}).catch(error=>{status.textContent='Decoder tables unavailable: '+error.message;});
  return {refresh};
}
