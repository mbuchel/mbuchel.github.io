// SPDX-License-Identifier: AGPL-3.0-or-later
// Port of lib/decoder.cpp and lib/operands.cpp. Tables come from upstream generators.
import {bits,gather,gatherList,ones,u64,reg,pred,mem,imm,floatValue,printFP,printOperand,parseOperand} from './ast.mjs';
const F='kind bit_lo bit_hi reg_kind scale_log2 pc_relative pcrel_scale pcrel_lo_lo pcrel_lo_hi pcrel_has_lo enum_idx enum_count token_idx hi_idx lo_idx mask_lo mask_hi choices_idx choices_count reg_idx ur_idx off_idx bank_idx desc_gate_bit addr_size_bit swizzle_lo keep_urz ur_gate_bit off32_lo off32_gate_bit sext56 desc_gate2_bit named_field'.split(' ');
const value=op=>({op,text:'',separated:false}),literal=text=>({op:null,text:text||'',separated:false});
const text=p=>p.text|| (p.op?printOperand(p.op):'');
const numeric=k=>[0,1,2,3,10,11,20].includes(k);
export function prepareTables(model){
  if(model.prepared)return model;const t=model.tables,p=`sm_${model.sm}_`;
  model.arr=name=>t[p+name]||[];
  model.ref=(r,n)=>r?t[r.r].slice(r.o,r.o+(n??t[r.r].length)):[];
  model.span=s=>s?.length?model.ref(s[0],s[1]):[];
  model.opcodes=new Map(model.arr('opcodes').map(r=>[r[0],r]));
  model.overlays=new Map(model.arr('overlays').map(r=>[r[0],r]));
  model.descs=model.arr('descs').map(row=>Object.fromEntries(F.map((f,i)=>[f,row[i]])));
  model.prepared=true;return model;
}
function mnemonic(model,row,e){
  let rendered=row[3],alias=false;const groups=model.ref(row[4],row[5]);
  const field=(g,word)=>gatherList(word,model.ref(g[4],g[1]));
  for(const g of groups){
    const [kind,n,gate,gateval,,tokensRef,gatesRef,ngates]=g,tokens=model.ref(tokensRef);
    if(kind>=3)continue;
    if(kind===1){alias=false;rendered+=tokens[0];continue;}
    const raw=field(g,e);
    if(kind===2){
      const pow=raw!==0n&&(raw&(raw-1n))===0n,c=raw===0n?0:raw===1n?1:raw===ones(n)?3:pow&&raw<(1n<<BigInt(n-1))&&raw!==(1n<<BigInt(Math.floor(n/2)))?2:4;
      if(alias||gate!==255&&bits(e,gate,gate)!==BigInt(!!gateval)||!tokens[c])continue;
      if(!model.ref(gatesRef,ngates).every(([ref,count,want])=>(gatherList(e,model.ref(ref,count))===ones(count))===!!want))continue;
      rendered+=tokens[c];alias=true;continue;
    }
    alias=false;const token=tokens[Number(raw)];if(token==null)return null;rendered+=token;
  }
  let [head,...modifiers]=rendered.split('.');const base=BigInt(row[2][0])|(BigInt(row[2][1])<<64n);
  for(const g of groups){if(g[0]<3)continue;const tokens=model.ref(g[5]),bv=Number(field(g,base)),v=Number(field(g,e));if(bv===v)continue;
    if(tokens[bv]==null||tokens[v]==null)return null;
    const [fromHead,...from]=tokens[bv].split('.'),[toHead,...to]=tokens[v].split('.');if(fromHead!==toHead)head=toHead;
    for(const token of from){if(to.includes(token))continue;const at=modifiers.indexOf(token);if(at>=0)modifiers.splice(at,1);}
    for(let i=0;i<to.length;i++){if(from.includes(to[i])||modifiers.includes(to[i]))continue;const prev=modifiers.indexOf(to[i-1]),at=i===0?0:prev>=0?prev+1:modifiers.length;modifiers.splice(at,0,to[i]);}
  }
  return {mnemonic:head,modifiers};
}
function decodeMemory(m,d,e,pc,depth){
  const read=i=>desc(m,m.descs[i],e,pc,depth+1),extract=(lo,hi)=>bits(e,lo,hi);
  const gate=d.off32_gate_bit!==255?d.off32_gate_bit:d.addr_size_bit&127;
  const off32=d.off32_lo!==255&&d.addr_size_bit!==255&&d.addr_size_bit!==254&&!extract(gate,gate),hasOff=d.off_idx!==65535,od=hasOff?m.descs[d.off_idx]:null;
  let hasUR=d.ur_idx!==65535&&!off32&&(d.keep_urz!==1||d.ur_gate_bit===255||!!extract(d.ur_gate_bit,d.ur_gate_bit));
  let bank=null,bankPrefix='',bankReg=null,base=d.reg_idx===65535?value(reg('R',0,true)):read(d.reg_idx),r=base.op?.type==='reg'?base.op:null,mods=base.op?.selector?'.'+base.op.selector:'',ur=null,urText='',offset=null,descriptor=false,drop=false,bankZero=false,fallback='';
  const out=mem(),a=out.addr,cx=d.bank_idx!==65535&&m.descs[d.bank_idx].kind===12;
  if(d.bank_idx!==65535){bank=read(d.bank_idx);bankReg=bank.op?.type==='reg'?bank.op:null;bankPrefix=(cx?'cx[':'c[')+text(bank)+']';}
  if(d.addr_size_bit===254)mods+='.64';else if(d.addr_size_bit!==255&&!off32){const b=d.addr_size_bit&127;if(extract(b,b))mods+='.64';else if(r?.file==='R'&&r.zero&&!mods||d.addr_size_bit&128)mods+='.U32';}
  if(d.swizzle_lo!==255)mods+=['','.X4','.X8','.X16'][Number(extract(d.swizzle_lo,d.swizzle_lo+1))&3];
  if(hasOff)offset=read(d.off_idx);
  if(hasUR){const u=read(d.ur_idx);urText=text(u);ur=u.op?.type==='reg'?u.op:null;
    if(d.keep_urz===2&&(d.ur_gate_bit!==255&&extract(d.ur_gate_bit,d.ur_gate_bit)||['URZ','UR0'].includes(urText)))hasUR=false;
    else if(d.keep_urz===3&&['URZ','UR0'].includes(urText)&&hasOff&&extract(od.bit_lo,od.bit_hi))hasUR=false;
    else if(d.keep_urz===0&&['URZ','UR0'].includes(urText))hasUR=false;
  }
  if(hasOff&&[0,10,19].includes(od.kind)){
    const lo=off32?d.off32_lo:od.bit_lo,width=od.bit_hi-lo+1;let v=extract(lo,od.bit_hi);
    if(!off32){if(od.kind===10)v=u64(v<<BigInt(od.scale_log2));else if(od.kind===19)v=0n;}
    const add=hasUR||v!==0n;descriptor=d.desc_gate_bit===254||d.desc_gate_bit!==255&&!!extract(d.desc_gate_bit,d.desc_gate_bit);
    if(descriptor&&d.desc_gate2_bit!==255)descriptor=!!extract(d.desc_gate2_bit,d.desc_gate2_bit);
    drop=r?.file==='R'&&r.zero&&(add||cx)&&mods!=='.U32'&&!descriptor;
    bankZero=d.bank_idx!==65535&&(d.reg_idx===65535||cx&&r?.zero)&&!add&&!mods;
    const shown=descriptor||!drop||hasUR,neg=shown&&od.kind!==10&&width<64&&!!(v&(1n<<BigInt(width-1)));
    if(v||bankZero){a.hex_off=(neg?'-0x':'0x')+(neg?(1n<<BigInt(width))-v:v).toString(16);a.hex_off_present=true;}
  }else if(hasOff)fallback='['+text(base)+mods+'+'+text(offset)+']';
  if(fallback||!r||base.text||hasUR&&(!ur||ur.file!=='UR')){
    if(!fallback){fallback='['+(drop?'':text(base)+mods);if(hasUR&&hasOff&&!descriptor)fallback+=(drop?'':'+')+urText;if(a.hex_off_present)fallback+=(drop&&!hasUR?'':'+')+a.hex_off;fallback+=']';if(descriptor)fallback='desc['+urText+']'+fallback;}
    return value(parseOperand(bankPrefix+fallback));
  }
  out.addr_group=true;
  if(!drop&&!bankZero){if(r.file==='R'){a.has_base=true;a.base={...r};a.base_mods=mods;}else if(r.file==='UR'){a.offreg=r.num;a.offreg_z=r.zero;a.offreg_mods=mods;}else return value(parseOperand('['+text(base)+mods+']'));}
  if(hasUR&&hasOff&&!descriptor){a.offreg=ur.num;a.offreg_z=ur.zero;a.offreg_mods=ur.selector?'.'+ur.selector:'';}
  if(descriptor){out.space=5;out.desc_ur=urText;if(ur?.file==='UR'&&a.has_base){const size=['.8','.16','.32','.64','.128'].indexOf(mods);if(size>=0){out.desc_kind=1;out.desc_reg_size=size;out.desc_ur=urText.split('.')[0];out.desc_ur_mods=ur.selector?'.'+ur.selector:'';}}}
  if(d.bank_idx!==65535){if(descriptor)return value(parseOperand(bankPrefix+printOperand(out)));if(cx&&bankReg){out.space=4;out.cx_bank=bankReg.zero?0:bankReg.num;out.cx_bank_z=bankReg.zero;out.cx_bank_mods=bank.op.selector?'.'+bank.op.selector:'';}else{out.space=3;try{out.bank=Number(BigInt(text(bank)));}catch{out.bank=0;}}}
  return value(out);
}
function desc(m,d,e,pc,depth=0){
  if(!d||depth>16)throw new Error('Invalid recursive operand descriptor.');
  let raw=bits(e,d.bit_lo,d.bit_hi),width=d.bit_hi>=d.bit_lo?d.bit_hi-d.bit_lo+1:0;
  const k=d.kind,read=i=>desc(m,m.descs[i],e,pc,depth+1),rnum=Number(raw&65535n);
  if(k===20){const v=BigInt(d.mask_lo)|BigInt(d.mask_hi)?gather(e,d.mask_lo,d.mask_hi)&65535n:raw;const choice=m.arr('choices').slice(d.choices_idx,d.choices_idx+d.choices_count).find(c=>BigInt(c[0])===v);return choice?read(choice[1]):literal('');}
  if(k===21)return decodeMemory(m,d,e,pc,depth);
  if(k===17)return literal(raw<BigInt(d.enum_count)?m.arr('mod_tokens')[d.enum_idx+Number(raw)]:'');
  if(k===24||k===18)return literal(k===24||bits(e,d.bit_lo,d.bit_lo)?m.arr('flag_tokens')[d.token_idx]:'');
  if(k>=6&&k<=9){const fp=floatValue(k,raw),s=printFP(fp,k===7);return {...value(parseOperand(s)),text:s};}
  if(k===12){const zero=width>0&&raw===ones(width),prefix=['R','UR','P','UP'][d.reg_kind];if(raw>=1000000000n&&!zero){const s=prefix+raw;return {...value(parseOperand(s)),text:s};}return value(d.reg_kind<2?reg(prefix,zero?0:rnum,zero):pred(d.reg_kind===3,zero?0:rnum&255,zero));}
  if(k===25||k===26){const n=ones(width)-raw,all=k===25&&n===7n;return value(pred(k===25,all?0:Number(n&255n),all));}
  if(k===13)return value(parseOperand(m.arr('sreg_names')[Number(raw)]||'SR'+raw));
  if(k===28)return value(reg('GSB',rnum));
  if(k===16||k===29){const ids=[];for(let b=63;b>=0;b--)if(raw&(1n<<BigInt(b)))ids.push(k===16?0:b);return value({type:'barset',ids:ids.length?ids:[0]});}
  if(k===23)return literal(['SB0','SB1','SB2','SB3','SB4','SB5','INVALID6','INVALID7'][Number(raw)]||'DEPBAR_UNKNOWN');
  if(k===34)return literal(['THREAD_STATE_ENUM.0','THREAD_STATE_ENUM.1','THREAD_STATE_ENUM.2','THREAD_STATE_ENUM.3','THREAD_STATE_ENUM.4','TRAP_RETURN_PC.LO','TRAP_RETURN_PC.HI','TRAP_RETURN_MASK','MEXITED','MKILL','MACTIVE','MATEXIT','OPT_STACK','API_CALL_DEPTH','ATEXIT_PC.LO','ATEXIT_PC.HI'][Number(raw)]||'B'+raw);
  if(k===33)return literal([6,4,2,0].map(b=>['PP','PN','NP','ZP'][Number(raw>>BigInt(b)&3n)]).join(''));
  if([14,15,22,27,30,31,32].includes(k)){
    const out=mem();
    if(k===14){out.space=3;out.bank=Number(raw);}
    else if(k===15||k===31){out.space=k===15?5:8;out.desc_ur='UR'+(raw+BigInt(k===31?d.scale_log2:0));}
    else if(k===22){out.space=9;out.addr_group=true;out.addr.hex_off='0x'+raw.toString(16);out.addr.hex_off_present=true;}
    else {out.space=k===27?6:k===30?7:0;out.addr_group=true;out.addr.offreg=Number(raw+BigInt(k===32?d.scale_log2:0));if(k===30){const u=d.ur_idx!==65535?read(d.ur_idx):value(reg('UR',width&&raw===ones(width)?0:rnum,!!width&&raw===ones(width)));if(u.op?.type!=='reg'||u.op.file!=='UR')return literal('tmem['+text(u)+']');out.addr.offreg=u.op.zero?0:u.op.num;out.addr.offreg_z=u.op.zero;if(d.off_idx!==65535){const o=m.descs[d.off_idx],n=bits(e,o.bit_lo,o.bit_hi);if(n){out.addr.hex_off='0x'+n.toString(16);out.addr.hex_off_present=true;}}}}
    return value(out);
  }
  let neg=false,hex=false,separated=false;
  if(k===4||k===5){if(d.pcrel_has_lo){const w=d.pcrel_lo_hi-d.pcrel_lo_lo+1;raw=(raw<<BigInt(w))|bits(e,d.pcrel_lo_lo,d.pcrel_lo_hi);width+=w;}neg=width<64&&!!(raw&(1n<<BigInt(width-1)));raw=(neg?(1n<<BigInt(width))-raw:raw)<<BigInt(d.pcrel_scale);if(k===4){raw=u64(BigInt(pc)+16n+(neg?-raw:raw));neg=false;}else separated=true;hex=true;}
  else if(k===19){const hi=m.descs[d.hi_idx],lo=m.descs[d.lo_idx];raw=u64((bits(e,hi.bit_lo,hi.bit_hi)<<BigInt(lo.bit_hi-lo.bit_lo+1))|bits(e,lo.bit_lo,lo.bit_hi));hex=true;}
  else if(k===35){raw=gather(e,d.mask_lo,d.mask_hi);width=(BigInt(d.mask_lo).toString(2)+BigInt(d.mask_hi).toString(2)).replace(/0/g,'').length;if(d.sext56){if(width<56&&raw&(1n<<BigInt(width-1)))raw|=0xffffffffffffffn<<BigInt(width);raw&=0xffffffffffffffn;}hex=separated=true;}
  else{hex=k===1||k===3;if([2,3,11].includes(k)){neg=!!width&&width<64&&!!(raw&(1n<<BigInt(width-1)));if(neg)raw=(1n<<BigInt(width))-raw;}if(k===10||k===11)raw=u64(raw<<BigInt(d.scale_log2));}
  const out=value(imm(raw,hex,neg));if(!hex&&raw>=0x80000000n)out.text=(neg?'-':'')+raw;out.separated=separated;return out;
}
function slot(m,s,e,pc){const d=m.descs[s[2]],sub=s[1];let p=desc(m,d,e,pc);
  if(numeric(d.kind)&&sub==='unknown_value')p=literal('???');
  else if(numeric(d.kind)&&['reg_num','off_reg','barrier_id'].includes(sub))p=value(parseOperand((sub==='barrier_id'?'B':'R')+text(p)));
  else if(numeric(d.kind)&&sub==='bank_id')p=value(parseOperand('c['+text(p)+']'));
  else if(sub==='mem_addr'&&(numeric(d.kind)||d.kind===12))p=value(parseOperand('['+text(p)+']'));
  if(numeric(d.kind)&&sub==='outer_mods'&&text(p).startsWith('0')){p.text=' '+text(p);p.separated=true;}return p;
}
function append(left,right){
  if(left.op?.type==='mem'&&right.op?.type==='mem'&&!left.op.addr_group&&right.op.space===0){left.op.addr=right.op.addr;left.op.addr_group=right.op.addr_group;return;}
  if(['reg','mem'].includes(left.op?.type)&&!right.op&&right.text.startsWith('.')){left.op.selector=(left.op.selector?left.op.selector+'.':'')+right.text.slice(1);return;}
  left.text=text(left)+text(right);left.op=null;
}
function operands(m,ast,e,pc){
  const ov=m.overlays.get(Number(e&4095n));if(!ov)return false;const slots=m.ref(ov[1],ov[2]),offsets=m.ref(ov[3]),discs=m.ref(ov[7]);let vi=0;
  if(offsets.length&&ov[4]>1){const v=Number(gather(e,ov[5],ov[6])&65535n),index=discs.indexOf(v);if(index>=0)vi=index;}
  const begin=offsets.length?offsets[vi]:0,end=offsets.length?offsets[vi+1]:ov[2];ast.operands=[];if(begin===end)return true;
  const layout=m.ref(ov[12])[vi],promoted=m.span(layout[1]).map(i=>text(slot(m,slots[i],e,pc))).join('');if(promoted)ast.modifiers.push(promoted);
  const rendered=[ast.mnemonic,...ast.modifiers].join('.'),reuseRows=m.ref(ov[10],ov[11]),sig=m.arr('reuse_sigs').indexOf(rendered),probed=sig>=0&&reuseRows.some(r=>r[2]===sig),masks=new Map();
  for(let i=begin;i<end;i++){const s=slots[i],d=m.descs[s[2]];if(d.kind!==12||d.reg_kind>1)continue;const involved=new Set(),votes=new Map();for(const [field,bit,sid] of reuseRows){if(field<d.bit_lo||field>d.bit_hi)continue;const mask=1n<<BigInt(bit-64);if(probed){if(sid===sig)masks.set(s[0],(masks.get(s[0])||0n)|mask);continue;}if(m.arr('reuse_sigs')[sid]?.split('.')[0]!==ast.mnemonic)continue;involved.add(sid);if(!votes.has(mask))votes.set(mask,new Set());votes.get(mask).add(sid);}for(const [mask,voters] of votes)if(voters.size===involved.size)masks.set(s[0],(masks.get(s[0])||0n)|mask);}
  const suppress=index=>{
    if(Number(e&4095n)===0x80c&&index===5&&bits(e,72,72))return false;
    return m.ref(ov[8],ov[9]).some(([op,lo,hi,when,variants])=>{if(op!==index||!(BigInt(variants)&(1n<<BigInt(vi))))return false;const w=hi>=lo?hi-lo+1:0,v=bits(e,lo,hi);if(when!==1)return w>0&&v===ones(w);if(w<=64)return w>0&&v===0n;for(let b=lo;b<=hi;b++){const foreign=slots.slice(begin,end).some(s=>{const d=m.descs[s[2]];return s[0]!==index&&d.bit_hi<128&&d.bit_lo<=d.bit_hi&&b>=d.bit_lo&&b<=d.bit_hi;});if(!foreign&&bits(e,b,b))return false;}return true;});
  };
  const opcode=Number(e&4095n),lea=[0x211,0xc11,0x291,0x811,0x891].includes(opcode)&&!!bits(e,74,74);
  for(const [index,encode,decode] of m.span(layout[0])){
    if(!m.span(decode).length||suppress(index)||opcode===0x23e&&(index===1&&!rendered.includes('PACK_AB')||index===3&&!rendered.includes('MERGE_C')))continue;
    const flags={};for(const i of m.span(encode)){const sub=slots[i][1];if(!['neg','abs','b_neg','pred_neg'].includes(sub))continue;const p=slot(m,slots[i],e,pc);if(p.op||p.text)flags[({neg:'neg',abs:'abs',b_neg:'bnot',pred_neg:'pred_neg'})[sub]]=true;}
    if(lea&&flags.neg){flags.neg=false;flags.bnot=true;}
    let current=null,first=true;const finish=()=>{let o;const fallback=first&&(flags.bnot&&(flags.neg||flags.abs)||flags.pred_neg&&(flags.bnot||flags.neg||flags.abs));if(fallback){let s=text(current);if(flags.abs)s='|'+s+'|';if(flags.neg)s='-'+s;if(flags.bnot)s='~'+s;if(flags.pred_neg)s='!'+s;o=parseOperand(s);}else{o=current.op||parseOperand(current.text);if(first){o.neg=!!o.neg||!!flags.neg||!!flags.pred_neg;o.abs=!!o.abs||!!flags.abs;o.bnot=!!o.bnot||!!flags.bnot;}}if(first&&masks.has(index))o.reuse=!!((e>>64n)&masks.get(index));first=false;o.space_sep=current.separated;ast.operands.push(o);};
    for(const i of m.span(decode)){const p=slot(m,slots[i],e,pc);if(!p.op&&!p.text)continue;if(!p.op&&p.text.startsWith(' ')){p.text=p.text.trimStart();p.separated=true;}if(!current||p.separated){if(current)finish();current=p;}else append(current,p);}if(current)finish();
  }return true;
}
export function decodeInstruction(model,e,pc=0){
  const m=prepareTables(model),op=Number(e&4095n),row=m.opcodes.get(op),base={encoding:e,pc,decoded:false,mnemonic:'HIDDEN',modifiers:[],operands:[],defs:[],uses:[],has_guard:false,guard_neg:false,guard:pred()};
  if((m.sm==='90'||m.sm==='90a')&&(op===0x9a8&&(!bits(e,91,91)||bits(e,70,71)===2n)||[0x248,0x848,0xc48].includes(op)&&bits(e,81,83)!==7n&&bits(e,84,86)===7n))return base;
  if(!row)return base;const name=mnemonic(m,row,e);if(!name)return base;
  Object.assign(base,name);const p=Number(bits(e,12,14)),neg=!!bits(e,15,15);base.guard_neg=neg;base.has_guard=p!==7||neg;if(base.has_guard)base.guard=pred(!!row[6],p===7?0:p,p===7);
  base.decoded=true;operands(m,base,e,pc);return base;
}
