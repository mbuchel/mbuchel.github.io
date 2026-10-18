// Structural CFG reading for one MLIR function. No inferred fallthrough edges.
import {maskStringsAndComments,parseIR} from './ir.mjs';
const branchOps=new Set(['cf.br','llvm.br','cf.cond_br','llvm.cond_br','cf.switch','llvm.switch']);
const exitOps=new Set(['sass.exit','func.return','return','llvm.return','gpu.return','gpu.terminator','cf.unreachable','llvm.unreachable']);
const labelPattern=/\^[\w.$-]+/g;
function matching(mask,start,open='(',close=')'){
  let depth=0;for(let i=start;i<mask.length;i++){if(mask[i]===open)depth++;else if(mask[i]===close&&!--depth)return i;}return -1;
}
function lineIndex(starts,pos){let low=0,high=starts.length;while(low+1<high){const mid=(low+high)>>1;if(starts[mid]<=pos)low=mid;else high=mid;}return low;}
function hideDictionaries(mask){let out='',depth=0;for(const c of mask){if(c==='{')depth++;out+=depth||c==='}'?' ':c;if(c==='}')depth=Math.max(0,depth-1);}return out;}
export function parseCFG(text){
  const parsed=parseIR(text);
  if(parsed.functions.length!==1)throw new Error('Select one function to explore its CFG.');
  const fn=parsed.functions[0],mask=maskStringsAndComments(text),start=fn.start+(fn.bodyStart??0),end=fn.start+(fn.bodyEnd??fn.text.length);
  const top=new Uint8Array(text.length),starts=[0];let braces=0,parens=0,brackets=0;
  for(let i=0;i<text.length;i++)if(text[i]==='\n')starts.push(i+1);
  for(let i=start;i<end;i++){
    const c=mask[i];if(!braces&&!parens&&!brackets)top[i]=1;
    if(c==='{')braces++;else if(c==='}')braces=Math.max(0,braces-1);
    else if(c==='(')parens++;else if(c===')')parens=Math.max(0,parens-1);
    else if(c==='[')brackets++;else if(c===']')brackets=Math.max(0,brackets-1);
  }
  const labels=[];
  for(const m of mask.slice(start,end).matchAll(labelPattern)){
    const at=start+m.index,line=lineIndex(starts,at);if(!top[at]||mask.slice(Math.max(starts[line],start),at).trim())continue;
    let next=at+m[0].length;while(/\s/.test(mask[next]||'')&&next<end)next++;
    let args='';if(mask[next]==='('){const close=matching(mask,next);if(close<0)continue;args=text.slice(next+1,close);next=close+1;while(next<end&&/\s/.test(mask[next]))next++;}
    if(mask[next]!==':')continue;
    labels.push({name:m[0],start:at,bodyStart:next+1,line,args,implicit:false});
  }
  const first=labels[0]?.start??end,before=mask.slice(start,first),nonblank=before.search(/\S/);
  if(nonblank>=0||!labels.length)labels.unshift({name:'Entry (implicit)',start:start+Math.max(0,nonblank),bodyStart:start,line:lineIndex(starts,start+Math.max(0,nonblank)),args:'',implicit:true});
  if(labels.length>5000)throw new Error('CFG traversal supports up to 5,000 blocks per function. The IR text remains available.');
  const blocks=labels.map((b,i)=>({...b,id:i,end:labels[i+1]?.start??end,endLine:Math.max(b.line,lineIndex(starts,labels[i+1]?.start??end)-1),operations:[],successors:[],predecessors:[],warnings:[],structuralIssue:false,reachable:false,inCycle:false}));
  const byName=new Map(),edges=[],tokens=[],warnings=[];
  for(const b of blocks){if(!b.implicit){if(!byName.has(b.name))byName.set(b.name,[]);byName.get(b.name).push(b.id);tokens.push({line:b.line,start:b.start-starts[b.line],end:b.start-starts[b.line]+b.name.length,block:b.id});}}
  const opPattern=/^[ \t]*(?:%[\w.$-]+(?:#\d+)?(?::\d+)?(?:\s*,\s*%[\w.$-]+(?:#\d+)?(?::\d+)?)*\s*=\s*)?([a-zA-Z_][\w.]*|"[a-zA-Z_][\w.]*")(?=[\s(]|$)/gm;
  for(const b of blocks){
    for(const m of text.slice(b.bodyStart,b.end).matchAll(opPattern)){
      const rawName=m[1],at=b.bodyStart+m.index+m[0].lastIndexOf(rawName),name=rawName.replaceAll('"','');if(!top[at])continue;
      if(rawName[0]==='"'){if(!/^\s*\(/.test(mask.slice(at+rawName.length,b.end)))continue;}else if(mask.slice(at,at+rawName.length)!==rawName)continue;
      b.operations.push({name,start:at,nameEnd:at+rawName.length,line:lineIndex(starts,at),generic:rawName[0]==='"'});
    }
    b.argCount=[...maskStringsAndComments(b.args).matchAll(/%[\w.$-]+\s*:/g)].length;
    const op=b.operations.at(-1);b.terminator=op?.name||'No terminator';b.terminatorLine=op?.line??b.line;
    const unresolved=op&&/\bunresolved\s*=/.exec(mask.slice(op.nameEnd,b.end));
    b.unresolved=!!unresolved;
    b.unresolvedMnemonic=unresolved?text.slice(op.nameEnd+unresolved.index,b.end).match(/\bmnemonic\s*=\s*"([\w.]+)"/)?.[1]||'':'';
    b.kind=branchOps.has(b.terminator)?'branch':exitOps.has(b.terminator)?'exit':'unknown';
    if(b.kind==='unknown'){b.structuralIssue=true;b.warnings.push('No supported MLIR terminator: outgoing control flow is unknown.');}
    if(b.unresolved)b.warnings.push(b.unresolvedMnemonic==='CALL'?'Unresolved transfer (SASS CALL): the callee target is outside the recovered graph.':`Unresolved transfer${b.unresolvedMnemonic?' (SASS '+b.unresolvedMnemonic+')':''}: the source records an unknown SASS target.`);
    if(b.kind!=='branch')continue;
    const tail=hideDictionaries(mask.slice(op.nameEnd,b.end)),refs=[...tail.matchAll(labelPattern)],conditional=b.terminator.endsWith('cond_br'),switchOp=b.terminator.endsWith('switch');
    const condition=conditional?(tail.match(/%[\w.$-]+(?:#\d+)?/)?.[0]||'condition'):'';
    const expected=switchOp?null:conditional?2:1;
    if(expected!==null&&refs.length!==expected){b.structuralIssue=true;b.warnings.push(`Expected ${expected} branch target${expected>1?'s':''}; found ${refs.length}.`);}
    let previous=0;
    for(let i=0;i<refs.length;i++){
      const r=refs[i],at=op.nameEnd+r.index,targets=byName.get(r[0])||[],prefix=tail.slice(previous,r.index),caseValue=prefix.match(/(?:^|[\s,\[])(-?\d+|default)\s*:\s*$/),label=conditional?(i===0?'True':'False'):switchOp?(caseValue?caseValue[1]==='default'?'Default':'Case '+caseValue[1]:i===0?'Default':'Case #'+i):'Branch';
      let p=r.index+r[0].length;while(p<tail.length&&/\s/.test(tail[p]))p++;
      const close=tail[p]==='('?matching(tail,p):-1,operands=close>=0?text.slice(op.nameEnd+p+1,op.nameEnd+close).trim():'';
      const edge={id:edges.length,from:b.id,to:targets.length===1?targets[0]:null,target:r[0],label,condition,operands,cycle:false};edges.push(edge);b.successors.push(edge.id);
      if(edge.to!==null){blocks[edge.to].predecessors.push(edge.id);const line=lineIndex(starts,at);tokens.push({line,start:at-starts[line],end:at-starts[line]+r[0].length,block:edge.to});}
      else{b.structuralIssue=true;b.warnings.push((targets.length?'Ambiguous':'Missing')+' target '+r[0]+'.');}
      previous=close>=0?close+1:r.index+r[0].length;
    }
  }
  const queue=blocks.length?[0]:[];if(blocks.length)blocks[0].reachable=true;
  for(let q=0;q<queue.length;q++)for(const id of blocks[queue[q]].successors){const e=edges[id];if(e.to!==null&&!blocks[e.to].reachable){blocks[e.to].reachable=true;queue.push(e.to);}}
  // Iterative DFS marks edges returning to an ancestor, including self loops.
  const color=new Uint8Array(blocks.length),parent=new Int32Array(blocks.length).fill(-1);
  for(const root of blocks){if(color[root.id])continue;const stack=[{id:root.id,next:0}];color[root.id]=1;
    while(stack.length){const frame=stack.at(-1),b=blocks[frame.id];if(frame.next>=b.successors.length){color[b.id]=2;stack.pop();continue;}const edge=edges[b.successors[frame.next++]];if(edge.to===null)continue;
      if(color[edge.to]===1){edge.cycle=true;blocks[edge.to].inCycle=true;let at=b.id;while(at!==edge.to&&at>=0){blocks[at].inCycle=true;at=parent[at];}}
      else if(!color[edge.to]){parent[edge.to]=b.id;color[edge.to]=1;stack.push({id:edge.to,next:0});}
    }
  }
  for(const [name,ids] of byName)if(ids.length>1)warnings.push('Duplicate block name '+name+' in this function region.');
  const tokensByLine=new Map();for(const t of tokens){if(!tokensByLine.has(t.line))tokensByLine.set(t.line,[]);tokensByLine.get(t.line).push(t);}
  return {blocks,edges,tokensByLine,warnings,entry:0,reachable:queue.length,unresolved:blocks.filter(b=>b.unresolved).length,incomplete:blocks.some(b=>b.structuralIssue)||warnings.length>0,partial:blocks.some(b=>b.warnings.length>0)||warnings.length>0};
}
export function cfgBlockAtLine(graph,line){let low=0,high=graph.blocks.length;while(low<high){const mid=(low+high)>>1;if(graph.blocks[mid].line<=line)low=mid+1;else high=mid;}const b=graph.blocks[low-1];return b&&line<=b.endLine?b:null;}
// A bounded diagram for large functions; predecessor/successor lists retain every edge.
export function layoutCFG(graph,selected=0){
  const full=graph.blocks.length<=120,ids=full?graph.blocks.map(b=>b.id):[selected,...graph.blocks[selected].predecessors.map(i=>graph.edges[i].from),...graph.blocks[selected].successors.map(i=>graph.edges[i].to).filter(x=>x!==null)],visible=[...new Set(ids)].slice(0,32);
  if(full)visible.splice(0,visible.length,...ids);
  const allowed=new Set(visible),ranks=new Map(),roots=full?[0,...visible]:[selected,...visible];let base=0;
  for(const root of roots){if(!allowed.has(root)||ranks.has(root))continue;const q=[root];ranks.set(root,base);for(let i=0;i<q.length;i++)for(const ei of graph.blocks[q[i]].successors){const e=graph.edges[ei];if(e.to!==null&&allowed.has(e.to)&&!ranks.has(e.to)){ranks.set(e.to,ranks.get(q[i])+1);q.push(e.to);}}base=Math.max(...ranks.values())+1;}
  const levels=new Map();for(const id of visible){const r=ranks.get(id);if(!levels.has(r))levels.set(r,[]);levels.get(r).push(id);}
  const positions=new Map();let row=0,maxCols=1;
  for(const [,nodes] of [...levels].sort(([a],[b])=>a-b)){for(let i=0;i<nodes.length;i++){const col=i%3;positions.set(nodes[i],{x:30+col*180,y:25+(row+Math.floor(i/3))*112});maxCols=Math.max(maxCols,col+1);}row+=Math.ceil(nodes.length/3);}
  return {positions,width:60+maxCols*180,height:Math.max(140,25+row*112),full,total:graph.blocks.length};
}
