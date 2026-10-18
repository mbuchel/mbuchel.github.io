// Bounded, source-preserving text alignment and explicit CFG correspondence.
function anchors(a,b,a0,a1,b0,b1){
  const left=new Map(),right=new Map();
  for(let i=a0;i<a1;i++)left.set(a[i],left.has(a[i])?-1:i);
  for(let i=b0;i<b1;i++)right.set(b[i],right.has(b[i])?-1:i);
  const candidates=[];for(const [line,ai] of left){const bi=right.get(line);if(ai>=0&&bi>=0)candidates.push([ai,bi]);}
  candidates.sort((x,y)=>x[0]-y[0]);const tails=[],previous=new Int32Array(candidates.length).fill(-1);
  for(let i=0;i<candidates.length;i++){let low=0,high=tails.length;while(low<high){const mid=(low+high)>>1;if(candidates[tails[mid]][1]<candidates[i][1])low=mid+1;else high=mid;}previous[i]=low?tails[low-1]:-1;tails[low]=i;}
  const out=[];for(let i=tails.at(-1)??-1;i>=0;i=previous[i])out.push(candidates[i]);return out.reverse();
}
export function diffLines(a,b,{maxCells=2000000}={}){
  if(a.length+b.length>100000)throw new Error('Side-by-side comparison supports 100,000 total source lines.');
  const edits=[];let budget=maxCells,grouped=false;
  const add=(type,ai=null,bi=null)=>edits.push({type,a:ai,b:bi});
  function align(a0,a1,b0,b1,depth=0){
    while(a0<a1&&b0<b1&&a[a0]===b[b0])add('same',a0++,b0++);
    let suffix=0;while(a0<a1-suffix&&b0<b1-suffix&&a[a1-suffix-1]===b[b1-suffix-1])suffix++;
    const ae=a1-suffix,be=b1-suffix,n=ae-a0,m=be-b0;
    if(!n){for(let j=b0;j<be;j++)add('added',null,j);}
    else if(!m){for(let i=a0;i<ae;i++)add('removed',i);}
    else{
      const matched=depth<64?anchors(a,b,a0,ae,b0,be):[];
      if(matched.length){let ai=a0,bi=b0;for(const [x,y] of matched){align(ai,x,bi,y,depth+1);add('same',x,y);ai=x+1;bi=y+1;}align(ai,ae,bi,be,depth+1);}
      else if((n+1)*(m+1)<=budget){
        const width=m+1,cells=(n+1)*width,dp=new Uint32Array(cells);budget-=cells;
        for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i*width+j]=a[a0+i]===b[b0+j]?dp[(i+1)*width+j+1]+1:Math.max(dp[(i+1)*width+j],dp[i*width+j+1]);
        let i=0,j=0;while(i<n&&j<m){if(a[a0+i]===b[b0+j])add('same',a0+i++,b0+j++);else if(dp[(i+1)*width+j]>=dp[i*width+j+1])add('removed',a0+i++);else add('added',null,b0+j++);}while(i<n)add('removed',a0+i++);while(j<m)add('added',null,b0+j++);
      }else{grouped=true;for(let i=a0;i<ae;i++)add('removed',i);for(let j=b0;j<be;j++)add('added',null,j);}
    }
    for(let k=suffix;k>0;k--)add('same',a1-k,b1-k);
  }
  align(0,a.length,0,b.length);
  const rows=[];let removed=0,added=0;
  for(let i=0;i<edits.length;){const e=edits[i];if(e.type==='same'){rows.push({a:e.a,b:e.b,status:'same'});i++;continue;}
    const left=[],right=[];while(i<edits.length&&edits[i].type!=='same'){const x=edits[i++];if(x.a!==null)left.push(x.a);if(x.b!==null)right.push(x.b);}removed+=left.length;added+=right.length;
    for(let k=0;k<Math.max(left.length,right.length);k++)rows.push({a:left[k]??null,b:right[k]??null,status:k<left.length&&k<right.length?'changed':k<left.length?'removed':'added'});
  }
  const hunks=[];for(let i=0;i<rows.length;i++)if(rows[i].status!=='same'&&(i===0||rows[i-1].status==='same'))hunks.push(i);
  return {rows,hunks,removed,added,grouped};
}
export function compareCFG(a,b,textA,textB,mode='label'){
  const pairs=[],maps={a:new Map(),b:new Map()},nodes={a:new Map(),b:new Map()},edgeStatus={a:new Map(),b:new Map()};
  const names=g=>{const m=new Map();for(const block of g.blocks){const k=block.implicit?'@implicit':block.name;if(!m.has(k))m.set(k,[]);m.get(k).push(block.id);}return m;},an=names(a),bn=names(b),used=new Set();
  const pair=(ai,bi)=>{const id=pairs.length,p={id,a:ai,b:bi,status:ai===null?'added':bi===null?'removed':'same'};pairs.push(p);if(ai!==null)maps.a.set(ai,id);if(bi!==null){maps.b.set(bi,id);used.add(bi);}return p;};
  for(const block of a.blocks){const key=block.implicit?'@implicit':block.name,candidates=bn.get(key)||[];const bi=mode==='order'?(block.id<b.blocks.length?block.id:null):an.get(key).length===1&&candidates.length===1?candidates[0]:null;pair(block.id,bi);}
  for(const block of b.blocks)if(!used.has(block.id))pair(null,block.id);
  for(const p of pairs){if(p.a!==null&&p.b!==null){const x=a.blocks[p.a],y=b.blocks[p.b];if(textA.slice(x.start,x.end).replace(/\r\n/g,'\n')!==textB.slice(y.start,y.end).replace(/\r\n/g,'\n'))p.status='changed';}if(p.a!==null)nodes.a.set(p.a,p.status);if(p.b!==null)nodes.b.set(p.b,p.status);}
  const signature=(side,e)=>JSON.stringify([maps[side].get(e.from),maps[side].get(e.to),e.label]);
  const bEdges=new Map();for(const e of b.edges){if(e.to===null)continue;const key=signature('b',e);if(!bEdges.has(key))bEdges.set(key,[]);bEdges.get(key).push(e.id);}
  let common=0,removed=0,added=0;
  for(const e of a.edges){if(e.to===null)continue;const list=bEdges.get(signature('a',e));if(list?.length){edgeStatus.a.set(e.id,'same');edgeStatus.b.set(list.shift(),'same');common++;}else{edgeStatus.a.set(e.id,'removed');removed++;}}
  for(const e of b.edges)if(e.to!==null&&!edgeStatus.b.has(e.id)){edgeStatus.b.set(e.id,'added');added++;}
  const union={blocks:pairs.map(p=>({id:p.id,successors:[],predecessors:[]})),edges:[]},seen=new Set();
  for(const [side,g] of [['a',a],['b',b]])for(const e of g.edges){if(e.to===null)continue;const from=maps[side].get(e.from),to=maps[side].get(e.to),key=from+':'+to;if(seen.has(key))continue;seen.add(key);const id=union.edges.length;union.edges.push({id,from,to});union.blocks[from].successors.push(id);union.blocks[to].predecessors.push(id);}
  return {pairs,maps,nodes,edgeStatus,union,commonEdges:common,removedEdges:removed,addedEdges:added,changedBlocks:pairs.filter(p=>p.status==='changed').length,removedBlocks:pairs.filter(p=>p.status==='removed').length,addedBlocks:pairs.filter(p=>p.status==='added').length};
}
