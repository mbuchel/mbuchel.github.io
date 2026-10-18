// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser port of common/disassembler/{parser,print}.cpp from the supplied repo.
export const u64=n=>BigInt.asUintN(64,BigInt(n));
export const ones=n=>n>=64?0xffffffffffffffffn:n>0?(1n<<BigInt(n))-1n:0n;
export function bits(e,lo,hi){return hi<lo||hi>=128||hi-lo>=64?0n:(e>>BigInt(lo))&ones(hi-lo+1);}
export function gather(e,low,high=0){let mask=BigInt(low)|(BigInt(high)<<64n),out=0n,k=0n;for(let b=0n;b<128n&&k<64n;b++)if(mask&(1n<<b)){out|=((e>>b)&1n)<<k;k++;}return out;}
export function gatherList(e,list){let v=0n;for(let i=0;i<list.length;i++)v|=bits(e,list[i],list[i])<<BigInt(i);return v;}
export const reg=(file='R',num=0,zero=false)=>({type:'reg',file,num,zero});
export const pred=(uniform=false,num=0,all=false)=>({type:'pred',uniform,num,all});
export const mem=()=>({type:'mem',space:0,bank:-1,desc_ur:'',desc_kind:0,desc_reg_size:0,desc_ur_mods:'',cx_bank:-1,cx_bank_z:false,cx_bank_mods:'',addr:{has_base:false,base:reg(),base_mods:'',offreg:-1,offreg_z:false,offreg_mods:'',hex_off:'0x0',hex_off_present:false},addr_group:false,group_spaced:false});
export const imm=(data=0n,hex=false,neg=false)=>({type:'imm',kind:!hex&&data>=0x80000000n?2:hex?0:1,data:u64(data),fp:!hex&&data>=0x80000000n?Number(data):0,f64:!hex&&data>=0x80000000n,neg});
const buf=new DataView(new ArrayBuffer(8));
export function fpBits(value){buf.setFloat64(0,value,true);return buf.getBigUint64(0,true);}
export function floatValue(kind,raw){
  if(kind===7){buf.setBigUint64(0,raw<<32n,true);return buf.getFloat64(0,true);}
  if(kind===8){const h=Number(raw)&65535,s=h>>15?-1:1,x=(h>>10)&31,m=h&1023;return s*(x===31?m?NaN:Infinity:x===0?m*2**-24:(m+1024)*2**(x-25));}
  buf.setUint32(0,Number(kind===9?raw<<16n:raw),true);return buf.getFloat32(0,true);
}
export function printFP(d,f64=false){
  const neg=d<0||Object.is(d,-0),a=Math.abs(d),sign=neg?'-':'';
  if(!Number.isFinite(a))return sign+(neg?'':'+')+(Number.isNaN(a)?'QNAN':'INF');
  if(a===0)return neg?'-0.0':'0';
  if(Number.isInteger(a)&&a<(f64?1e9:2147483648))return sign+String(a);
  const b=fpBits(a),ex=Number((b>>52n)&2047n),mant=(b&0xfffffffffffffn)|(ex?1n<<52n:0n),e=ex?ex-1075:-1074;
  let digits=(e>=0?mant<<BigInt(e):mant*5n**BigInt(-e)).toString(),point=digits.length+(e<0?e:0);
  const sci=point-1< -4||point-1>=(f64?9:17),keep=f64&&a>=1?21:20;
  if(digits.length>keep){const tail=digits.slice(keep),up=tail[0]>'5'||tail[0]==='5'&&(/[1-9]/.test(tail.slice(1))||Number(digits[keep-1])%2);digits=(BigInt(digits.slice(0,keep))+(up?1n:0n)).toString();}
  digits=digits.replace(/0+$/,'');
  if(sci){if(f64&&keep===21)digits=digits.padEnd(keep,'0');return sign+digits[0]+(digits.length>1?'.'+digits.slice(1):'')+'e'+(point-1<0?'-':'+')+String(Math.abs(point-1)).padStart(2,'0');}
  return sign+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));
}
export function printReg(r){return r.file==='PC'?'Rpc':r.file==='GSB'?'gsb'+r.num:r.file+(r.zero?'Z':r.num);}
export function printMem(m){
  let s=m.space===3?'c[0x'+BigInt(m.bank).toString(16)+']':m.space===4?'cx'+(m.cx_bank>=0?'[UR'+(m.cx_bank_z?'Z':m.cx_bank)+m.cx_bank_mods+']':''):m.space===5||m.space===8?(m.space===5?'desc':'idesc')+'['+m.desc_ur+m.desc_ur_mods+']':({6:'gdesc',7:'tmem',9:'a'})[m.space]||'';
  if(!m.addr_group)return s;const a=m.addr,p=[];
  if(a.has_base)p.push(printReg(a.base)+a.base_mods);
  if(a.offreg>=0)p.push('UR'+(a.offreg_z?'Z':a.offreg)+a.offreg_mods);
  if(a.hex_off_present)p.push(a.hex_off);
  return s+(m.group_spaced?' ':'')+'['+p.join('+')+']';
}
export function printOperand(o){
  let s=o.type==='reg'?printReg(o):o.type==='pred'?(o.uniform?'UP':'P')+(o.num===255?'R':o.all?'T':o.num):o.type==='imm'?o.kind===2?printFP(o.neg?-o.fp:o.fp,o.f64):(o.neg?'-':'')+(o.kind===0?'0x'+o.data.toString(16):o.data.toString()):o.type==='mem'?printMem(o):o.type==='barset'?'{'+o.ids.join(',')+'}':o.type==='label'?'`('+o.text+')':o.text||'';
  if(o.abs)s='|'+s+'|';if(o.reuse)s+='.reuse';if(o.selector)s+='.'+o.selector;if(o.bnot)s='~'+s;if(o.neg&&o.type!=='imm')s=(o.type==='pred'?'!':'-')+s;return s;
}
export function parseOperand(input){
  let s=input.trim(),flags={};
  s=s.replace(/\.reuse(?=\.|$)/,()=>{flags.reuse=true;return '';});
  while(s.startsWith('-')){flags.neg=true;s=s.slice(1);}
  if(s.startsWith('|')&&s.endsWith('|')){flags.abs=true;s=s.slice(1,-1);}
  if(s.startsWith('~')){flags.bnot=true;s=s.slice(1);}
  if(s.startsWith('!')){flags.neg=true;s=s.slice(1);}
  if(s.startsWith('+'))s=s.slice(1);
  let v=null,m;
  if((m=/^(UR|R|SB|B|gsb)(Z|[+]?\d+)(?:\.(.*))?$/.exec(s)))v={...reg(m[1]==='gsb'?'GSB':m[1],m[2]==='Z'?0:Number(BigInt(m[2])&65535n),m[2]==='Z'),selector:m[3]||''};
  else if(s==='Rpc')v=reg('PC');
  else if((m=/^(UP|P)(T|R|\d+)$/.exec(s)))v=pred(m[1]==='UP',m[2]==='T'?0:m[2]==='R'?255:Number(m[2])&255,m[2]==='T');
  else if(s.startsWith('{'))v={type:'barset',ids:s.slice(1,-1).split(',').map(n=>parseInt(n)||0)};
  else if(s.includes('['))v=parseMem(s);
  else if(/^SR(?:_|\d|Z)/.test(s))v={type:'special',text:s};
  else if(s.startsWith('`'))v={type:'label',text:s.slice(1).replace(/^\((.*)\)$/,'$1')};
  else if(/^0x[0-9a-f]+$/i.test(s))v=imm(BigInt(s),true);
  else if(/^\d+$/.test(s))v=imm(BigInt(s));
  else if(/^(?:\d+(?:\.\d*)?(?:e[+-]?\d+)?|INF|QNAN|NAN)$/i.test(s)){const fp=/INF/i.test(s)?Infinity:/NAN/i.test(s)?NaN:Number(s),sig=s.split(/e/i)[0].replace(/[^\d]/g,'').replace(/^0+/,'').length;v={type:'imm',kind:2,data:0n,fp,f64:Number.isFinite(fp)&&(sig>=21||Math.fround(fp)!==fp)};}
  return {...(v||{type:'opaque',kind:0,text:s,num:0}),...flags};
}
function parseMem(s){
  const m=mem(),groups=[...s.matchAll(/\[([^\]]*)\]/g)],prefix=s.slice(0,s.indexOf('['));let index=0;
  if(!groups.length)return null;
  if(prefix==='c'){m.space=3;try{m.bank=Number(BigInt(groups[index++][1]));}catch{return null;}}
  else if(prefix==='cx'){m.space=4;const r=/^UR(Z|\d+)(.*)$/.exec(groups[index++][1]);if(!r)return null;m.cx_bank=r[1]==='Z'?0:Number(r[1]);m.cx_bank_z=r[1]==='Z';m.cx_bank_mods=r[2];}
  else if(prefix==='desc'||prefix==='idesc'){m.space=prefix==='desc'?5:8;m.desc_ur=groups[index++][1];}
  else if(prefix)m.space=({gdesc:6,tmem:7,a:9})[prefix]??-1;
  if(m.space<0)return null;
  if(index>=groups.length)return m;
  if(index+1!==groups.length)return null;
  const g=groups[index][1],a=m.addr;m.addr_group=true;m.group_spaced=/\]\s+\[/.test(s);
  let rest=g;
  const base=/^(R(?:Z|\d+))((?:\.[a-z0-9]+)*)/i.exec(rest);
  if(base){if(base[1]!=='RZ'&&BigInt(base[1].slice(1))>0xffffffffn)return null;a.base=parseOperand(base[1]);a.has_base=true;a.base_mods=base[2];rest=rest.slice(base[0].length);}
  if(rest.startsWith('+'))rest=rest.slice(1);
  const ur=/^UR(Z|\d+)((?:\.[a-z0-9]+)*)/i.exec(rest);
  if(ur){if(ur[1]!=='Z'&&BigInt(ur[1])>0xffffffffn)return null;a.offreg=ur[1]==='Z'?0:Number(ur[1]);a.offreg_z=ur[1]==='Z';a.offreg_mods=ur[2];rest=rest.slice(ur[0].length);}
  if(rest.startsWith('+'))rest=rest.slice(1);
  if(rest){if(!/^-?0x[0-9a-f]+$/i.test(rest))return null;a.hex_off=rest;a.hex_off_present=true;}
  if(m.space===5&&a.has_base&&/^UR(?:\d+|Z)/.test(m.desc_ur)&&/^\.(?:8|16|32|64|128)$/.test(a.base_mods)){m.desc_kind=1;m.desc_reg_size=['.8','.16','.32','.64','.128'].indexOf(a.base_mods);const d=/^(UR(?:\d+|Z))(.*)$/.exec(m.desc_ur);m.desc_ur=d[1];m.desc_ur_mods=d[2];}
  return m;
}
