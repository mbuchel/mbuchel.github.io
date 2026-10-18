// SPDX-License-Identifier: AGPL-3.0-or-later
// Port of lib/pepesilvia/{roles,cfg,defuse,liveness,ssa}.cpp and effects.h.
export const GUARD=4294967295,OLD=4294967294;
export const key=ref=>ref[0]*65536+ref[1];
const ref=k=>[Math.floor(k/65536),k%65536];
export function branchKind(a){const n=a.mnemonic;return ['BRA','JMP','BRX','BRXU','JMX','JMXU'].includes(n)?a.has_guard?'COND':'UNCOND':n==='CALL'?'CALL':['RET','RTT'].includes(n)?'RET':['EXIT','KILL'].includes(n)?'EXIT':['BSSY','BSYNC','WARPSYNC'].includes(n)?'SYNC':'NONE';}
export function branchEdges(a){const b=a.branch,conditional=a.has_guard&&!a.guard.all;if(a.has_guard&&a.guard.all&&a.guard_neg)return {target:false,fallthrough:true,unresolved:false};
  if(['UNCOND','COND'].includes(b.kind))return {target:b.has_target,fallthrough:conditional,unresolved:!b.has_target};
  if(['CALL','SYNC'].includes(b.kind))return {target:b.has_target,fallthrough:true,unresolved:!b.has_target&&a.mnemonic!=='WARPSYNC'};
  return {target:false,fallthrough:['RET','EXIT'].includes(b.kind)?conditional:true,unresolved:false};
}
export function recoverCFG(insts,context={}){
  for(const a of insts){const b={kind:a.decoded?branchKind(a):'NONE',has_target:false,target:0n,external:false,relocated:false};a.branch=b;
    if(b.kind==='NONE'||['RET','EXIT'].includes(b.kind)||['BRX','BRXU','JMX','JMXU','BSYNC','WARPSYNC'].includes(a.mnemonic))continue;
    const relocation=context.relocations?.find(r=>r.target===context.section&&r.offset>=a.pc+(context.start||0)&&r.offset<a.pc+(context.start||0)+16);
    if(relocation){b.relocated=true;const symbol=context.symbols?.find(s=>s.name===relocation.symbol);if(symbol?.section===context.section){b.has_target=true;b.target=BigInt(symbol.value-(context.start||0));}else b.external=true;}
    else{const op=a.operands.findLast(o=>o.type==='imm'&&o.kind===0&&!o.neg&&!o.abs&&!o.bnot&&!o.space_sep);if(op){b.has_target=true;b.target=op.data;}}
    if(b.has_target&&(b.target%16n||b.target<0n||b.target>=BigInt(insts.length*16))){b.has_target=false;b.external=true;}
  }
  const leaders=new Set(insts.length?[0]:[]);
  insts.forEach((a,i)=>{if(a.branch.has_target)leaders.add(Number(a.branch.target/16n));if(a.branch.kind!=='NONE'&&i+1<insts.length)leaders.add(i+1);});
  const sorted=[...leaders].sort((a,b)=>a-b),blocks=sorted.map((first,i)=>({first,last:sorted[i+1]??insts.length,succs:[],preds:[],liveIn:[],args:[],edges:new Map()}));
  blocks.forEach((b,bi)=>{for(let i=b.first;i<b.last;i++)insts[i].block=bi;});
  blocks.forEach((b,bi)=>{const a=insts[b.last-1],e=branchEdges(a);if(e.target)b.succs.push(insts[Number(a.branch.target/16n)].block);if(e.fallthrough&&bi+1<blocks.length&&!b.succs.includes(bi+1))b.succs.push(bi+1);for(const next of b.succs)blocks[next].preds.push(bi);});
  return blocks;
}
const noDest=new Set('BAR CCTL CCTLL DEPBAR ERRBAR LDGDEPBAR LDGSTS MEMBAR NOP RED ST STG STL STS YIELD'.split(' '));
const pdst2=new Set('ATOM ATOMG B2R CSMTEST DSETP FLO FMNMX FSETP HSETP2 IADD IMAD IMNMX IPA ISETP LEA PIXLD PLOP3 UCLEA UFLO UFMNMX UFSETP UIMAD UIMNMX UISETP ULEA UPLOP3 VABSDIFF VABSDIFF4 VOTE'.split(' '));
const pdst3=new Set('HMNMX2 IADD3 UIADD3 UVIMNMX VIMNMX'.split(' '));
const plain=o=>!o.neg&&!o.abs&&!o.bnot&&!o.space_sep&&!o.selector;
const slot=o=>!!o&&plain({...o,space_sep:false,selector:''})&&(o.type==='pred'||o.type==='reg'&&['R','UR'].includes(o.file));
const regRef=o=>o.type==='reg'&&!o.zero&&['R','UR'].includes(o.file)?[o.file==='UR'?1:0,o.num]:o.type==='pred'&&!o.all&&o.num!==255?[o.uniform?3:2,o.num]:null;
function destinationWidth(a){let width=1;const {mnemonic:n,modifiers:m}=a;if(n==='CS2R')return m.includes('32')?1:2;for(const t of m){if(t==='128')width=Math.max(width,4);else if(t==='WIDE'||t==='64')width=Math.max(width,2);else if(['LDSM','STSM'].includes(n))width=Math.max(width,t==='4'?4:t==='2'?2:1);else if(n==='HMMA'&&['16816','1688'].includes(t))width=Math.max(width,m.includes('F16')?2:4);else if(['HGMMA','QGMMA','IGMMA','BGMMA'].includes(n)){const match=/^64x(\d+)x\d/.exec(t);if(match)width=Math.max(width,Math.floor(Number(match[1])/(m.includes('F16')?4:2)));}}return width;}
const tmaDimensions=a=>a.modifiers.length!==1?0:a.mnemonic==='UTMALDG'&&['3D','4D'].includes(a.modifiers[0])||a.mnemonic==='UTMASTG'&&a.modifiers[0]==='5D'?Number(a.modifiers[0][0]):0;
const tmaCount=(a,d)=>d?a.mnemonic==='UTMASTG'?2:d-1:0;
const sourceWidth=(a,i,gdesc=false)=>{const d=tmaDimensions(a);return gdesc&&a.mnemonic==='HGMMA'&&[1,2].includes(i)?i===1?4:2:d?i===0?d+(a.mnemonic==='UTMASTG'?1:2):i<tmaCount(a,d)?2:1:a.mnemonic==='SYNCS'&&a.modifiers.length===2&&a.modifiers.includes('EXCH')&&a.modifiers.includes('64')&&i===2?2:1;};
const addendWidth=(a,i)=>a.mnemonic==='IMAD'&&a.modifiers.includes('HI')&&i+1+Number(a.modifiers.includes('X'))===a.operands.length?2:1;
const baseWidth=(n,mods)=>{const w=/(?:^|\.)64(?:\.|$)/.test(mods)?2:1;return n<255&&w<=255-n?w:0;};
const uniformValid=(n,w)=>n<63&&w<=63-n;
function uniformGroup(o,w,descriptor=false){if(o?.type!=='mem'||o.cx_bank>=0)return false;const a=o.addr;if(descriptor){const m=/^UR(\d+)/.exec(o.desc_ur);return !a.has_base&&a.offreg<0&&m&&uniformValid(Number(m[1]),w);}if(o.desc_ur)return false;let fields=0,base=63;if(a.has_base){if(a.base.file!=='UR'||a.base.zero)return false;base=a.base.num;fields++;}if(a.offreg>=0){if(a.offreg_z)return false;base=a.offreg;fields++;}return fields===1&&uniformValid(base,w);}
function implicitSupported(a){
  const n=a.mnemonic,ops=a.operands,t=tmaDimensions(a),exchange=n==='SYNCS'&&sourceWidth(a,2)>1;
  if(['UTMALDG','UTMASTG'].includes(n)&&!t)return false;
  if(n==='UTMASTG'&&(ops.length!==2||ops.some(o=>o.type!=='mem'||!plain(o)||o.reuse||o.space!==0||!o.addr_group||o.bank!==-1||o.cx_bank!==-1||o.cx_bank_z||o.cx_bank_mods||o.desc_ur||o.desc_ur_mods||o.desc_kind||o.addr.base_mods||o.addr.offreg_mods||o.addr.hex_off_present||o.addr.hex_off!=='0x0')))return false;
  if(n==='CS2R'){const o=ops[0],w=destinationWidth(a);if(o?.type!=='reg'||o.file!=='R'||!o.zero&&(o.num>=255||w>255-o.num))return false;}
  for(let i=0;i<ops.length;i++){const o=ops[i],w=addendWidth(a,i),limit=o.file==='UR'?63:255;if(w>1&&o.type==='reg'&&!o.zero&&(o.num>=limit||w>limit-o.num))return false;}
  if(n==='HGMMA')for(let i=1;i<Math.min(ops.length,3);i++)if(ops[i].type==='mem'&&ops[i].space===6)return !!uniformGroup(ops[i],4);
  if(t)return ops.length===tmaCount(a,t)&&ops.every((o,i)=>uniformGroup(o,sourceWidth(a,i),i===2));
  if(!exchange)return true;
  return ops.length===3&&uniformGroup(ops[1],1)&&ops[0].type==='reg'&&ops[0].file==='UR'&&(ops[0].zero||uniformValid(ops[0].num,2))&&ops[2].type==='reg'&&ops[2].file==='UR'&&!ops[2].zero&&uniformValid(ops[2].num,2);
}
function predicateMask(a,destination){const p=destination?1:2,ops=a.operands,agg=ops[destination?0:1],payload=ops[p],im=ops[p+1],result=ops[0];
  if(a.mnemonic!==(destination?'R2P':'P2R')||a.modifiers.length||ops.length!==(destination?3:4)||agg?.type!=='pred'||agg.uniform||agg.all||agg.num!==255||payload?.type!=='reg'||payload.file!=='R'||!payload.zero&&payload.num>=255||im?.type!=='imm'||im.kind>1||im.f64||im.data>127n||!destination&&(result?.type!=='reg'||result.file!=='R'||!result.zero&&result.num>=255)||ops.some((o,i)=>!plain(o)||o.reuse&&i!==p))return null;return Number(im.data);
}
export function computeDefuse(insts){for(const a of insts){a.defs=[];a.uses=[];if(!a.decoded)continue;const ops=a.operands,n=a.mnemonic,rd=predicateMask(a,true),rs=predicateMask(a,false);
    if(ops.some(o=>o.type==='mem'&&o.addr.has_base&&!o.addr.base.zero&&o.addr.base.file==='R'&&!baseWidth(o.addr.base.num,o.addr.base_mods))||(['R2P','P2R'].includes(n)||ops.some(o=>o.type==='pred'&&o.num===255))&&rd===null&&rs===null||!implicitSupported(a)){a.decoded=false;continue;}
    let first=0;const destination=(i,wide=true)=>{const r=regRef(ops[i]);if(!r)return;const w=wide&&r[0]<2?destinationWidth(a):1;for(let k=0;k<w;k++)a.defs.push([i,r[0],(r[1]+k)&65535]);};
    if(rd!==null){for(let p=0;p<7;p++)if(rd&(1<<p))a.defs.push([0,2,p]);first=1;}
    else if(n==='SHFL'){if(slot(ops[0]))destination(0,false);if(slot(ops[1]))destination(1,false);first=Math.min(2,ops.length);}
    else if(pdst2.has(n)||pdst3.has(n)){if(slot(ops[0])){first=1;destination(0);if(slot(ops[1])&&(ops[0].type==='pred'||ops[1].type==='pred')){first=2;destination(1);if(pdst3.has(n)&&slot(ops[2])&&ops[2].type==='pred'){first=3;destination(2,false);}}}}
    else if(branchKind(a)==='NONE'&&!noDest.has(n)&&slot(ops[0])){first=1;destination(0);}
    const push=(i,r,w=1,off=0)=>{if(r)for(let k=0;k<w;k++)a.uses.push([i,r[0],(r[1]+off+k)&65535]);};
    for(let i=first;i<ops.length;i++){const o=ops[i];if(rs!==null&&i===1){for(let p=0;p<7;p++)if(rs&(1<<p))a.uses.push([1,2,p]);continue;}const g=o.type==='mem'&&o.space===6,w=sourceWidth(a,i,g),off=g&&n==='HGMMA'&&i===2?2:0;
      if(o.type==='reg')push(i,regRef(o),Math.max(w,addendWidth(a,i)));
      else if(o.type==='pred')push(i,regRef(o));
      else if(o.type==='mem'){const addr=o.addr,r=addr.has_base?regRef(addr.base):null;if(r)push(i,r,r[0]===1?w:baseWidth(r[1],addr.base_mods),off);if(addr.offreg>=0&&!addr.offreg_z)push(i,[1,addr.offreg],w,off);const d=/^UR(\d+)/.exec(o.desc_ur);if(d)push(i,[1,Number(d[1])&65535],w);if(o.cx_bank>=0&&!o.cx_bank_z)push(i,[1,o.cx_bank]);}
    }
    if(a.has_guard)push(GUARD,regRef(a.guard));if(a.has_guard)for(const d of a.defs)a.uses.push([OLD,d[1],d[2]]);
  }return insts;}
export function computeLiveness(insts,blocks){
  const sets=blocks.map(b=>{const use=new Set(),def=new Set();for(let i=b.first;i<b.last;i++){for(const [,c,n] of insts[i].uses){const k=key([c,n]);if(!def.has(k))use.add(k);}for(const [,c,n] of insts[i].defs)def.add(key([c,n]));}return {use,def,input:new Set()};});
  let changed=true;while(changed){changed=false;for(let bi=blocks.length-1;bi>=0;bi--){const s=sets[bi],next=new Set(s.use);for(const succ of blocks[bi].succs)for(const k of sets[succ].input)if(!s.def.has(k))next.add(k);if(next.size!==s.input.size||[...next].some(k=>!s.input.has(k))){s.input=next;changed=true;}}}
  const rank=[0,1,3,2];blocks.forEach((b,i)=>{b.liveIn=[...sets[i].input].map(ref).sort((a,b)=>rank[a[0]]-rank[b[0]]||a[1]-b[1]);});
}
export function projectSSA(insts,blocks){
  const values=[],entries=new Map(),entryLoop=!!blocks[0]?.preds.length;let current=new Map();
  const define=(r,kind,block,inst=0)=>{const id=values.length;values.push({reg:r,kind,block,inst});return id;};
  const read=r=>{const k=key(r);if(current.has(k))return current.get(k);if(!entries.has(k))entries.set(k,define(r,'ENTRY',0));return entries.get(k);};
  blocks.forEach((b,i)=>{b.args=i>0||entryLoop?b.liveIn.map(r=>define(r,'BLOCK_ARG',i)):[];});
  const entrySources=entryLoop?blocks[0].liveIn.map(read):[];
  blocks.forEach((b,bi)=>{current=new Map(b.args.map((id,i)=>[key(b.liveIn[i]),id]));for(let i=b.first;i<b.last;i++){const a=insts[i];a.ssaUses=a.uses.map(([,c,n])=>{const r=[c,n],id=read(r);current.set(key(r),id);return id;});a.ssaDefs=a.defs.map(([,c,n])=>{const r=[c,n],id=define(r,'RESULT',bi,i);current.set(key(r),id);return id;});}b.edges=new Map(b.succs.map(next=>[next,blocks[next].args.map((_,i)=>read(blocks[next].liveIn[i]))]));});
  return {values,entries:[...entries.values()],entrySources,entryLoop};
}
