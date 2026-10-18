export const SCHEMA = 'sass-encoding-lab/v1';
export const MAX128 = (1n << 128n) - 1n;

export function parseEncoding(raw, format = 'hex') {
  const binary = format === 'binary';
  let value = String(raw).trim().replace(/[\s_]/g, '');
  value = value.replace(binary ? /^0b/i : /^0x/i, '');
  const length = binary ? 128 : 32;
  if (!value) throw new Error(`Enter ${length} ${binary ? 'binary digits' : 'hex digits'}.`);
  if (!(binary ? /^[01]+$/ : /^[0-9a-f]+$/i).test(value)) {
    throw new Error(binary ? 'Use only 0 and 1 (spaces and underscores are allowed).' : 'Use hexadecimal digits 0–9 and A–F (spaces and underscores are allowed).');
  }
  if (value.length !== length) throw new Error(`Expected ${length} digits; received ${value.length}. Leading zeros are required.`);
  return BigInt((binary ? '0b' : '0x') + value);
}

export function hex(value) { return value.toString(16).toUpperCase().padStart(32, '0'); }
export function formatEncoding(value, format) {
  return format === 'binary' ? value.toString(2).padStart(128, '0').match(/.{8}/g).join(' ') : hex(value).match(/.{8}/g).join(' ');
}
export function validateRange(hi, lo) {
  if (!Number.isInteger(hi) || !Number.isInteger(lo) || hi > 127 || lo < 0 || hi < lo) throw new Error('Use integer bits with 127 ≥ high ≥ low ≥ 0.');
  return {hi, lo};
}
export function mask(hi, lo) { validateRange(hi, lo); return ((1n << BigInt(hi-lo+1))-1n) << BigInt(lo); }
export function extract(value, hi, lo) { return (value & mask(hi, lo)) >> BigInt(lo); }
export function validateBits(bits) {
  if(!Array.isArray(bits)||!bits.length||bits.length>128||new Set(bits).size!==bits.length||bits.some(b=>!Number.isInteger(b)||b<0||b>127))throw new Error('Use a comma-separated list of unique integer bits from 0 to 127.');
  return [...bits].sort((a,b)=>a-b);
}
export function extractBits(value,bits) {return validateBits(bits).reduce((v,bit,i)=>v|(((value>>BigInt(bit))&1n)<<BigInt(i)),0n);}
export function changedBits(a, b) {
  const xor = a ^ b;
  return Array.from({length:128}, (_, bit) => bit).filter(bit => Boolean(xor & (1n << BigInt(bit))));
}
export function changedRanges(a, b) {
  const bits = changedBits(a, b), ranges=[];
  for (const bit of bits) {
    const previous=ranges[ranges.length-1];
    if (previous && previous.hi+1 === bit) previous.hi=bit;
    else ranges.push({lo:bit, hi:bit});
  }
  return ranges.reverse();
}
export function rangeLabel(hi,lo) { return hi === lo ? `[${lo}]` : `[${hi}:${lo}]`; }
export function flipBit(value, bit) { validateRange(bit,bit); return value ^ (1n << BigInt(bit)); }
export function freshDraft() {
  return { title:'', architecture:'', format:'hex', aRaw:'', bRaw:'', pcA:'0x0', pcB:'0x0', assemblyA:'', assemblyB:'', observation:'', setup:'', notes:'', hypotheses:[] };
}
export function parsePC(text){
  const s=String(text).trim();if(!/^(?:0x[0-9a-f]{1,16}|[0-9]{1,20})$/i.test(s))throw new Error('PC must be a nonnegative hexadecimal or decimal 64-bit address.');
  const value=BigInt(s);if(value>0xffffffffffffffffn||value%16n)throw new Error('PC must fit in 64 bits and be aligned to 16 bytes.');return value;
}
export function exampleDraft() {
  const a = 0x00000000000000000000000000000001n;
  return {...freshDraft(), title:'Synthetic · single-bit experiment', architecture:'Synthetic example', aRaw:formatEncoding(a,'hex'), bRaw:formatEncoding(flipBit(a,109),'hex'), assemblyA:'Synthetic baseline (not a real opcode)', assemblyB:'Synthetic variant (not executed)', setup:'Illustration only. Replace these values with encodings from your own disassembly.', observation:'No GPU execution has been performed. The example only demonstrates a one-bit difference.', notes:'Bit 109 has no assigned architectural meaning here. This tool does not infer instruction semantics.'};
}

const statuses = new Set(['untested','supported','refuted','inconclusive']);
function string(value, name, max=50000) {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid ${name}.`);
  return value;
}
export function validateDraft(d) {
  if (!d || typeof d !== 'object') throw new Error('Invalid experiment.');
  const out = freshDraft();
  for (const key of Object.keys(out).filter(k=>k!=='hypotheses')) out[key] = string((key==='pcA'||key==='pcB')?(d[key]??'0x0'):d[key],key,key.endsWith('Raw')?1000:key.startsWith('pc')?40:50000);
  if (!['hex','binary'].includes(out.format)) throw new Error('Invalid input format.');
  if (!Array.isArray(d.hypotheses) || d.hypotheses.length>1000) throw new Error('Invalid hypotheses.');
  out.hypotheses = d.hypotheses.map(h=>{
    validateRange(h.hi,h.lo);
    if (!statuses.has(h.status)) throw new Error('Invalid hypothesis status.');
    const result={ id:string(h.id,'hypothesis ID',100), hi:h.hi, lo:h.lo, label:string(h.label,'field label',200), claim:string(h.claim,'claim'), status:h.status, test:string(h.test,'next test'), evidence:string(h.evidence,'evidence') };
    if(h.bits){result.bits=validateBits(h.bits);if(result.bits[0]!==h.lo||result.bits.at(-1)!==h.hi)throw new Error('Bit list must agree with its high and low bounds.');}
    return result;
  });
  if(new Set(out.hypotheses.map(h=>h.id)).size!==out.hypotheses.length) throw new Error('Duplicate hypothesis IDs.');
  return out;
}
export function snapshot(draft, id, createdAt, now) {
  const data=validateDraft(draft);
  parsePC(data.pcA);parsePC(data.pcB);
  const a=parseEncoding(data.aRaw,data.format), b=parseEncoding(data.bRaw,data.format);
  if (!data.title.trim()) throw new Error('Give this experiment a title before saving.');
  return {id, createdAt, updatedAt:now, data, a:hex(a), b:hex(b)};
}
export function snapshotWorkspace(kind, input, id, createdAt, now) {
  if(!['binary','compare'].includes(kind)||!input||typeof input!=='object')throw new Error('Invalid workspace experiment.');
  const title=string(input.title,'experiment title'),architecture=string(input.architecture??'','experiment architecture',200),notes=string(input.notes,'experiment notes');
  const hypothesis=string(input.hypothesis??'','hypothesis'),setup=string(input.setup??'','experiment setup'),observation=string(input.observation??'','observed behaviours');
  if(!title.trim())throw new Error('Give this experiment a title before saving.');
  if(!Array.isArray(input.functions)||input.functions.length!==(kind==='binary'?1:2))throw new Error('Load the selected function(s) before saving this experiment.');
  const functions=input.functions.map(fn=>{
    if(!fn||typeof fn!=='object')throw new Error('Invalid saved function.');
    const text=string(fn.text,'MLIR source',12*1024*1024);
    if(!text.trim()||!Number.isSafeInteger(fn.lineStart)||fn.lineStart<1||fn.lineStart>10000000)throw new Error('Invalid saved MLIR source.');
    const result={name:string(fn.name,'function name',4096),text,source:string(fn.source,'source name',4096),lineStart:fn.lineStart,architecture:string(fn.architecture??'','architecture',200),digest:string(fn.digest??'','cubin hash',64)};
    if(result.digest&&!/^[a-f0-9]{64}$/i.test(result.digest))throw new Error('Invalid saved cubin hash.');
    if(fn.generatedId)result.generatedId=string(fn.generatedId,'generated function ID',200);
    return result;
  });
  const s=input.settings;
  if(!s||typeof s!=='object')throw new Error('Invalid workspace settings.');
  const block=value=>{if(value!==null&&(!Number.isSafeInteger(value)||value<0||value>100000))throw new Error('Invalid saved block selection.');return value;};
  let settings;
  if(kind==='binary') {
    if(!Number.isSafeInteger(s.page)||s.page<0||s.page>100000)throw new Error('Invalid saved source page.');
    settings={block:block(s.block),query:string(s.query,'source search',50000),page:s.page};
  } else {
    if(!['label','order'].includes(s.match)||!['function','blocks'].includes(s.scope)||['linked','scroll','changesOnly'].some(k=>typeof s[k]!=='boolean')||!Array.isArray(s.blocks)||s.blocks.length!==2)throw new Error('Invalid saved comparison settings.');
    settings={match:s.match,scope:s.scope,linked:s.linked,scroll:s.scroll,changesOnly:s.changesOnly,blocks:s.blocks.map(block)};
  }
  return {kind,id,createdAt,updatedAt:now,data:{title,architecture,notes,hypothesis,setup,observation,functions,settings}};
}
export function exportNotebook(experiments, draft, activeId, now) {
  return JSON.stringify({schema:SCHEMA,exportedAt:now,experiments,draft,activeId},null,2);
}
export function importNotebook(raw) {
  if(raw.length > 10*1024*1024) throw new Error('Notebook exceeds the 10 MB import limit.');
  let value;
  try { value=JSON.parse(raw); } catch { throw new Error('This file is not valid JSON.'); }
  if(value?.schema!==SCHEMA) throw new Error('Unsupported notebook format. Use an export from SASS Encoding Lab.');
  if(!Array.isArray(value.experiments) || value.experiments.length>2000) throw new Error('Invalid experiment list (maximum 2,000).');
  const experiments=value.experiments.map(x=>{
    const id=string(x.id,'experiment ID',100);
    const createdAt=string(x.createdAt,'creation date',100), updatedAt=string(x.updatedAt,'update date',100);
    if(!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new Error('Invalid experiment date.');
    if(x.kind===undefined||x.kind==='encoding')return snapshot(x.data,id,createdAt,updatedAt);
    return snapshotWorkspace(x.kind,x.data,id,createdAt,updatedAt);
  });
  if(new Set(experiments.map(x=>x.id)).size!==experiments.length) throw new Error('Duplicate experiment IDs.');
  const draft=validateDraft(value.draft);
  const activeId=typeof value.activeId==='string' && experiments.some(x=>x.id===value.activeId&&!x.kind)?value.activeId:null;
  return {experiments,draft,activeId};
}

export function mergeNotebook(current, incoming) {
  const merged=new Map(current.map(x=>[x.id,x]));
  for(const x of incoming) {
    const previous=merged.get(x.id);
    if(!previous || Date.parse(x.updatedAt)>Date.parse(previous.updatedAt)) merged.set(x.id,x);
  }
  return [...merged.values()];
}
