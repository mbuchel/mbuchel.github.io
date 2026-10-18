const modifierFields=new Set(['OuterModsLoc','PredNegLoc','AbsLoc','NegLoc','BNegLoc']);
export function referenceFields(fields,model,opcode,architecture){
  const out=fields.map(f=>({...f,role:f.operand==='control'?(['pred','reuse'].includes(f.name)?1:4):modifierFields.has(f.name)?1:2}));
  const row=model?.opcodes.get(opcode);
  if(row)model.ref(row[4],row[5]).forEach((group,index)=>{
    if(group[0]===1)return;
    const bits=new Set(model.ref(group[4],group[1]));
    if(group[2]!==255)bits.add(group[2]);
    for(const [ref,count]of model.ref(group[6],group[7]))for(const bit of model.ref(ref,count))bits.add(bit);
    if(bits.size)out.push({operand:'mnemonic',name:`Mnemonic group ${index+1}`,kind:'modifier / alias dependency',role:1,bits:[...bits].sort((a,b)=>a-b),values:[],lines:[],sourcePath:`opcodes/${architecture}/mnem_groups.tsv`,sourceArchive:'opcodes'});
  });
  return out;
}
export function bitRoles(fields){
  const roles=new Uint8Array(128);
  for(const field of fields)for(const bit of field.bits)if(Number.isInteger(bit)&&bit>=0&&bit<128)roles[bit]|=field.role;
  return roles;
}
export function roleClass(role){return (role&3)===3?'role-both':role&1?'role-modifier':role&2?'role-operand':'role-shared';}
export function roleLabel(role){return (role&3)===3?'modifier + operand':role&1?'modifier':role&2?'operand':role&4?'shared / control':'unassigned';}
