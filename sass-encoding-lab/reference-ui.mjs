import {catalog,fetchJSON} from './opcode-data.mjs';
import {extractBits} from './core.mjs';
import {loadRuntime} from './runtime/loader.mjs';
import {referenceFields,bitRoles,roleClass,roleLabel} from './field-roles.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountReference({getPair,onSelection,onFields,onSeed}) {
  let snapshot=null,model=null,opcode=null,fields=[],ticket=0,runtimeSource=null,runtime=null;
  function values(field,value) {
    if(value===undefined||value===null)return '—';
    const packed=extractBits(value,field.bits),sample=field.values.find(([raw])=>{try{return BigInt(raw)===packed;}catch{return false;}});
    return '0x'+packed.toString(16).toUpperCase()+(sample?.[1]?' · '+sample[1]:'');
  }
  function refresh() {
    if(!opcode||!model)return;
    const pair=getPair(),aOpcode=pair?Number(pair.a&0xfffn):null;
    const mismatched=pair&&aOpcode!==Number(BigInt(opcode.opcode_val));
    $('reference-status').textContent=`${model.architecture} · ${opcode.mnemonic} · ${opcode.opcode_val} · ${fields.length} source fields${mismatched?' · A has a different opcode selector':''}${opcode.approach==='hidden'?' · hidden placeholder; no usable seed':''}`;
    $('reference-seed').disabled=opcode.approach==='hidden';
    const roles=bitRoles(fields);
    $('reference-fields').innerHTML=fields.length?fields.map((f,i)=>`<button class="source-field ${roleClass(f.role)}" data-source-field="${i}"><span class="source-field-name">${f.operand==='control'?'shared':f.operand==='mnemonic'?'instruction':'op'+esc(f.operand)} · ${esc(f.name)}<small>${esc(f.kind)} · <span class="field-role-label ${roleClass(f.bits.reduce((r,b)=>r|roles[b],f.role))}">${roleLabel(f.bits.reduce((r,b)=>r|roles[b],f.role))}</span></small></span><span class="mono source-bit-list">{${f.bits.map(b=>`<span class="${roleClass(roles[b])}" title="Bit ${b}: ${roleLabel(roles[b])}">${b}</span>`).join(',')}}</span><span class="source-values"><span>A ${esc(values(f,pair?.a))}</span><span>B ${esc(values(f,pair?.b))}</span></span><span class="source-line">${f.lines.length?'L'+f.lines[0]+(f.lines.length>1?' +'+(f.lines.length-1):''):'native group'} ↗</span></button>`).join(''):'<p class="muted">No operand field definitions in this snapshot for the selected opcode and variant.</p>';
    onFields(fields);
  }
  function selectVariant() {
    fields=referenceFields([...model.fields.filter(f=>f.opcode===Number(BigInt(opcode.opcode_val))&&f.variant===$('reference-variant').value),...(runtimeSource?.controlFields||[])],runtime,Number(BigInt(opcode.opcode_val)),model.architecture);refresh();
  }
  function selectOpcode() {
    opcode=model.opcodes[Number($('reference-opcode').value)];
    const variants=[...new Set(model.fields.filter(f=>f.opcode===Number(BigInt(opcode.opcode_val))).map(f=>f.variant))];
    $('reference-variant').innerHTML=(variants.length?variants:['base']).map(v=>`<option>${esc(v)}</option>`).join('');
    $('reference-variant').value=variants.includes('base')?'base':variants[0]??'base';selectVariant();
  }
  async function selectArchitecture() {
    const selected=snapshot.architectures.find(x=>x.name===$('reference-arch').value),current=++ticket;
    model=null;opcode=null;fields=[];runtime=null;onFields([]);$('reference-fields').replaceChildren();$('reference-opcode').disabled=true;$('reference-variant').disabled=true;$('reference-seed').disabled=true;
    $('reference-status').textContent='Loading '+selected.name+' definitions…';
    try {
      const [data,loaded]=await Promise.all([fetchJSON(selected.model),loadRuntime(selected.name.replace('SM',''))]);if(current!==ticket)return;model=data;runtime=loaded.model;
      $('reference-opcode').innerHTML=model.opcodes.map((o,i)=>`<option value="${i}">${esc(o.opcode_val)} · ${esc(o.mnemonic)}${o.approach==='hidden'?' [hidden]':''}</option>`).join('');
      const pair=getPair(),match=pair?model.opcodes.findIndex(o=>Number(BigInt(o.opcode_val))===Number(pair.a&0xfffn)):-1;
      $('reference-opcode').value=String(match>=0?match:Math.max(0,model.opcodes.findIndex(o=>o.mnemonic==='FFMA')));
      $('reference-opcode').disabled=false;$('reference-variant').disabled=false;selectOpcode();
    }catch(error){if(current===ticket)$('reference-status').textContent=error.message;}
  }
  $('reference-arch').addEventListener('change',selectArchitecture);
  $('reference-opcode').addEventListener('change',selectOpcode);$('reference-variant').addEventListener('change',selectVariant);
  $('reference-match').addEventListener('click',()=>{
    const pair=getPair();if(!model||!pair)return;
    const index=model.opcodes.findIndex(o=>Number(BigInt(o.opcode_val))===Number(pair.a&0xfffn));
    if(index<0){$('reference-status').textContent='No source opcode row matches A’s low 12-bit selector in '+model.architecture+'.';return;}
    $('reference-opcode').value=String(index);selectOpcode();
  });
  $('reference-fields').addEventListener('click',event=>{
    const el=event.target.closest('[data-source-field]');if(!el)return;
    const field=fields[Number(el.dataset.sourceField)];
    onSelection({bits:field.bits,label:`${field.operand==='control'?'shared':field.operand==='mnemonic'?'instruction':'op'+field.operand} ${field.name}`,source:`${model.architecture} · ${opcode.mnemonic} ${opcode.opcode_val}${field.variant?' · variant '+field.variant:''}\nSource: ${field.sourcePath||'opcodes/'+model.architecture+'/operand_fields.tsv'}, ${field.lines.length?'lines '+field.lines.join(', '):field.name+' (generated runtime group)'}\nBits: ${field.bits.join(',')}\nSnapshot SHA-256: ${field.sourcePath&&field.sourceArchive!=='opcodes'?runtimeSource.archiveSha256:snapshot.archiveSha256}`});
  });
  $('reference-seed').addEventListener('click',async()=>{
    if(!opcode||opcode.approach==='hidden')return;
    await onSeed({side:'a',value:BigInt(opcode.enc0)|(BigInt(opcode.enc1)<<64n),label:`${opcode.mnemonic} · ${opcode.opcode_val} · repository seed`,architecture:model.architecture.replace('SM','sm_'),provenance:`Source: opcodes/${model.architecture}/opcodes.tsv, line ${opcode.sourceLine}\nProbe approach: ${opcode.approach}\nenc0 (low): ${opcode.enc0}; enc1 (high): ${opcode.enc1}\nSnapshot SHA-256: ${snapshot.archiveSha256}\nThis is a probe seed, not evidence of executed behavior.`});
  });
  Promise.all([catalog(),fetchJSON('data/runtime-source.json')]).then(([data,source])=>{
    runtimeSource=source;
    snapshot=data;$('reference-snapshot').textContent=`${data.architectures.length} SMs · ${data.opcodeCount.toLocaleString()} opcodes`;
    $('reference-arch').innerHTML=data.architectures.map(a=>`<option>${esc(a.name)}</option>`).join('');
    $('reference-arch').value=data.architectures.some(x=>x.name==='SM90')?'SM90':data.architectures[0].name;
    $('reference-arch').disabled=false;selectArchitecture();
  }).catch(error=>{$('reference-status').textContent='Repository reference unavailable: '+error.message;});
  return {refresh};
}
