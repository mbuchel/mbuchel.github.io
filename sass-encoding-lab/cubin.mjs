// ELF64 CUDA parsing. Architecture flags follow LLVM's ELF definitions:
// https://llvm.org/doxygen/ELFObjectFile_8cpp_source.html (getNVPTXCPUName)
import {hex} from './core.mjs';
const LIMIT=64*1024*1024;
export function cudaArchitecture(flags,abi) {
  if(![7,8].includes(abi)) return {sm:null,name:`Unknown CUDA ABI ${abi}`};
  const sm=abi===7?flags&0xff:(flags>>>8)&0xff;
  const suffix=(sm===90&&(flags&0x800))||(sm>=100&&(flags&8))?'a':'';
  return {sm,name:sm?`sm_${sm}${suffix}`:'Unknown SM'};
}
export function parseCubin(buffer) {
  const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer);
  if(bytes.length>LIMIT) throw new Error('Cubin exceeds the 64 MB limit.');
  if(bytes.length<64) throw new Error('File is too short for an ELF64 header.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(0,false)!==0x7f454c46) throw new Error('Expected a standalone ELF cubin. Extract it from a fatbin or host executable first.');
  if(bytes[4]!==2||bytes[5]!==1) throw new Error('This explorer supports ELF64 little-endian cubins.');
  if(view.getUint16(18,true)!==190) throw new Error('This ELF is not a CUDA cubin (EM_CUDA).');
  if(bytes[6]!==1) throw new Error('Unsupported ELF identification version.');
  const checked=(offset,size,label)=>{
    if(!Number.isSafeInteger(offset)||!Number.isSafeInteger(size)||offset<0||size<0||offset>bytes.length||size>bytes.length-offset) throw new Error(`Truncated or invalid ${label}.`);
  };
  const n64=(offset)=>{const n=view.getBigUint64(offset,true);if(n>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ELF offset or size exceeds the supported range.');return Number(n);};
  const shoff=n64(40),stride=view.getUint16(58,true);
  if(!shoff||stride<64) throw new Error('Missing or invalid ELF section table.');
  checked(shoff,64,'section table');
  const count=view.getUint16(60,true)||n64(shoff+32);
  let namesIndex=view.getUint16(62,true);if(namesIndex===0xffff) namesIndex=view.getUint32(shoff+40,true);
  if(!count||count>65536||namesIndex>=count) throw new Error('Invalid ELF section count or string-table index.');
  checked(shoff,count*stride,'section table');
  const sections=Array.from({length:count},(_,index)=>{
    const p=shoff+index*stride;
    const s={index,nameIndex:view.getUint32(p,true),type:view.getUint32(p+4,true),flags:view.getBigUint64(p+8,true),address:n64(p+16),offset:n64(p+24),size:n64(p+32),link:view.getUint32(p+40,true),info:view.getUint32(p+44,true),entrySize:n64(p+56)};
    if(s.type!==0&&s.type!==8) checked(s.offset,s.size,`section ${index}`);
    return s;
  });
  const decoder=new TextDecoder();
  const cstring=(table,index)=>{
    if(!table||table.type!==3||index>=table.size) throw new Error('Invalid ELF string reference.');
    const start=table.offset+index,end=table.offset+table.size;
    let p=start;while(p<end&&bytes[p]!==0&&p-start<65536)p++;
    if(p===end||p-start===65536)throw new Error('Unterminated ELF string.');
    return decoder.decode(bytes.subarray(start,p));
  };
  for(const section of sections) section.name=cstring(sections[namesIndex],section.nameIndex);
  const text=sections.filter(s=>s.type===1&&(s.name==='.text'||s.name.startsWith('.text.'))&&(s.flags&4n)&&s.size>0);
  const symbols=[],allSymbols=[],symbolTables=new Map();
  for(const table of sections.filter(s=>s.type===2||s.type===11)) {
    if(table.entrySize<24||table.size%table.entrySize!==0||table.size/table.entrySize>1000000) throw new Error('Invalid ELF symbol table.');
    const strings=sections[table.link];
    const entries=[];symbolTables.set(table.index,entries);
    for(let p=table.offset;p<table.offset+table.size;p+=table.entrySize) {
      const section=sections[view.getUint16(p+6,true)],name=cstring(strings,view.getUint32(p,true)),rawValue=view.getBigUint64(p+8,true);
      const record={name,section:section?.name||'',value:rawValue<=BigInt(Number.MAX_SAFE_INTEGER)?Number(rawValue):null};
      entries.push(record);allSymbols.push(record);
      if((bytes[p+4]&15)!==2) continue;
      if(!section||!text.includes(section)) continue;
      const value=n64(p+8),size=n64(p+16),start=value-section.address;
      if(start<0||start>section.size||size>section.size-start) throw new Error('Function symbol lies outside its code section.');
      symbols.push({name:cstring(strings,view.getUint32(p,true))||section.name.slice(6),section,start,size});
    }
  }
  const relocations=[];
  for(const table of sections.filter(s=>s.type===4||s.type===9)){
    const stride=table.entrySize||(table.type===4?24:16),minimum=table.type===4?24:16;
    if(stride<minimum||table.size%stride||table.size/stride>1000000)throw new Error('Invalid ELF relocation table.');
    const entries=symbolTables.get(table.link),target=sections[table.info];
    if(!entries||!target)throw new Error('Invalid ELF relocation section reference.');
    for(let p=table.offset;p<table.offset+table.size;p+=stride){const info=view.getBigUint64(p+8,true),symbolIndex=Number(info>>32n);if(symbolIndex>=entries.length)throw new Error('Invalid ELF relocation symbol index.');relocations.push({target:target.name,offset:n64(p),symbol:entries[symbolIndex].name,type:Number(info&0xffffffffn)});}
  }
  const functions=[];
  for(const section of text) {
    const local=symbols.filter(s=>s.section===section).sort((a,b)=>a.start-b.start);
    if(!local.length) local.push({name:section.name.startsWith('.text.')?section.name.slice(6):section.name,section,start:0,size:section.size,fallback:true});
    for(let i=0;i<local.length;i++) {
      const s=local[i];
      const next=local.find(x=>x.start>s.start)?.start??section.size;
      const size=s.size||next-s.start;
      if(!size) continue;
      const key=`${section.index}:${s.start}:${size}`;
      if(functions.some(f=>f.id===key)) continue;
      functions.push({id:key,name:s.name,section:section.name,sectionIndex:section.index,sectionOffset:s.start,fileOffset:section.offset+s.start,size,count:Math.floor(size/16),trailingBytes:size%16,fallback:!!s.fallback});
    }
  }
  if(!functions.length)throw new Error('No executable .text functions found in this cubin.');
  if(functions.length>20000)throw new Error('Cubin exceeds the 20,000-function limit.');
  const flags=view.getUint32(48,true),abi=bytes[8],arch=cudaArchitecture(flags,abi);
  const warnings=[];
  if(!arch.sm)warnings.push('Architecture could not be identified. Instruction slicing is disabled.');
  else if(arch.sm<70)warnings.push('Pre-Volta instruction/control bundles are not 128-bit instructions. Instruction slicing is disabled.');
  if(functions.some(f=>f.trailingBytes))warnings.push('Some code extents have trailing bytes. Only complete 16-byte instructions are shown.');
  if(functions.some(f=>f.fallback))warnings.push('Some functions use .text section extents because function symbols are absent. Padding may be included.');
  if(sections.some(s=>s.type===4||s.type===9))warnings.push('Relocations are present. Encodings show file bytes before relocation.');
  return {bytes,functions,sections,symbols:allSymbols,relocations,flags,abi,architecture:arch.name,sm:arch.sm,canSlice:arch.sm>=70,warnings};
}
export function instructionAt(cubin,fn,index) {
  if(!cubin.canSlice)throw new Error('128-bit instruction slicing is unavailable for this architecture.');
  if(!Number.isInteger(index)||index<0||index>=fn.count)throw new Error('Instruction index is out of range.');
  const offset=fn.fileOffset+index*16;
  const view=new DataView(cubin.bytes.buffer,cubin.bytes.byteOffset+offset,16);
  const value=view.getBigUint64(0,true)|(view.getBigUint64(8,true)<<64n);
  return {index,offset:index*16,sectionOffset:fn.sectionOffset+index*16,fileOffset:offset,value,hex:hex(value)};
}
