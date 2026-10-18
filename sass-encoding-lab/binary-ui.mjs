import {mountAttentionDemo} from './attention-demo.mjs';
import {parseCubin,instructionAt} from './cubin.mjs';
import {parseIR,rawAttributes,ssaTokens,parseTSV} from './ir.mjs';
import {mountCFG} from './cfg-ui.mjs';
import {mountIRComparison} from './compare-ui.mjs';
import {hex} from './core.mjs';
import {catalog,sourceTable,fetchJSON} from './opcode-data.mjs';
import {loadRuntime} from './runtime/loader.mjs';
import {liftFunction} from './runtime/lift.mjs';
import {instructionHTML,assemblyCommentHTML} from './assembly.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PAGE=128;
function download(text,name,type='text/plain') {
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
export function mountBinaryExplorer({onEncoding,onView=()=>{},onWorkspaceChange=()=>{}}) {
  let cubin=null,cubinName='',digest='',fn=null,instructionPage=0,irs=[],ir=null,irPage=0,selectedSSA='',focusLine=-1;
  let tables=[],opcodePage=0,rawByLine=new Map(),irLines=[],loadingCubin=0,loadingIR=0,loadingOpcodes=0;
  let sourceCatalog=null,sourceMetas=[],remoteTables=true,opcodeReferences=new Map();
  let liftWorker=null,liftTicket=0,lifting=false,liftedInstructions=new Map();
  const cfg=mountCFG({onSelect({block,jump}){
    $('ir-block').value=String(block.line);
    if(jump){focusLine=block.line;irPage=Math.floor(focusLine/PAGE);}
    renderIR();
    if(jump)$('ir-lines').querySelector('.focused-line')?.scrollIntoView({block:'nearest'});
  }});
  const comparison=mountIRComparison({onEncoding,showCompare:()=>view('compare'),showEncoding:()=>view('encoding'),onChange:()=>onWorkspaceChange('compare')});
  const attentionDemo=mountAttentionDemo({comparison});
  for(const side of ['a','b'])$('ir-use-'+side).addEventListener('click',()=>{if(ir)comparison.capture(side,{...ir,architecture:ir.architecture||(ir.generatedId?cubin?.architecture||'':'')});});
  const symbolName=name=>name.replace(/^\.text\./,'');
  const sameFunction=(a,b)=>symbolName(a)===symbolName(b);
  function cancelLift(){liftTicket++;if(liftWorker)liftWorker.terminate();liftWorker=null;lifting=false;$('cubin-lift').disabled=!cubin?.canSlice;$('lift-cancel').hidden=true;}
  function view(name) {
    if(name!=='attention')attentionDemo?.cancel();
    for(const value of ['encoding','binary','compare','opcodes','attention']) $(value+'-view').hidden=name!==value;
    document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===name);if(el.dataset.view===name)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    $('example-button').hidden=name!=='encoding';
    onView(name);
  }
  document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>view(el.dataset.view)));
  $('cubin-open').addEventListener('click',()=>$('cubin-file').click());
  $('ir-open').addEventListener('click',()=>$('ir-files').click());
  function renderFunctions() {
    const q=$('function-search').value.toLowerCase();
    const filtered=cubin.functions.filter(f=>f.name.toLowerCase().includes(q));
    $('function-count').textContent=cubin.functions.length;
    $('function-list').innerHTML=filtered.length?filtered.map(f=>`<button class="function-option${fn?.id===f.id?' active':''}" data-function="${f.id}" ${fn?.id===f.id?'aria-current="true"':''}><span>${esc(f.name)}</span><small>${f.size.toLocaleString()} bytes · ${cubin.canSlice?f.count.toLocaleString()+' × 128 bit':'raw section'}</small></button>`).join(''):'<p class="muted function-no-results">No matching functions.</p>';
  }
  function renderInstructions() {
    $('function-title').textContent=fn.name;
    $('function-meta').textContent=`${fn.section} · ${fn.size.toLocaleString()} bytes · file +0x${fn.fileOffset.toString(16)}`;
    $('cubin-arch').textContent=cubin.architecture;
    $('cubin-warnings').textContent=cubin.warnings.join(' ');
    const start=instructionPage*PAGE,end=Math.min(fn.count,start+PAGE);
    $('instruction-rows').innerHTML=cubin.canSlice?Array.from({length:end-start},(_,i)=>{
      const x=instructionAt(cubin,fn,start+i);
      const reference=opcodeReferences.get(Number(x.value&0xfffn)),lifted=liftedInstructions.get(fn.id)?.[x.index];
      return `<tr><td class="mono">0x${x.offset.toString(16).padStart(4,'0')}</td><td><code>${x.hex.match(/.{8}/g).join(' ')}</code><small class="instruction-source-name" title="${lifted?'Source-derived JavaScript decoding':'Mnemonic from the opcode table’s seed row; not a full disassembly'}">${lifted?(lifted.decoded?instructionHTML(lifted.assembly):esc(lifted.assembly)):reference?esc(reference.mnemonic)+' · '+esc(reference.opcode_val)+' · seed label':'No opcode reference loaded'}</small></td><td>${lifted?`<button class="encoding-pick" data-jump-ir="${x.offset}" aria-label="Explore IR for offset ${x.offset}">IR</button>`:''}<button class="encoding-pick pick-a" data-instruction="${x.index}" data-side="a" aria-label="Use instruction at offset ${x.offset} as baseline A">A</button><button class="encoding-pick pick-b" data-instruction="${x.index}" data-side="b" aria-label="Use instruction at offset ${x.offset} as variant B">B</button></td></tr>`;
    }).join(''):'<tr><td colspan="3" class="muted">This architecture cannot be sliced into 128-bit instructions.</td></tr>';
    $('instruction-page').textContent=cubin.canSlice?`${fn.count?start+1:0}–${end} of ${fn.count.toLocaleString()} instructions`:'Instruction slicing unavailable';
    $('instruction-prev').disabled=!cubin.canSlice||instructionPage===0;
    $('instruction-next').disabled=!cubin.canSlice||end>=fn.count;
    $('instruction-go').disabled=!cubin.canSlice;
    $('cubin-lift').disabled=lifting||!cubin.canSlice;
    updateIRLink();
  }
  function selectFunction(id) {
    if(lifting){cancelLift();$('lift-status').textContent='Lifting cancelled because the selected function changed.';}
    fn=cubin.functions.find(f=>f.id===id);instructionPage=0;renderFunctions();renderInstructions();
    const match=irs.findIndex(x=>x.generatedId===fn.id||sameFunction(x.name,fn.name));
    if(match>=0){$('ir-function').value=String(match);selectIR(match);}
  }
  $('cubin-file').addEventListener('change',async event=>{
    const file=event.target.files[0];event.target.value='';if(!file)return;
    const ticket=++loadingCubin;$('binary-error').textContent='';
    try {
      if(file.size>64*1024*1024)throw new Error('Cubin exceeds the 64 MB limit.');
      const buffer=await file.arrayBuffer();
      const parsed=parseCubin(buffer);
      let hash='';if(globalThis.crypto?.subtle)hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
      if(ticket!==loadingCubin)return;
      cancelLift();cubin=parsed;cubinName=file.name;digest=hash;opcodeReferences=new Map();liftedInstructions=new Map();irs=irs.filter(x=>!x.generatedId);$('function-search').value='';
      if(ir?.generatedId){ir=null;$('ir-workspace').hidden=true;$('binary-save-experiment').disabled=true;}
      $('lift-status').textContent='Select a function, then lift it with the repository’s browser port.';
      $('cubin-status').textContent=`${file.name} · ${cubin.functions.length} functions · ${cubin.architecture}`;
      $('cubin-workspace').hidden=false;$('binary-empty').hidden=true;selectFunction(cubin.functions[0].id);
      onWorkspaceChange('binary');
      const snapshot=await catalog();const model=snapshot.architectures.find(a=>a.name===cubin.architecture.replace('sm_','SM'));
      if(model){const data=await fetchJSON(model.model);if(ticket!==loadingCubin)return;opcodeReferences=new Map(data.opcodes.map(o=>[Number(BigInt(o.opcode_val)),o]));renderInstructions();}
    } catch(error){if(ticket===loadingCubin)$('binary-error').textContent=error.message;}
  });
  $('function-search').addEventListener('input',()=>{if(cubin)renderFunctions();});
  $('function-list').addEventListener('click',event=>{const target=event.target.closest('[data-function]');if(target)selectFunction(target.dataset.function);});
  $('lift-cancel').addEventListener('click',()=>{cancelLift();$('lift-status').textContent='Lifting cancelled.';});
  $('cubin-lift').addEventListener('click',async()=>{
    if(!fn||!cubin.canSlice||lifting)return;const selected=fn,ticket=++liftTicket,sourceName=cubinName;
    lifting=true;$('cubin-lift').disabled=true;$('lift-cancel').hidden=false;$('binary-error').textContent='';$('lift-status').textContent='Loading decoder tables and lifting '+selected.name+' in your browser…';
    try{
      let result;
      if(typeof Worker!=='undefined'){
        result=await new Promise((resolve,reject)=>{
          liftWorker=new Worker(new URL('./runtime/worker.mjs',import.meta.url),{type:'module'});
          liftWorker.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);
          liftWorker.onerror=()=>reject(new Error('Browser lifting worker failed. Reload the page and try again.'));
          const bytes=cubin.bytes.slice();liftWorker.postMessage({buffer:bytes.buffer,functionId:selected.id},[bytes.buffer]);
        });
      }else{const {model,vocabulary}=await loadRuntime(cubin.architecture);if(ticket!==liftTicket)return;result=liftFunction(cubin,selected,model,vocabulary);}
      if(ticket!==liftTicket)return;
      liftedInstructions.set(selected.id,result.instructions);
      const parsed=parseIR(result.text,sourceName+' · browser lift'),generated={...parsed.functions[0],source:sourceName+' · browser JavaScript lift',architecture:cubin.architecture,generatedId:selected.id,digest,stats:result.stats};
      irs=irs.filter(x=>x.generatedId!==selected.id);irs.push(generated);const index=irs.length-1;
      $('ir-function').innerHTML=irs.map((f,i)=>`<option value="${i}">${esc(f.name)} · ${esc(f.source)}</option>`).join('');
      $('ir-function').value=String(index);$('ir-workspace').hidden=false;
      const s=result.stats,summary=`${s.instructions.toLocaleString()} instructions · ${s.decoded.toLocaleString()} decoded · ${s.raw} raw carriers · ${s.blocks} blocks · ${s.values} SSA values`;
      $('lift-status').textContent=summary+(s.unresolved?` · ${s.unresolved} unresolved transfers`:'')+(s.tail?` · ${s.tail} tail bytes retained`:'')+'.';
      $('ir-status').textContent='Generated locally · experimental source-derived JavaScript port · native MLIR parse-check has not been run.';
      selectIR(index);renderInstructions();$('ir-workspace').scrollIntoView({behavior:'smooth',block:'start'});
    }catch(error){if(ticket===liftTicket){$('binary-error').textContent=error.message;$('lift-status').textContent='Lifting did not complete.';}}
    finally{if(ticket===liftTicket){if(liftWorker)liftWorker.terminate();liftWorker=null;lifting=false;$('cubin-lift').disabled=false;$('lift-cancel').hidden=true;}}
  });
  $('instruction-prev').addEventListener('click',()=>{instructionPage--;renderInstructions();});
  $('instruction-next').addEventListener('click',()=>{instructionPage++;renderInstructions();});
  $('instruction-go').addEventListener('click',()=>{
    if(!fn||!cubin.canSlice)return;
    const raw=$('instruction-offset').value.trim();
    const offset=/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(raw)?Number(raw):NaN;
    if(!Number.isSafeInteger(offset)||offset<0||offset%16||offset>=fn.count*16){$('binary-error').textContent='Use a function-relative, 16-byte-aligned offset within the instruction range.';return;}
    $('binary-error').textContent='';instructionPage=Math.floor(offset/16/PAGE);renderInstructions();
    $('instruction-rows').children[offset/16%PAGE]?.classList.add('focused-instruction');
  });
  $('instruction-rows').addEventListener('click',async event=>{
    const jump=event.target.closest('[data-jump-ir]');if(jump){const match=irs.findIndex(x=>x.generatedId===fn.id);if(match>=0){$('ir-function').value=String(match);selectIR(match);const marker='+0x'+Number(jump.dataset.jumpIr).toString(16).padStart(4,'0');focusLine=irLines.findIndex(line=>line.includes('// '+marker+' '))+1;irPage=Math.floor(Math.max(0,focusLine)/PAGE);cfg.selectLine(focusLine);renderIR();$('ir-workspace').scrollIntoView({behavior:'smooth',block:'start'});}return;}
    const el=event.target.closest('[data-instruction]');if(!el)return;
    const x=instructionAt(cubin,fn,Number(el.dataset.instruction));
    const accepted=await onEncoding({side:el.dataset.side,value:x.value,pc:x.offset,label:`${fn.name} +0x${x.offset.toString(16)} (raw cubin)`,architecture:cubin.architecture,provenance:`Cubin: ${cubinName}\nFunction: ${fn.name}\nSection: ${fn.section}; function-relative offset: 0x${x.offset.toString(16)}; file offset: 0x${x.fileOffset.toString(16)}${digest?'\nSHA-256: '+digest:''}`});
    if(accepted)view('encoding');
  });
  function selectIR(index) {
    ir=irs[index];irPage=0;selectedSSA='';focusLine=-1;
    $('binary-save-experiment').disabled=!ir;
    irLines=ir.text.split('\n');rawByLine=new Map();
    for(const [index,r] of rawAttributes(ir.text).entries()){if(ir.generatedId)r.pc=index*16;if(!rawByLine.has(r.line))rawByLine.set(r.line,[]);rawByLine.get(r.line).push(r);}
    cfg.load(ir.text,ir.lineStart);
    $('ir-block').innerHTML='<option value="">Jump to block…</option>'+(cfg.graph?.blocks||[]).map(b=>`<option value="${b.line}">${esc(b.name)}</option>`).join('');
    $('ir-block').disabled=!cfg.graph;$('ir-block').value=cfg.selected?String(cfg.selected.line):'';
    $('ir-search').value='';renderIR();updateIRLink();
  }
  function updateIRLink() {
    if(!ir)return;
    if(ir.savedSnapshot){$('ir-link-status').textContent=`${ir.source} · saved MLIR snapshot${ir.digest?' · recorded cubin SHA-256: '+ir.digest:''}. Original cubin bytes are not stored or reverified here.`;return;}
    const match=fn&&sameFunction(ir.name,fn.name);
    $('ir-link-status').textContent=ir.generatedId?`${ir.source} · ${ir.stats.decoded}/${ir.stats.instructions} decoded · raw bytes and SSA structure checked${ir.digest?' · cubin SHA-256: '+ir.digest:''}.`:match?`Function name matches the selected cubin symbol · ${ir.source} · association by name, not a verified binary/IR match.`:`${ir.source} · ${ir.name} · source text only; no verified binary/IR association.`;
  }
  function renderLine(text,line) {
    const assembly=assemblyCommentHTML(text);if(assembly!==null)return assembly;
    let result='',position=0;
    const tokens=[...ssaTokens(text),...cfg.tokens(line).map(t=>({...t,kind:'block'}))].sort((a,b)=>a.start-b.start);
    for(const token of tokens) {
      if(token.start<position)continue;
      result+=esc(text.slice(position,token.start));
      result+=token.kind==='block'?`<button class="ir-block-token" data-ir-cfg-block="${token.block}" aria-label="Explore CFG block ${esc(text.slice(token.start,token.end))}">${esc(text.slice(token.start,token.end))}</button>`:`<button class="ssa-token${token.value===selectedSSA?' selected-ssa':''}" data-ssa="${esc(token.value)}">${esc(token.value)}</button>`;
      position=token.end;
    }
    return result+esc(text.slice(position));
  }
  function renderIR() {
    if(!ir)return;
    const start=irPage*PAGE,end=Math.min(irLines.length,start+PAGE),query=$('ir-search').value.trim().toLowerCase();
    $('ir-lines').innerHTML=irLines.slice(start,end).map((line,i)=>{
      const n=start+i,raws=rawByLine.get(n)||[];
      const current=cfg.selected&&n>=cfg.selected.line&&n<=cfg.selected.endLine;
      return `<div class="ir-line${current?' cfg-active-block':''}${n===focusLine?' focused-line':''}${query&&line.toLowerCase().includes(query)?' search-hit':''}" data-ir-line="${n}"><span class="ir-line-number">${ir.lineStart+n}</span><code>${renderLine(line,n)||' '}</code>${raws.map((r,k)=>`<span class="ir-raw-actions"><button class="encoding-pick pick-a" data-ir-raw="${n}:${k}" data-side="a" aria-label="Use raw attribute on line ${ir.lineStart+n} as A">A</button><button class="encoding-pick pick-b" data-ir-raw="${n}:${k}" data-side="b" aria-label="Use raw attribute on line ${ir.lineStart+n} as B">B</button></span>`).join('')}</div>`;
    }).join('');
    $('ir-page').textContent=`Lines ${start+1}–${end} of ${irLines.length}`;
    $('ir-prev').disabled=irPage===0;$('ir-next').disabled=end>=irLines.length;
    const count=selectedSSA?ssaTokens(ir.text).filter(t=>t.value===selectedSSA).length:0;
    $('ir-selected-value').textContent=selectedSSA?`${selectedSSA} · ${count} textual reference${count!==1?'s':''} in this function`:'Click an SSA value to highlight its references.';
    onWorkspaceChange('binary');
  }
  $('ir-files').addEventListener('change',async event=>{
    const files=[...event.target.files];event.target.value='';if(!files.length)return;
    const ticket=++loadingIR;
    try {
      if(files.length>100)throw new Error('Open up to 100 MLIR files at once.');
      if(files.reduce((n,f)=>n+f.size,0)>32*1024*1024)throw new Error('Combined MLIR files exceed 32 MB.');
      const loaded=[];
      for(const file of files){if(file.size>12*1024*1024)throw new Error(`${file.name} exceeds 12 MB.`);const parsed=parseIR(await file.text(),file.name);for(const f of parsed.functions)loaded.push({...f,source:file.name});}
      if(ticket!==loadingIR)return;
      irs=loaded;
      $('ir-function').innerHTML=irs.map((f,i)=>`<option value="${i}">${esc(f.name)} · ${esc(f.source)}</option>`).join('');
      $('ir-status').textContent=`${files.length} file${files.length!==1?'s':''} · ${irs.length} function view${irs.length!==1?'s':''} · imported output`;
      $('ir-workspace').hidden=false;$('binary-empty').hidden=true;$('binary-error').textContent='';
      const match=fn?irs.findIndex(x=>sameFunction(x.name,fn.name)):-1;$('ir-function').value=String(match>=0?match:0);selectIR(match>=0?match:0);
    } catch(error){if(ticket===loadingIR)$('binary-error').textContent=error.message;}
  });
  $('ir-function').addEventListener('change',()=>selectIR(Number($('ir-function').value)));
  $('ir-block').addEventListener('change',()=>{if($('ir-block').value==='')return;cfg.selectLine(Number($('ir-block').value),{jump:true});});
  $('ir-search').addEventListener('input',()=>{focusLine=-1;renderIR();});
  $('ir-find-next').addEventListener('click',()=>{
    if(!ir)return;const q=$('ir-search').value.trim().toLowerCase();if(!q)return;
    const matches=irLines.map((s,i)=>s.toLowerCase().includes(q)?i:-1).filter(i=>i>=0);
    if(!matches.length){$('ir-selected-value').textContent='No matching lines.';return;}
    focusLine=matches.find(i=>i>focusLine)??matches[0];irPage=Math.floor(focusLine/PAGE);cfg.selectLine(focusLine);renderIR();
  });
  $('ir-prev').addEventListener('click',()=>{irPage--;renderIR();});$('ir-next').addEventListener('click',()=>{irPage++;renderIR();});
  $('ir-clear-selection').addEventListener('click',()=>{selectedSSA='';renderIR();});
  $('ir-download').addEventListener('click',()=>{if(ir)download(ir.text+'\n',ir.name.replace(/[^a-z0-9_.-]/gi,'_')+'.mlir');});
  $('ir-lines').addEventListener('click',async event=>{
    const block=event.target.closest('[data-ir-cfg-block]');if(block){cfg.select(Number(block.dataset.irCfgBlock));return;}
    const token=event.target.closest('[data-ssa]');if(token){selectedSSA=token.dataset.ssa;cfg.selectLine(Number(token.closest('[data-ir-line]').dataset.irLine));renderIR();return;}
    const raw=event.target.closest('[data-ir-raw]');if(!raw)return;
    const [line,k]=raw.dataset.irRaw.split(':').map(Number),attribute=rawByLine.get(line)[k],value=attribute.value;
    const accepted=await onEncoding({side:raw.dataset.side,value,pc:attribute.pc??0,label:`${ir.name} · IR line ${ir.lineStart+line}`,architecture:ir.architecture||(ir.generatedId?cubin?.architecture||'':''),provenance:`MLIR: ${ir.source}\nFunction: ${ir.name}\nLine: ${ir.lineStart+line}\nRaw attribute: 0x${hex(value)}\n${ir.savedSnapshot?'Saved MLIR snapshot; original cubin bytes are not stored or reverified.'+(ir.digest?'\nRecorded cubin SHA-256: '+ir.digest:''):ir.generatedId?'Generated from uploaded cubin with the source-derived browser port.\nCubin SHA-256: '+ir.digest:'Imported text; binary association not verified.'}`});
    if(accepted)view('encoding');
  });
  $('opcode-folder-open').addEventListener('click',()=>$('opcode-folder').click());
  $('opcode-files-open').addEventListener('click',()=>$('opcode-files').click());
  async function loadTables(event) {
    const files=[...event.target.files].filter(f=>/\.tsv$/i.test(f.name));event.target.value='';const ticket=++loadingOpcodes;
    try {
      if(!files.length)throw new Error('No .tsv opcode files found in the selection.');
      if(files.length>5000||files.reduce((n,f)=>n+f.size,0)>48*1024*1024)throw new Error('Select at most 5,000 TSV files and 48 MB in total.');
      const result=[];
      for(const file of files){if(file.size>16*1024*1024)throw new Error(`${file.name} exceeds 16 MB.`);result.push(parseTSV(await file.text(),file.webkitRelativePath||file.name));}
      if(ticket!==loadingOpcodes)return;tables=result;opcodePage=0;remoteTables=false;
      $('opcode-architecture').innerHTML='<option>Local upload</option>';
      $('opcode-table').innerHTML=tables.map((t,i)=>`<option value="${i}">${esc(t.name)}</option>`).join('');
      $('opcode-status').textContent=`${tables.length} local tables · ${tables.reduce((n,t)=>n+t.rows.length,0).toLocaleString()} source rows · session only`;
      $('opcode-workspace').hidden=false;$('opcode-error').textContent='';renderOpcodes();
    } catch(error){if(ticket===loadingOpcodes)$('opcode-error').textContent=error.message;}
  }
  $('opcode-folder').addEventListener('change',loadTables);$('opcode-files').addEventListener('change',loadTables);
  function renderOpcodes() {
    const table=tables[Number($('opcode-table').value)];if(!table)return;
    const q=$('opcode-search').value.trim().toLowerCase(),rows=table.rows.map((cells,index)=>({cells,index})).filter(x=>x.cells.some(c=>c.toLowerCase().includes(q)));
    opcodePage=Math.min(opcodePage,Math.max(0,Math.ceil(rows.length/PAGE)-1));
    const start=opcodePage*PAGE,selected=rows.slice(start,start+PAGE);
    $('opcode-grid').innerHTML='<thead><tr><th>ROW</th>'+Array.from({length:table.columns},(_,i)=>`<th>${esc(table.headers?.[i]??'COLUMN '+(i+1))}</th>`).join('')+'</tr></thead><tbody>'+selected.map(r=>`<tr><td>${r.index+1}</td>${Array.from({length:table.columns},(_,i)=>`<td>${esc(r.cells[i]??'')}</td>`).join('')}</tr>`).join('')+'</tbody>';
    $('opcode-page').textContent=`${rows.length?start+1:0}–${Math.min(start+PAGE,rows.length)} of ${rows.length.toLocaleString()} rows`;
    $('opcode-prev').disabled=opcodePage===0;$('opcode-next').disabled=start+PAGE>=rows.length;
  }
  async function loadSourceTable() {
    const index=Number($('opcode-table').value),meta=sourceMetas[index],current=++loadingOpcodes;
    if(!meta)return;$('opcode-status').textContent='Loading '+meta.path+'…';
    try {
      if(!tables[index])tables[index]=parseTSV(await sourceTable(meta),meta.path);
      if(current!==loadingOpcodes)return;
      opcodePage=0;$('opcode-workspace').hidden=false;$('opcode-error').textContent='';
      $('opcode-status').textContent=`${sourceCatalog.architectures.length} architectures · ${sourceCatalog.tableCount} bundled TSVs · ${sourceCatalog.opcodeCount.toLocaleString()} opcodes · ${meta.path}`;
      renderOpcodes();
    }catch(error){if(current===loadingOpcodes)$('opcode-error').textContent=error.message;}
  }
  function sourceArchitecture() {
    sourceMetas=sourceCatalog.files.filter(f=>f.arch===$('opcode-architecture').value&&f.kind.endsWith('.tsv'));
    tables=[];remoteTables=true;
    $('opcode-table').innerHTML=sourceMetas.map((f,i)=>`<option value="${i}">${esc(f.kind)} · ${f.rows.toLocaleString()} rows</option>`).join('');
    const index=sourceMetas.findIndex(f=>f.kind==='opcodes.tsv');$('opcode-table').value=String(Math.max(0,index));
    loadSourceTable();
  }
  $('opcode-architecture').addEventListener('change',sourceArchitecture);
  $('opcode-table').addEventListener('change',()=>{opcodePage=0;if(remoteTables)loadSourceTable();else renderOpcodes();});$('opcode-search').addEventListener('input',()=>{opcodePage=0;renderOpcodes();});
  $('opcode-prev').addEventListener('click',()=>{opcodePage--;renderOpcodes();});$('opcode-next').addEventListener('click',()=>{opcodePage++;renderOpcodes();});
  catalog().then(data=>{
    sourceCatalog=data;
    $('opcode-architecture').innerHTML=data.architectures.map(a=>`<option>${esc(a.name)}</option>`).join('')+'<option value="global">Shared tables</option>';
    $('opcode-architecture').value=data.architectures.some(a=>a.name==='SM90')?'SM90':data.architectures[0].name;
    // Data browsing stays lazy until the tab is first opened.
    $('opcode-status').textContent=`${data.architectures.length} architectures · ${data.tableCount} bundled TSVs · ${data.opcodeCount.toLocaleString()} opcodes`;
    document.querySelector('[data-view="opcodes"]').addEventListener('click',()=>{if(!sourceMetas.length)sourceArchitecture();});
  }).catch(error=>{$('opcode-error').textContent='Bundled source unavailable: '+error.message;});
  if(globalThis.location?.hash==='#attention-view')view('attention');
  return {
    view,
    snapshot(kind){return kind==='compare'?comparison.snapshot():{functions:ir?[ir]:[],settings:{block:cfg.selected?.id??null,query:$('ir-search').value,page:irPage}};},
    restore(record){
      if(record.kind==='compare'){comparison.restore(record.data);return;}
      const data=record.data,sourceFn=data.functions[0],restored={...parseIR(sourceFn.text,sourceFn.source).functions[0],...sourceFn,savedSnapshot:true};
      loadingIR++;loadingCubin++;cancelLift();cubin=null;fn=null;irs=[restored];ir=null;
      $('cubin-workspace').hidden=true;$('cubin-status').textContent='Saved function view · original cubin not loaded';$('binary-error').textContent='';
      $('ir-function').innerHTML=`<option value="0">${esc(restored.name)} · ${esc(restored.source)}</option>`;
      $('ir-workspace').hidden=false;$('binary-empty').hidden=true;$('ir-status').textContent='Restored selected-function MLIR and CFG from the notebook.';
      selectIR(0);if(data.settings.block!==null)cfg.select(data.settings.block,{jump:false,record:false});
      $('ir-search').value=data.settings.query;irPage=Math.min(data.settings.page,Math.floor((irLines.length-1)/PAGE));renderIR();view('binary');
    }
  };
}
