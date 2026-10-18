import {parseIR,rawAttributes,ssaTokens} from './ir.mjs';
import {mountCFG} from './cfg-ui.mjs';
import {layoutCFG} from './cfg.mjs';
import {diffLines,compareCFG} from './compare.mjs';
import {parseCubin} from './cubin.mjs';
import {startCubinLift} from './runtime/lift-task.mjs';
const $=id=>document.getElementById(id),PAGE=128;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const other=side=>side==='a'?'b':'a';
export function mountIRComparison({onEncoding,showCompare,showEncoding,onChange=()=>{}}){
  const panes={};let topology=null,alignment=null,rows=[],visible=[],page=0,focus=-1,activePair=0,syncing=false,viewLayout=null;
  for(const side of ['a','b']){
    const p=panes[side]={functions:[],index:0,fn:null,lines:[],raw:new Map(),ssa:'',ticket:0,task:null};
    p.cfg=mountCFG({prefix:`compare-${side}-cfg`,onSelect:event=>selectBlock(side,event),mapView:({graph})=>{
      if(!topology||!viewLayout)return null;const positions=new Map();for(const block of graph.blocks){const pos=viewLayout.positions.get(topology.maps[side].get(block.id));if(pos)positions.set(block.id,pos);}
      return {layout:{...viewLayout,positions,total:graph.blocks.length},nodes:topology.nodes[side],edges:topology.edgeStatus[side],caption:`${$('compare-match').value==='order'?'Source-order':'Exact-label'} pairing; matching blocks share positions${viewLayout.full?'':'; nearby blocks shown'}`};
    }});
    $(`compare-${side}-open`).addEventListener('click',()=>$(`compare-${side}-files`).click());
    $(`compare-${side}-files`).addEventListener('change',event=>loadFiles(side,event));
    $(`compare-${side}-cubin-open`).addEventListener('click',()=>$(`compare-${side}-cubin`).click());
    $(`compare-${side}-cubin`).addEventListener('change',event=>loadCubin(side,event));
    $(`compare-${side}-cancel`).addEventListener('click',()=>{stopTask(side);$(`compare-${side}-status`).textContent='Lifting cancelled. Generate the selected function to try again.';$(`compare-${side}-retry`).hidden=false;});
    $(`compare-${side}-retry`).addEventListener('click',()=>chooseFunction(side,p.index));
    $(`compare-${side}-function`).addEventListener('change',()=>chooseFunction(side,Number($(`compare-${side}-function`).value)));
    $(`compare-${side}-block`).addEventListener('change',()=>{const value=$(`compare-${side}-block`).value;if(value!=='')p.cfg.select(Number(value));});
    $(`compare-${side}-source`).addEventListener('click',async event=>{
      const block=event.target.closest('[data-compare-block]');if(block){p.cfg.select(Number(block.dataset.compareBlock));return;}
      const token=event.target.closest('[data-compare-ssa]');if(token){p.ssa=token.dataset.compareSsa;renderRows();return;}
      const raw=event.target.closest('[data-compare-raw]');if(!raw)return;const [line,index]=raw.dataset.compareRaw.split(':').map(Number),attribute=p.raw.get(line)?.[index];if(!attribute)return;
      const accepted=await onEncoding({side,value:attribute.value,pc:attribute.pc??0,label:`${p.fn.name} · comparison ${side.toUpperCase()} · L${p.fn.lineStart+line}`,architecture:p.fn.architecture||'',provenance:`MLIR comparison ${side.toUpperCase()}: ${p.fn.source}\nFunction: ${p.fn.name}\nLine: ${p.fn.lineStart+line}${p.fn.digest?'\nCubin SHA-256: '+p.fn.digest:''}\n${p.fn.savedSnapshot?'Saved MLIR snapshot; binary association not reverified.':p.fn.generatedId?'Source-derived browser lift.':'Imported source; binary association not verified.'}`});if(accepted)showEncoding();
    });
    $(`compare-${side}-source`).addEventListener('scroll',()=>{if(!$('compare-scroll').checked)return;const a=$(`compare-${side}-source`),b=$(`compare-${other(side)}-source`);if(Math.abs(b.scrollTop-a.scrollTop)>1)b.scrollTop=a.scrollTop;});
  }
  function selectBlock(side,{block,jump,reveal}){
    $(`compare-${side}-block`).value=String(block.id);if(syncing)return;
    activePair=topology?.maps[side].get(block.id)??0;
    if($('compare-linked').checked&&topology){const target=topology.pairs[activePair][other(side)];syncing=true;if(target!==null)panes[other(side)].cfg.select(target,{jump:false,record:false});else{panes[other(side)].cfg.deselect();$(`compare-${other(side)}-block`).value='';}syncing=false;}
    refreshMaps();if($('compare-scope').value==='blocks')buildDiff();else renderRows();
    if(jump)jumpToLine(side,block.line);
    if(reveal)$('compare-source-heading').scrollIntoView({block:'start',behavior:'smooth'});
  }
  function refreshMaps(){
    viewLayout=topology?layoutCFG(topology.union,Math.min(activePair,topology.pairs.length-1)):null;
    for(const p of Object.values(panes))p.cfg.refresh();
  }
  function prepare(fn){
    let count=1;for(const c of fn.text)if(c==='\n'&&++count>100000)throw new Error('A comparison function exceeds 100,000 source lines.');
    const lines=fn.text.split(/\r?\n/),raw=new Map();for(const [index,r] of rawAttributes(fn.text).entries()){if(fn.generatedId)r.pc=index*16;if(!raw.has(r.line))raw.set(r.line,[]);raw.get(r.line).push(r);}return {lines,raw};
  }
  function functionOptions(side){const p=panes[side],select=$(`compare-${side}-function`);select.innerHTML=p.functions.map((f,i)=>`<option value="${i}">${esc(f.name)} · ${esc(f.source)}</option>`).join('');select.disabled=!p.functions.length;}
  function stopTask(side){const p=panes[side];p.ticket++;if(p.task)$(`compare-${side}-status`).textContent='Lifting cancelled.';p.task?.cancel();p.task=null;$(`compare-${side}-cancel`).hidden=true;$(`compare-${side}-retry`).hidden=true;}
  function clearPane(side){
    const p=panes[side];topology=null;viewLayout=null;p.fn=null;p.lines=[];p.raw=new Map();p.ssa='';p.cfg.clear();$(`compare-${side}-meta`).textContent='No source loaded';$(`compare-${side}-block`).innerHTML='<option>No CFG loaded</option>';$(`compare-${side}-block`).disabled=true;$(`compare-${side}-error`).textContent='';$(`compare-${side}-status`).textContent='';
  }
  function displayFunction(side,fn){
    const p=panes[side];
    try{const data=prepare(fn);topology=null;viewLayout=null;p.fn=fn;p.lines=data.lines;p.raw=data.raw;p.ssa='';p.cfg.load(fn.text,fn.lineStart);$(`compare-${side}-function`).value=String(p.index);$(`compare-${side}-block`).innerHTML='<option value="">Choose a block…</option>'+(p.cfg.graph?.blocks||[]).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('');$(`compare-${side}-block`).disabled=!p.cfg.graph;$(`compare-${side}-block`).value=p.cfg.selected?String(p.cfg.selected.id):'';$(`compare-${side}-meta`).textContent=`${fn.source} · ${fn.name} · ${p.lines.length.toLocaleString()} lines${fn.digest?' · SHA-256 '+fn.digest:''}`;$(`compare-${side}-error`).textContent='';rebuild();}
    catch(error){$(`compare-${side}-error`).textContent=error.message;}
  }
  async function chooseFunction(side,index){
    const p=panes[side],entry=p.functions[index];if(!entry)return;
    stopTask(side);const ticket=p.ticket;p.index=index;$(`compare-${side}-function`).value=String(index);$(`compare-${side}-status`).textContent='';$(`compare-${side}-error`).textContent='';
    if(!entry.binary){displayFunction(side,entry);return;}
    const {binary,entry:fn}=entry;
    clearPane(side);$(`compare-${side}-meta`).textContent=`${binary.name} · ${binary.cubin.architecture} · ${fn.name} · ${fn.count.toLocaleString()} instructions`;rebuild();
    try{
      let generated=binary.cache.get(fn.id);
      if(!generated){
        $(`compare-${side}-status`).textContent='Loading decoder tables and generating MLIR in your browser…';$(`compare-${side}-cancel`).hidden=false;
        const task=p.task=startCubinLift(binary.cubin,fn),result=await task.promise;
        if(ticket!==p.ticket)return;
        generated={...parseIR(result.text,binary.name).functions[0],source:binary.name+' · browser JavaScript lift',architecture:binary.cubin.architecture,generatedId:fn.id,digest:binary.digest,stats:result.stats};
        prepare(generated);binary.cache.set(fn.id,generated);if(binary.cache.size>4)binary.cache.delete(binary.cache.keys().next().value);
      }
      if(ticket!==p.ticket)return;displayFunction(side,generated);
      const s=generated.stats;$(`compare-${side}-status`).textContent=`${s.decoded.toLocaleString()}/${s.instructions.toLocaleString()} decoded · ${s.raw} raw carriers · ${s.blocks} blocks${s.unresolved?' · '+s.unresolved+' unresolved transfers':''}${s.tail?' · '+s.tail+' tail bytes retained':''}. Experimental browser lift; native MLIR parse-check has not been run.`+(binary.cubin.warnings.length?' '+binary.cubin.warnings.join(' '):'');
    }catch(error){if(ticket===p.ticket){$(`compare-${side}-error`).textContent=error.message;$(`compare-${side}-status`).textContent='MLIR generation did not complete.';$(`compare-${side}-retry`).hidden=false;}}
    finally{if(ticket===p.ticket){p.task=null;$(`compare-${side}-cancel`).hidden=true;}}
  }
  const symbolName=name=>name.replace(/^\.text\./,'');
  function preferredFunction(side,functions){const name=panes[other(side)].functions[panes[other(side)].index]?.name,match=functions.findIndex(f=>symbolName(f.name)===symbolName(name||''));return Math.max(0,match);}
  async function loadCubin(side,event){
    const p=panes[side],file=event.target.files[0];event.target.value='';if(!file)return;stopTask(side);const ticket=p.ticket;
    try{
      if(file.size>64*1024*1024)throw new Error('Cubin exceeds the 64 MB limit.');
      const bytes=await file.arrayBuffer();if(ticket!==p.ticket)return;const cubin=parseCubin(bytes);
      if(!cubin.canSlice)throw new Error('Browser lifting requires Volta or newer 128-bit SASS.');
      const digest=globalThis.crypto?.subtle?[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''):'';
      if(ticket!==p.ticket)return;const binary={cubin,name:file.name,digest,cache:new Map()};
      p.functions=cubin.functions.map(entry=>({name:entry.name,source:`${file.name} · ${cubin.architecture} · ${entry.count.toLocaleString()} instructions`,binary,entry}));
      functionOptions(side);chooseFunction(side,preferredFunction(side,p.functions));
    }catch(error){if(ticket===p.ticket){$(`compare-${side}-error`).textContent=error.message;if(p.functions[p.index]?.binary&&!p.fn)$(`compare-${side}-retry`).hidden=false;}}
  }
  async function loadFiles(side,event){
    const p=panes[side],files=[...event.target.files];event.target.value='';if(!files.length)return;stopTask(side);const ticket=p.ticket;
    try{if(files.length>100||files.reduce((n,f)=>n+f.size,0)>32*1024*1024)throw new Error('Open up to 100 files and 32 MB per side.');const functions=[];
      for(const file of files){if(file.size>12*1024*1024)throw new Error(`${file.name} exceeds 12 MB.`);const parsed=parseIR(await file.text(),file.name);for(const fn of parsed.functions)functions.push({...fn,source:file.name});}
      if(ticket!==p.ticket)return;const index=preferredFunction(side,functions);prepare(functions[index]);p.functions=functions;functionOptions(side);chooseFunction(side,index);
    }catch(error){if(ticket===p.ticket){$(`compare-${side}-error`).textContent=error.message;if(p.functions[p.index]?.binary&&!p.fn)$(`compare-${side}-retry`).hidden=false;}}
  }
  function rebuild(){
    topology=null;activePair=0;focus=-1;page=0;$('compare-error').textContent='';
    const a=panes.a,b=panes.b;
    if(a.fn&&b.fn&&a.cfg.graph&&b.cfg.graph)topology=compareCFG(a.cfg.graph,b.cfg.graph,a.fn.text,b.fn.text,$('compare-match').value);
    $('compare-swap').disabled=!a.functions.length&&!b.functions.length;
    $('compare-save-experiment').disabled=!a.fn||!b.fn;
    if(topology){const t=topology;$('compare-cfg-summary').textContent=`CFG: ${t.changedBlocks} changed blocks · −${t.removedBlocks} A-only / +${t.addedBlocks} B-only blocks · −${t.removedEdges} / +${t.addedEdges} edges · ${t.commonEdges} shared edges${a.cfg.graph.incomplete||b.cfg.graph.incomplete?' · incomplete MLIR edge extraction':''}${a.cfg.graph.unresolved||b.cfg.graph.unresolved?' · unresolved SASS targets A: '+a.cfg.graph.unresolved+', B: '+b.cfg.graph.unresolved:''}`;
      const changes=[];for(const side of ['a','b'])for(const e of panes[side].cfg.graph.edges){const status=t.edgeStatus[side].get(e.id);if(status==='added'||status==='removed')changes.push({side,e,status});}
      $('compare-edge-details').hidden=!changes.length;$('compare-edge-list').innerHTML=changes.slice(0,300).map(({side,e,status})=>`<button data-compare-edge-side="${side}" data-compare-edge-from="${e.from}" class="diff-${status}">${status==='added'?'+':'−'} ${side.toUpperCase()} ${esc(panes[side].cfg.graph.blocks[e.from].name)} · ${esc(e.label)} → ${esc(e.target)}</button>`).join('');$('compare-edge-note').textContent=changes.length>300?`Showing 300 of ${changes.length} edge changes. All edges remain traversable in the block panels.`:'';
    }else{$('compare-cfg-summary').textContent=a.fn&&b.fn?'CFG comparison unavailable for one of these functions; the source diff remains available.':'Both CFGs will appear here once versions are loaded.';$('compare-edge-details').hidden=true;$('compare-edge-list').innerHTML='';}
    refreshMaps();buildDiff();
  }
  function buildDiff(){
    const a=panes.a,b=panes.b;alignment=null;rows=[];focus=-1;page=0;
    if(!a.fn||!b.fn){$('compare-summary').textContent='Choose versions A and B to compare their source and CFGs.';renderRows();return;}
    try{
      const scope=$('compare-scope').value==='blocks',ranges={};
      for(const side of ['a','b']){const p=panes[side],block=p.cfg.selected;ranges[side]=scope?(block?{lines:p.lines.slice(block.line,block.endLine+1),offset:block.line}:{lines:[],offset:0}):{lines:p.lines,offset:0};}
      alignment=diffLines(ranges.a.lines,ranges.b.lines);rows=alignment.rows.map((row,index)=>({...row,index,a:row.a===null?null:row.a+ranges.a.offset,b:row.b===null?null:row.b+ranges.b.offset}));
      $('compare-summary').textContent=`IR: −${alignment.removed.toLocaleString()} lines from A / +${alignment.added.toLocaleString()} lines in B · ${alignment.hunks.length} edit groups${!alignment.hunks.length?' · identical source':''}${scope?' · selected blocks':''}${alignment.grouped?' · large edits grouped; alignment is coarse':''}`;$('compare-error').textContent='';
    }catch(error){$('compare-error').textContent=error.message;$('compare-summary').textContent='Source alignment could not be generated.';}
    renderRows();
  }
  function lineHTML(side,line){
    const p=panes[side],tokens=[...ssaTokens(p.lines[line]),...p.cfg.tokens(line).map(t=>({...t,kind:'block'}))].sort((a,b)=>a.start-b.start);let out='',at=0;
    for(const t of tokens){if(t.start<at)continue;out+=esc(p.lines[line].slice(at,t.start));out+=t.kind==='block'?`<button class="ir-block-token" data-compare-block="${t.block}">${esc(p.lines[line].slice(t.start,t.end))}</button>`:`<button class="ssa-token${p.ssa===t.value?' selected-ssa':''}" data-compare-ssa="${esc(t.value)}">${esc(t.value)}</button>`;at=t.end;}return out+esc(p.lines[line].slice(at));
  }
  function renderRows(){
    visible=rows.filter(r=>!$('compare-changes-only').checked||r.status!=='same');page=Math.max(0,Math.min(page,Math.ceil(visible.length/PAGE)-1));const chunk=visible.slice(page*PAGE,(page+1)*PAGE);
    for(const side of ['a','b']){const p=panes[side];$(`compare-${side}-source-title`).textContent=p.fn?`${side.toUpperCase()} · ${p.fn.name} · ${p.fn.source}`:`${side.toUpperCase()} · waiting for source`;
      $(`compare-${side}-source`).innerHTML=chunk.length?chunk.map(r=>{const line=r[side],removed=side==='a'&&r.status!=='same'&&line!==null,added=side==='b'&&r.status!=='same'&&line!==null,block=p.cfg.selected,current=block&&line!==null&&line>=block.line&&line<=block.endLine;return `<div class="comparison-line${removed?' diff-line-removed':''}${added?' diff-line-added':''}${current?' comparison-block-active':''}${r.index===focus?' comparison-focused':''}${line===null?' comparison-gap':''}" data-comparison-row="${r.index}"><span class="comparison-line-number">${line===null?'—':p.fn.lineStart+line}</span><span class="comparison-change-mark">${removed?'−':added?'+':' '}</span><code>${line===null?' ':lineHTML(side,line)||' '}</code>${line!==null?(p.raw.get(line)||[]).map((_,i)=>`<button class="encoding-pick pick-${side}" data-compare-raw="${line}:${i}" aria-label="Send raw encoding on version ${side.toUpperCase()} line ${p.fn.lineStart+line} to encoding ${side.toUpperCase()}">${side.toUpperCase()}</button>`).join(''):''}</div>`;}).join(''):`<p class="comparison-empty">${alignment?rows.length?'No changed lines.':'No source lines in this scope.':'Load both versions to display aligned source.'}</p>`;
    }
    $('compare-page').textContent=`Rows ${visible.length?page*PAGE+1:0}–${Math.min((page+1)*PAGE,visible.length)} of ${visible.length.toLocaleString()}`;$('compare-page-prev').disabled=page===0;$('compare-page-next').disabled=(page+1)*PAGE>=visible.length;
    $('compare-change-prev').disabled=!alignment?.hunks.length;$('compare-change-next').disabled=!alignment?.hunks.length;
    onChange();
  }
  function focusRow(index){focus=index;if(!visible.some(r=>r.index===index)){$('compare-changes-only').checked=false;visible=rows;}const position=visible.findIndex(r=>r.index===index);if(position<0)return;page=Math.floor(position/PAGE);renderRows();for(const side of ['a','b'])$(`compare-${side}-source`).scrollTop=position%PAGE*24;}
  function jumpToLine(side,line){const row=rows.find(r=>r[side]===line);if(row)focusRow(row.index);}
  $('compare-match').addEventListener('change',()=>rebuild());$('compare-scope').addEventListener('change',()=>buildDiff());
  $('compare-linked').addEventListener('change',()=>{if($('compare-linked').checked&&panes.a.cfg.selected)selectBlock('a',{block:panes.a.cfg.selected,jump:false});onChange();});
  $('compare-scroll').addEventListener('change',onChange);
  $('compare-changes-only').addEventListener('change',()=>{page=0;renderRows();});
  $('compare-clear-ssa').addEventListener('click',()=>{panes.a.ssa='';panes.b.ssa='';renderRows();});
  $('compare-page-prev').addEventListener('click',()=>{if(page>0){page--;renderRows();for(const s of ['a','b'])$(`compare-${s}-source`).scrollTop=0;}});
  $('compare-page-next').addEventListener('click',()=>{if((page+1)*PAGE<visible.length){page++;renderRows();for(const s of ['a','b'])$(`compare-${s}-source`).scrollTop=0;}});
  for(const [id,direction] of [['compare-change-prev',-1],['compare-change-next',1]])$(id).addEventListener('click',()=>{const list=alignment?.hunks;if(!list?.length)return;const next=direction>0?list.find(i=>i>focus)??list[0]:list.findLast(i=>i<focus)??list.at(-1);focusRow(next);});
  $('compare-edge-list').addEventListener('click',event=>{const el=event.target.closest('[data-compare-edge-from]');if(el)panes[el.dataset.compareEdgeSide].cfg.select(Number(el.dataset.compareEdgeFrom));});
  $('compare-swap').addEventListener('click',()=>{const a=panes.a,b=panes.b,oldA=a.functions,oldB=b.functions,ai=a.index,bi=b.index;for(const side of ['a','b']){stopTask(side);clearPane(side);}a.functions=oldB;b.functions=oldA;for(const side of ['a','b'])functionOptions(side);if(a.functions.length)chooseFunction('a',bi);if(b.functions.length)chooseFunction('b',ai);rebuild();});
  return {
    snapshot(){return {functions:[panes.a.fn,panes.b.fn].filter(Boolean),settings:{match:$('compare-match').value,scope:$('compare-scope').value,linked:$('compare-linked').checked,scroll:$('compare-scroll').checked,changesOnly:$('compare-changes-only').checked,blocks:[panes.a.cfg.selected?.id??null,panes.b.cfg.selected?.id??null]}};},
    restore(data){
      const functions=data.functions.map(fn=>({...parseIR(fn.text,fn.source).functions[0],...fn,savedSnapshot:true}));
      functions.forEach(prepare);
      for(const side of ['a','b']){stopTask(side);clearPane(side);}
      const s=data.settings;
      $('compare-match').value=s.match;$('compare-scope').value=s.scope;$('compare-linked').checked=s.linked;$('compare-scroll').checked=s.scroll;$('compare-changes-only').checked=s.changesOnly;
      for(const [index,side] of ['a','b'].entries()){
        const p=panes[side];p.functions=[functions[index]];p.index=0;functionOptions(side);displayFunction(side,functions[index]);
        $(`compare-${side}-status`).textContent='Restored MLIR snapshot; original cubin bytes are not stored.';
      }
      syncing=true;
      try{for(const [index,side] of ['a','b'].entries()){
        if(s.blocks[index]===null){panes[side].cfg.deselect();$(`compare-${side}-block`).value='';}
        else panes[side].cfg.select(s.blocks[index],{jump:false,record:false});
      }}
      finally{syncing=false;}
      rebuild();activePair=topology?.maps.a.get(panes.a.cfg.selected?.id)??topology?.maps.b.get(panes.b.cfg.selected?.id)??0;refreshMaps();showCompare();
    },
    capture(side,fn){const p=panes[side],snapshot={...fn,lineStart:fn.lineStart||1,source:fn.source||'Explorer snapshot'};try{prepare(snapshot);stopTask(side);p.functions=[snapshot];functionOptions(side);chooseFunction(side,0);}catch(error){$(`compare-${side}-error`).textContent=error.message;}showCompare();}
  };
}
