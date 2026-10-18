// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-derived read-only SSA projection and Sass dialect text serializer.
import {bits,fpBits,printOperand} from './ast.mjs';
import {decodeInstruction} from './decoder.mjs';
import {GUARD,OLD,recoverCFG,branchEdges,computeDefuse,computeLiveness,projectSSA,key} from './analysis.mjs';
import {instructionAt} from '../cubin.mjs';
const types=['!sass.reg','!sass.ureg','!sass.pred','!sass.upred'];
// MLIR strings escape UTF-8 bytes, including arbitrary ELF symbol names.
export function mlirString(s){return '"'+[...new TextEncoder().encode(s)].map(c=>c>=32&&c<127&&c!==34&&c!==92?String.fromCharCode(c):'\\'+c.toString(16).padStart(2,'0').toUpperCase()).join('')+'"';}
function operandAttribute(o,role,idx){
  let f=(o.neg?1:0)|(o.abs?2:0)|(o.bnot?4:0)|(o.reuse?8:0)|(o.space_sep?16:0);
  const sel=mlirString(o.selector||''),suffix=()=>`flags = ${f}, sel = ${sel}`;
  if(o.type==='reg'||o.type==='pred'){
    let cls;if(o.type==='reg'){cls=o.file==='UR'?'UR':'R';f|=(o.zero?256:0)|({B:512,SB:1024,GSB:2048,PC:4096}[o.file]||0);}else{cls=o.uniform?'UP':'P';f|=(o.all?256:0)|(o.num===255?512:0);}
    return `#sass.reg_ref<${cls}, ${role}, idx = ${idx}, num = ${o.num}, ${suffix()}>`;
  }
  if(o.type==='imm')return `#sass.imm<kind = ${o.kind}, data = ${o.data}, fpbits = ${fpBits(typeof o.fp==='number'?o.fp:0)}, f64 = ${!!o.f64}, ${suffix()}>`;
  if(o.type==='mem'){const a=o.addr;return `#sass.mem<space = ${o.space}, bank = ${o.bank}, desc = ${mlirString(o.desc_ur)}, cx = ${o.cx_bank}, has_base = ${a.has_base}, base_cls = ${a.base.file==='UR'?1:0}, base_num = ${a.base.num}, base_zero = ${a.base.zero}, base_mods = ${mlirString(a.base_mods)}, offreg = ${a.offreg}, offreg_z = ${a.offreg_z}, off = ${mlirString(a.hex_off)}, off_present = ${a.hex_off_present}, addr_group = ${o.addr_group}, desc_kind = ${o.desc_kind}, ${suffix()}${o.cx_bank_z?' cx_z = true':''}${o.cx_bank_mods?' cx_mods = '+mlirString(o.cx_bank_mods):''}>`;}
  if(o.type==='special')return `#sass.sreg<name = ${mlirString(o.text)}, ${suffix()}>`;
  if(o.type==='barset')return `#sass.barset<ids = [${o.ids.join(', ')}], ${suffix()}>`;
  if(o.type==='label')return `#sass.label<name = ${mlirString(o.text)}, ${suffix()}>`;
  return `#sass.opaque<kind = ${o.kind||0}, text = ${mlirString(o.text)}, num = ${o.num||0}, ${suffix()}>`;
}
function backref(a,i){let at=a.defs.findIndex(d=>d[0]===i);if(at>=0)return ['dst',at];at=a.uses.filter(r=>r[0]!==GUARD&&r[0]!==OLD).findIndex(r=>r[0]===i);return ['src',Math.max(0,at)];}
function attributes(a,vocabulary){
  const mod=a.decoded?a.modifiers.map(m=>{if(!vocabulary[m])throw new Error(`Modifier ${m} is outside the repository's generated MLIR vocabulary.`);return '#sass<instr_mod '+vocabulary[m]+'>';}):[],e=a.encoding;
  const fields=[['stall',105,108],['yield',109,109],['wbar',110,112],['rbar',113,115],['watdb',116,121],['reuse',122,125],['rsv',126,127],['pm',102,103]].map(([n,lo,hi])=>n+' = '+(n==='yield'?!!bits(e,lo,hi):bits(e,lo,hi)));
  const operands=a.decoded?a.operands.map((o,i)=>operandAttribute(o,...backref(a,i))):null;
  return {modifiers:'['+mod.join(', ')+']',guard_pred:Number(bits(e,12,15))+' : ui8',raw:`#sass.raw<0x${(e&0xffffffffffffffffn).toString(16)}, 0x${(e>>64n).toString(16)}>`,sched:'#sass.sched<'+fields.join(', ')+'>',...(operands?{operands:'['+operands.join(', ')+']'}:{})};
}
function branchSource(a,attrs,words){return '{'+[`mnemonic = ${mlirString(a.decoded?a.mnemonic:'HIDDEN')}`,...['modifiers','guard_pred','operands'].filter(k=>k in attrs).map(k=>k+' = '+attrs[k]),...(!['BRX','BRXU','JMX','JMXU','BSYNC'].includes(a.mnemonic)?['words = '+words+' : i64']:[])].join(', ')+'}';}
export function serializeMLIR(fn,sm,insts,blocks,ssa,vocabulary,tail=new Uint8Array()){
  const lines=['// Experimental browser port of the supplied SASS2MLIR source.', '// Raw instruction bytes are authoritative; no optimization or GPU execution.', 'module {'];
  const tailAttr=tail.length?' attributes {tail = "'+[...tail].map(c=>'\\'+c.toString(16).padStart(2,'0')).join('')+'"}':'';
  lines.push(`  sass.func ${mlirString(fn.sectionOffset?fn.name:fn.section)} arch = #sass<arch sm${sm}>${tailAttr} {`);
  const ty=id=>types[ssa.values[id].reg[0]],args=ids=>ids.map(id=>`%v${id}: ${ty(id)}`).join(', '),edge=(from,to)=>{const ids=blocks[from].edges.get(to)||[];return '^bb'+to+(ids.length?'('+ids.map(id=>'%v'+id).join(', ')+' : '+ids.map(ty).join(', ')+')':'');};
  if(ssa.entryLoop){lines.push('  ^entry'+(ssa.entries.length?'('+args(ssa.entries)+')':'')+':');lines.push('    cf.br ^bb0'+(ssa.entrySources.length?'('+ssa.entrySources.map(id=>'%v'+id).join(', ')+' : '+ssa.entrySources.map(ty).join(', ')+')':''));}
  if(!blocks.length)lines.push('    sass.exit');
  blocks.forEach((b,bi)=>{
    const blockArgs=bi===0&&!ssa.entryLoop?ssa.entries:b.args;lines.push('  ^bb'+bi+(blockArgs.length?'('+args(blockArgs)+')':'')+':');
    let attrs=null;
    for(let i=b.first;i<b.last;i++){
      const a=insts[i],src=a.ssaUses.filter((_,j)=>a.uses[j][0]!==GUARD&&a.uses[j][0]!==OLD),old=a.ssaUses.filter((_,j)=>a.uses[j][0]===OLD),guardIdx=a.uses.findIndex(r=>r[0]===GUARD),guard=guardIdx>=0?a.ssaUses[guardIdx]:null;
      if(Number(bits(a.encoding,12,15))!==7)src.push(...old);
      attrs=attributes(a,vocabulary);
      const assembly=(a.has_guard?'@'+(a.guard_neg?'!':'')+(a.guard.uniform?'UP':'P')+(a.guard.all?'T':a.guard.num)+' ':'')+[a.mnemonic,...a.modifiers].join('.')+(a.operands.length?' '+a.operands.map(printOperand).join(', '):'');
      lines.push('    // +0x'+a.pc.toString(16).padStart(4,'0')+' '+(a.decoded?assembly.replace(/[\r\n]/g,' '):'HIDDEN (raw carrier)'));
      lines.push('    '+(a.ssaDefs.length?a.ssaDefs.map(id=>'%v'+id).join(', ')+' = ':'')+'sass.inst '+(a.decoded?a.mnemonic:'HIDDEN')+(guard!==null?' '+(a.guard.uniform?'uguard':'guard')+'(%v'+guard+')':'')+(src.length?' '+src.map(id=>'%v'+id).join(', '):'')+' : ('+src.map(ty).join(', ')+') -> ('+a.ssaDefs.map(ty).join(', ')+') {'+Object.entries(attrs).map(([k,v])=>k+' = '+v).join(', ')+'}');
    }
    const last=insts[b.last-1],termAttrs=[];
    if(branchEdges(last).unresolved)termAttrs.push('unresolved = '+branchSource(last,attrs,insts.length));
    if(last.branch.relocated&&last.branch.has_target)termAttrs.push(`relocation = {source = ${branchSource(last,attrs,0)}, pc = ${last.pc} : i64, target = ${last.branch.target} : i64}`);
    const suffix=termAttrs.length?' {'+termAttrs.join(', ')+'}':'';
    if(!b.succs.length)lines.push('    sass.exit'+suffix);
    else if(b.succs.length===1||last.branch.kind==='SYNC')lines.push('    cf.br '+edge(bi,b.succs.length===1?b.succs[0]:b.succs[1])+suffix);
    else{const g=last.uses.findIndex(r=>r[0]===GUARD),id=g>=0?last.ssaUses[g]:null,c='%cond'+bi;lines.push(`    ${c} = builtin.unrealized_conversion_cast${id!==null?' %v'+id+' : '+ty(id):' : ()'} to i1`);const targets=last.guard_neg?[...b.succs].reverse():b.succs;lines.push('    cf.cond_br '+c+', '+edge(bi,targets[0])+', '+edge(bi,targets[1])+suffix);}
  });lines.push('  }','}');return lines.join('\n')+'\n';
}
export function validateProjection(insts,blocks,ssa){
  let next=0;const entrySet=new Set(ssa.entries);
  for(let bi=0;bi<blocks.length;bi++){const b=blocks[bi];if(b.first!==next||b.last<=b.first)throw new Error('CFG partition validation failed.');next=b.last;const available=new Set([...entrySet,...b.args]);
    const check=id=>{if(!available.has(id))throw new Error('SSA use is not defined in this block.');};
    for(let i=b.first;i<b.last;i++){const a=insts[i];if(a.block!==bi)throw new Error('CFG ownership validation failed.');a.ssaUses.forEach(check);a.ssaDefs.forEach(id=>available.add(id));}
    for(const [to,ids] of b.edges){if(ids.length!==blocks[to].args.length)throw new Error('SSA edge arity validation failed.');ids.forEach((id,i)=>{check(id);if(key(ssa.values[id].reg)!==key(ssa.values[blocks[to].args[i]].reg))throw new Error('SSA edge register mismatch.');});}
  }if(next!==insts.length)throw new Error('CFG instruction coverage validation failed.');return true;
}
export function liftFunction(cubin,fn,model,vocabulary){
  if(!cubin.canSlice)throw new Error('Browser lifting requires Volta or newer 128-bit SASS.');
  if(fn.count>25000)throw new Error('This browser version lifts functions up to 25,000 instructions.');
  const insts=Array.from({length:fn.count},(_,i)=>decodeInstruction(model,instructionAt(cubin,fn,i).value,i*16));
  const blocks=recoverCFG(insts,{section:fn.section,start:fn.sectionOffset,relocations:cubin.relocations,symbols:cubin.symbols});computeDefuse(insts);computeLiveness(insts,blocks);const ssa=projectSSA(insts,blocks);validateProjection(insts,blocks,ssa);
  // Independently compare the low/high byte reconstruction to every input byte.
  for(let i=0;i<insts.length;i++)for(let b=0;b<16;b++)if(Number(insts[i].encoding>>BigInt(b*8)&255n)!==cubin.bytes[fn.fileOffset+i*16+b])throw new Error('Raw instruction byte validation failed.');
  const tail=cubin.bytes.slice(fn.fileOffset+fn.count*16,fn.fileOffset+fn.size),text=serializeMLIR(fn,model.sm,insts,blocks,ssa,vocabulary,tail),decoded=insts.filter(a=>a.decoded).length;
  return {text,stats:{instructions:insts.length,decoded,raw:insts.length-decoded,blocks:blocks.length,values:ssa.values.length,unresolved:insts.filter(a=>branchEdges(a).unresolved).length,tail:tail.length},instructions:insts.map(a=>({pc:a.pc,decoded:a.decoded,assembly:a.decoded?[a.mnemonic,...a.modifiers].join('.')+(a.operands.length?' '+a.operands.map(printOperand).join(', '):''):'HIDDEN · raw carrier'}))};
}
