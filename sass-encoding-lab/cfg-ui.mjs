import {parseCFG,cfgBlockAtLine,layoutCFG} from './cfg.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shorten=(s,n=23)=>s.length>n?s.slice(0,n-1)+'…':s;
export function mountCFG({onSelect,prefix='cfg',mapView=null}){
  const $=id=>document.getElementById(id.replace(/^cfg/,prefix));
  let graph=null,selected=-1,history=[],cursor=-1,visited=new Set(),zoom=1,lastLayout=null,lineStart=1;
  function drawMap(){
    if(!graph)return;const decoration=mapView?.({graph,selected})||{},layout=decoration.layout||layoutCFG(graph,Math.max(0,selected));lastLayout=layout;
    const paths=[];for(const e of graph.edges){const from=layout.positions.get(e.from),to=layout.positions.get(e.to);if(!from||!to)continue;
      const x=from.x+75,y=from.y+62,tx=to.x+75,ty=to.y;let d,lx,ly;
      if(e.to===e.from){const right=from.x+150;d=`M ${right} ${from.y+42} C ${right+40} ${from.y+42} ${right+40} ${from.y-14} ${right-20} ${from.y-14} L ${right-20} ${from.y}`;lx=right+15;ly=from.y-6;}
      else if(ty>from.y){const mid=(y+ty)/2;d=`M ${x} ${y} C ${x} ${mid} ${tx} ${mid} ${tx} ${ty}`;lx=(x+tx)/2+(e.id%2?8:-8);ly=mid-4;}
      else{const side=layout.width-22-(e.id%3)*9;d=`M ${from.x+150} ${from.y+31} C ${side} ${from.y+31} ${side} ${to.y+31} ${to.x+150} ${to.y+31}`;lx=side-10;ly=(from.y+to.y)/2+20;}
      const label=e.label==='Branch'?(e.cycle?'↻':''):shorten(e.label,16),active=e.from===selected||e.to===selected;
      paths.push(`<g class="cfg-edge${active?' cfg-edge-active':''}${e.cycle?' cfg-cycle-edge':''}${decoration.edges?.get(e.id)?' cfg-diff-'+decoration.edges.get(e.id):''}"><path d="${d}" marker-end="url(#${prefix}-arrow)"/>${label?`<text x="${lx}" y="${ly}" text-anchor="middle">${esc(label)}</text>`:''}</g>`);
    }
    const nodes=[...layout.positions].map(([id,p])=>{const b=graph.blocks[id],status=decoration.nodes?.get(id),meta=`${b.operations.length} ops · ${b.terminator}`;return `<g class="cfg-node${id===selected?' cfg-node-selected':''}${visited.has(id)?' cfg-node-visited':''}${!b.reachable?' cfg-node-unreached':''}${b.warnings.length?' cfg-node-partial':''}${status?' cfg-diff-'+status:''}" data-cfg-node="${id}" role="button" tabindex="0" aria-pressed="${id===selected}" aria-label="${esc(b.name)}; ${b.operations.length} operations${status?'; '+status:''}${b.unresolved?'; unresolved transfer':''}${b.inCycle?'; cycle':''}"><title>${esc(b.name+' · '+meta+(status?' · '+status:''))}</title><rect x="${p.x}" y="${p.y}" width="150" height="62" rx="8"/><text class="cfg-node-name" x="${p.x+11}" y="${p.y+24}">${esc(shorten(b.name,19))}</text><text class="cfg-node-meta" x="${p.x+11}" y="${p.y+45}">${esc(shorten(meta,23))}</text><text class="cfg-node-marker" x="${p.x+139}" y="${p.y+14}" text-anchor="end">${id===0?'entry ':''}${b.inCycle?'↻ ':''}${b.warnings.length?'?':''}${status==='added'?'+':status==='removed'?'−':status==='changed'?'Δ':''}</text></g>`;}).join('');
    $('cfg-map').innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" style="width:${layout.width*zoom}px;height:${layout.height*zoom}px" role="group" aria-label="Interactive function control-flow graph"><defs><marker id="${prefix}-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M 0 0 L 7 3.5 L 0 7 z"/></marker></defs>${paths.join('')}${nodes}</svg>`;
    $('cfg-map-caption').textContent=(decoration.caption||(layout.full?'All '+graph.blocks.length+' blocks':`${layout.positions.size} nearby blocks of ${layout.total}; all edges remain available below`))+'. Scroll to pan. Select a block to view its IR.';
  }
  function edgeButton(e,incoming){const target=incoming?e.from:e.to,b=target!==null?graph.blocks[target]:null,body=b?b.name:e.target+' · missing or ambiguous';return `<button class="cfg-link" ${b?`data-cfg-target="${target}"`:'disabled'} title="${esc(e.operands.slice(0,1024))}"><span><span class="cfg-edge-kind">${esc(e.label)}</span>${incoming?'←':'→'} <strong>${esc(body)}</strong>${e.cycle?' <span class="cfg-loop-tag">cycle</span>':''}</span>${e.condition?`<small>condition ${esc(e.condition)}</small>`:''}${e.operands?`<small class="mono">args: ${esc(shorten(e.operands,130))}</small>`:''}</button>`;}
  function render(){
    if(!graph)return;const b=graph.blocks[selected];
    const knownEdges=graph.edges.filter(e=>e.to!==null).length;
    $('cfg-summary').textContent=`${graph.blocks.length} block${graph.blocks.length===1?'':'s'} · ${knownEdges} known edge${knownEdges===1?'':'s'}${graph.incomplete?' · incomplete MLIR CFG':''}${graph.unresolved?' · '+graph.unresolved+' unresolved SASS target'+(graph.unresolved===1?'':'s'):''}`;
    $('cfg-issues').innerHTML=graph.blocks.filter(x=>x.warnings.length).map(x=>`<button class="cfg-issue-link" data-cfg-issue="${x.id}" title="${esc(x.warnings.join(' '))}">${esc(x.name)}${x.unresolvedMnemonic?' · '+esc(x.unresolvedMnemonic):''}</button>`).join('');
    $('cfg-visited').textContent=`${visited.size}/${graph.blocks.length} visited`;
    $('cfg-back').disabled=cursor<=0;$('cfg-forward').disabled=cursor>=history.length-1;$('cfg-entry').disabled=false;$('cfg-show-ir').disabled=false;
    $('cfg-zoom-out').disabled=zoom<=.6;$('cfg-zoom-in').disabled=zoom>=1.6;$('cfg-zoom').textContent=Math.round(zoom*100)+'%';
    if(!b){$('cfg-selected-name').textContent='No matching block';$('cfg-selected-meta').textContent='Choose a block independently or change the matching mode.';$('cfg-args').hidden=true;$('cfg-predecessors').innerHTML='';$('cfg-successors').innerHTML='';$('cfg-warning').hidden=true;$('cfg-show-ir').disabled=true;$('cfg-history').innerHTML='';drawMap();return;}
    $('cfg-selected-name').textContent=b.name;
    $('cfg-selected-meta').textContent=`L${lineStart+b.line}–${lineStart+b.endLine} · ${b.operations.length} ops · ${b.argCount} arguments · ${b.terminator}${b.inCycle?' · in a cycle':''}${!b.reachable?' · not reached by known edges':''}`;
    $('cfg-args').hidden=!b.args.trim();$('cfg-args-text').textContent=b.args.trim();
    $('cfg-predecessors').innerHTML=b.predecessors.length?b.predecessors.map(i=>edgeButton(graph.edges[i],true)).join(''):'<p class="cfg-no-edges">'+(selected===0?'Function entry':'No known predecessors')+'</p>';
    $('cfg-successors').innerHTML=b.successors.length?b.successors.map(i=>edgeButton(graph.edges[i],false)).join(''):'<p class="cfg-no-edges">'+(b.unresolved?'Unknown target':b.kind==='exit'?'Terminal block':'Outgoing flow unknown')+'</p>';
    $('cfg-warning').textContent=[...graph.warnings,...b.warnings].join(' ');$('cfg-warning').hidden=!$('cfg-warning').textContent;
    const begin=Math.max(0,cursor-5),finish=Math.min(history.length,cursor+4);
    $('cfg-history').innerHTML=history.slice(begin,finish).map((id,i)=>`<button data-cfg-history="${begin+i}" ${begin+i===cursor?'aria-current="step"':''}>${esc(graph.blocks[id].name)}</button>`).join('<span aria-hidden="true">›</span>');
    drawMap();
  }
  function select(id,{jump=true,record=true,repeat=false,reveal=false}={}){
    if(!graph?.blocks[id])return;
    if(record&&(id!==selected||repeat)){history=history.slice(0,cursor+1);history.push(id);if(history.length>1000)history.shift();cursor=history.length-1;}
    selected=id;visited.add(id);render();
    const p=lastLayout?.positions.get(id);if(p){$('cfg-map').scrollTop=Math.max(0,p.y*zoom-($('cfg-map').clientHeight||320)/2+31*zoom);$('cfg-map').scrollLeft=Math.max(0,p.x*zoom-($('cfg-map').clientWidth||400)/2+75*zoom);}
    onSelect({block:graph.blocks[id],jump,reveal});
  }
  $('cfg-map').addEventListener('click',event=>{const node=event.target.closest('[data-cfg-node]');if(node)select(Number(node.dataset.cfgNode));});
  $('cfg-map').addEventListener('keydown',event=>{const node=event.target.closest('[data-cfg-node]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();const id=Number(node.dataset.cfgNode);select(id);$('cfg-map').querySelector(`[data-cfg-node="${id}"]`)?.focus({preventScroll:true});}});
  for(const name of ['cfg-predecessors','cfg-successors'])$(name).addEventListener('click',event=>{const button=event.target.closest('[data-cfg-target]');if(button)select(Number(button.dataset.cfgTarget),{repeat:true});});
  $('cfg-history').addEventListener('click',event=>{const button=event.target.closest('[data-cfg-history]');if(button){cursor=Number(button.dataset.cfgHistory);select(history[cursor],{record:false});}});
  $('cfg-back').addEventListener('click',()=>{if(cursor>0){cursor--;select(history[cursor],{record:false});}});
  $('cfg-forward').addEventListener('click',()=>{if(cursor<history.length-1){cursor++;select(history[cursor],{record:false});}});
  $('cfg-entry').addEventListener('click',()=>select(0));$('cfg-show-ir').addEventListener('click',()=>select(selected,{reveal:true}));
  $('cfg-issues').addEventListener('click',event=>{const button=event.target.closest('[data-cfg-issue]');if(button)select(Number(button.dataset.cfgIssue));});
  $('cfg-zoom-in').addEventListener('click',()=>{zoom=Math.min(1.6,Math.round((zoom+.2)*10)/10);render();});
  $('cfg-zoom-out').addEventListener('click',()=>{zoom=Math.max(.6,Math.round((zoom-.2)*10)/10);render();});
  function clear(message='Load a function to display its CFG.'){
    graph=null;selected=-1;history=[];cursor=-1;visited=new Set();$('cfg-map').innerHTML='<p class="cfg-empty">'+esc(message)+'</p>';$('cfg-summary').textContent='CFG unavailable';$('cfg-issues').innerHTML='';$('cfg-visited').textContent='';$('cfg-selected-name').textContent='No block selected';$('cfg-selected-meta').textContent='';$('cfg-args').hidden=true;$('cfg-predecessors').innerHTML='';$('cfg-successors').innerHTML='';$('cfg-history').innerHTML='';$('cfg-warning').hidden=true;$('cfg-map-caption').textContent='The IR text remains available.';for(const id of ['cfg-back','cfg-forward','cfg-entry','cfg-show-ir','cfg-zoom-in','cfg-zoom-out'])$(id).disabled=true;
  }
  return {
    load(text,firstLine=1){
      lineStart=firstLine;history=[];cursor=-1;selected=-1;visited=new Set();zoom=1;
      try{graph=parseCFG(text);selected=0;history=[0];cursor=0;visited.add(0);render();$('cfg-map').scrollTop=0;$('cfg-map').scrollLeft=0;}
      catch(error){clear(error.message);}
    },
    select,
    clear,
    refresh(){render();},
    deselect(){selected=-1;render();},
    selectLine(line,options={jump:false}){const block=graph&&cfgBlockAtLine(graph,line);if(block)select(block.id,options);},
    get graph(){return graph;},get selected(){return graph?.blocks[selected]||null;},
    tokens(line){return graph?.tokensByLine.get(line)||[];}
  };
}
