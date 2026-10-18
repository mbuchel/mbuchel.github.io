// Text exploration of imported MLIR. This is not an MLIR verifier or lifter.
export function maskStringsAndComments(text) {
  let out='',state='code',depth=0;
  for(let i=0;i<text.length;i++) {
    const c=text[i],n=text[i+1];
    if(state==='string') {if(c==='\\'){out+='  ';i++;}else if(c==='"'){state='code';out+=' ';}else out+=c==='\n'?'\n':' ';}
    else if(state==='line') {out+=c==='\n'?'\n':' ';if(c==='\n')state='code';}
    else if(state==='block') {
      if(c==='/'&&n==='*'){depth++;out+='  ';i++;}
      else if(c==='*'&&n==='/'){out+='  ';i++;if(!--depth)state='code';}
      else out+=c==='\n'?'\n':' ';
    } else if(c==='"'){state='string';out+=' ';}
    else if(c==='/'&&n==='/'){state='line';out+='  ';i++;}
    else if(c==='/'&&n==='*'){state='block';depth=1;out+='  ';i++;}
    else out+=c;
  }
  return out;
}
function regionEnd(mask,start) {
  let depth=0;
  for(let i=start;i<mask.length;i++) {if(mask[i]==='{')depth++;else if(mask[i]==='}'&&!--depth)return i+1;}
  throw new Error('Unbalanced function region in MLIR text.');
}
export function parseIR(text,name='imported.mlir') {
  if(typeof text!=='string'||!text.trim())throw new Error('MLIR file is empty.');
  if(text.length>12*1024*1024)throw new Error('MLIR exceeds the 12 MB text limit.');
  const masked=maskStringsAndComments(text),tokens=[...masked.matchAll(/\b(?:sass\.func|func\.func|gpu\.func|llvm\.func)\b/g)],functions=[];
  for(let j=0;j<tokens.length;j++) {
    const match=tokens[j],start=match.index,next=tokens[j+1]?.index??text.length;
    const head=text.slice(start+match[0].length,Math.min(next,start+16384));
    const symbol=head.match(/^\s*(?:(?:public|private|nested)\s+)?(?:@(?:"((?:\\.|[^"\\])*)"|([\w.$-]+))|"((?:\\.|[^"\\])*)")/);
    if(!symbol)continue;
    let fnName=symbol[1]??symbol[2]??symbol[3];
    fnName=fnName.replace(/\\22/g,'"').replace(/\\5C/gi,'\\');
    let body=masked.indexOf('{',start+match[0].length+symbol[0].length);
    if(body<0||body>=next)continue;
    if(/\battributes\s*$/.test(masked.slice(start,body))) {
      body=masked.indexOf('{',regionEnd(masked,body));
      if(body<0||body>=next)continue;
    }
    const end=regionEnd(masked,body);
    functions.push({name:fnName,start,end,bodyStart:body-start+1,bodyEnd:end-start-1,lineStart:text.slice(0,start).split('\n').length,text:text.slice(start,end)});
  }
  if(!functions.length) functions.push({name:'Whole file · '+name,start:0,end:text.length,lineStart:1,text});
  return {name,text,functions};
}
export function irBlocks(text) {
  const masked=maskStringsAndComments(text),blocks=[];
  masked.split('\n').forEach((line,index)=>{const m=line.match(/^\s*(\^[\w.$-]+)(?:\([^]*\))?\s*:/);if(m)blocks.push({name:m[1],line:index});});
  return blocks;
}
export function rawAttributes(text) {
  const result=[],masked=maskStringsAndComments(text);let line=0,cursor=0;
  for(const m of text.matchAll(/#sass\.raw<\s*(0x[0-9a-f]+|\d+)\s*,\s*(0x[0-9a-f]+|\d+)\s*>/gi)) {
    if(masked.slice(m.index,m.index+9)!=='#sass.raw')continue;
    const low=BigInt(m[1]),high=BigInt(m[2]);if(low>0xffffffffffffffffn||high>0xffffffffffffffffn)continue;
    for(;cursor<m.index;cursor++)if(text[cursor]==='\n')line++;
    result.push({start:m.index,end:m.index+m[0].length,line,value:low|(high<<64n)});
  }
  return result;
}
export function ssaTokens(line) {
  return [...maskStringsAndComments(line).matchAll(/%[\w.$-]+(?:#\d+)?/g)].map(m=>({value:m[0],start:m.index,end:m.index+m[0].length}));
}

export function parseTSV(text,name) {
  if(text.length>16*1024*1024)throw new Error('Opcode table exceeds the 16 MB text limit.');
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()&&!line.trimStart().startsWith('#'));
  if(!lines.length)throw new Error('Opcode table is empty.');
  const rows=lines.map(line=>line.split('\t'));
  if(rows.length>250000||rows.some(row=>row.length>100))throw new Error('Opcode table exceeds the row or column limit.');
  if(!rows.some(r=>r.length>1))throw new Error('Expected a tab-separated opcode table.');
  const headers=['sm_ver','sm_or_star','isa','sm'].includes(rows[0][0])?rows.shift():null;
  return {name,rows,headers,columns:rows.reduce((n,r)=>Math.max(n,r.length),headers?.length??0)};
}
