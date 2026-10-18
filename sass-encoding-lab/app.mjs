import {parseEncoding,hex,formatEncoding,changedBits,changedRanges,rangeLabel,extract,extractBits,validateBits,flipBit,validateRange,freshDraft,exampleDraft,snapshot,snapshotWorkspace,exportNotebook,importNotebook,mergeNotebook} from './core.mjs';
import {mountBinaryExplorer} from './binary-ui.mjs';
import {mountReference} from './reference-ui.mjs';
import {mountDecodedPair} from './decoded-pair.mjs';

const $ = id => document.getElementById(id);
const STORAGE_KEY='sass-encoding-lab.v1';
let experiments=[], draft=exampleDraft(), activeId=null, selected={hi:11,lo:0}, anchor=0;
let reference=null, sourceFields=[], decodedPair=null;
let values=null, dirty=false, storageOK=true, editingHypothesis=null, incomingDraft=null, toastTimer;
let confirmResolve=null;
let currentView='encoding',workspaceIds={binary:null,compare:null};
const workspaceFields=['title','architecture','observation','setup','notes','hypothesis'];
const workspaceInput=(kind,key)=>$(kind+'-'+(key==='title'?'experiment-title':key));
const clone=x=>JSON.parse(JSON.stringify(x));
const uid=()=>crypto.randomUUID();
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const now=()=>new Date().toISOString();

function toast(message) {
  $('toast').textContent=message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),5000);
}
function showStorageStatus() {
  $('draft-status').innerHTML=storageOK?'<span class="save-dot"></span>Draft autosaved in this browser':'Local save unavailable · export to keep changes';
  if(!storageOK) $('draft-status').style.color='#efb3a2';
}
function persist() {
  if(storageOK) {
    try { localStorage.setItem(STORAGE_KEY,exportNotebook(experiments,draft,activeId,now())); }
    catch { storageOK=false;toast('Browser storage is unavailable or full. Export your notebook to keep this work.'); }
  }
  showStorageStatus();
}
try {
  const saved=localStorage.getItem(STORAGE_KEY);
  if(saved) {
    const loaded=importNotebook(saved);
    experiments=loaded.experiments;draft=loaded.draft;activeId=loaded.activeId;
    dirty=activeId?JSON.stringify(draft)!==JSON.stringify(experiments.find(x=>x.id===activeId).data):true;
  }
} catch {
  storageOK=false;
  toast('The saved notebook could not be loaded. Its original data has been preserved. Import a backup to recover; export new work before closing.');
}

function markDirty() {
  dirty=true;
  updateRecordStatus();
  persist();
}
function updateRecordStatus() {
  $('record-status').textContent=activeId?(dirty?'Unsaved changes':'Saved record'):'New experiment';
  $('save-button').innerHTML=(activeId?'Update experiment':'Save experiment')+' <span aria-hidden="true">↗</span>';
  $('duplicate-button').hidden=!activeId;
}
function readPair() {
  let valid=true;
  const parsed=[];
  ['a','b'].forEach((letter,i)=>{
    try {
      parsed.push(parseEncoding(draft[letter+'Raw'],draft.format));
      $('error-'+letter).textContent='';
      $('encoding-'+letter).setAttribute('aria-invalid','false');
      $('valid-'+letter).textContent='128 / 128 bits';
      $('valid-'+letter).classList.add('valid');
    } catch(error) {
      valid=false;
      $('error-'+letter).textContent=draft[letter+'Raw'].trim()?error.message:'';
      $('encoding-'+letter).setAttribute('aria-invalid',draft[letter+'Raw'].trim()?'true':'false');
      $('valid-'+letter).textContent=draft[letter+'Raw'].trim()?'Check input':'128-bit input';
      $('valid-'+letter).classList.remove('valid');
    }
  });
  values=valid?{a:parsed[0],b:parsed[1]}:null;
  $('save-button').disabled=!valid;
  $('copy-xor').disabled=!valid;
  $('mutate-toggle').disabled=!valid;
  if(!valid) $('mutate-toggle').checked=false;
  renderBits();
  renderInspector();
  reference?.refresh();
  decodedPair?.refresh();
}
function renderBits(focusBit=null) {
  if(!values) {
    $('bit-grid').innerHTML='<div class="bit-empty"><span class="bit-empty-symbol" aria-hidden="true">01 ⊕ 01</span><strong>Your next experiment starts with a pair.</strong><span>Enter two 128-bit encodings above, or try the synthetic example.</span></div>';
    $('diff-count').textContent='Awaiting encodings';
    $('diff-count').classList.remove('identical');
    $('xor-mask').textContent='—';
    $('changed-ranges').innerHTML='';
    return;
  }
  const {a,b}=values, changed=changedBits(a,b), xor=a^b;
  $('diff-count').textContent=`${changed.length} / 128 bits differ`;
  $('diff-count').classList.toggle('identical',changed.length===0);
  $('xor-mask').textContent=hex(xor).match(/.{8}/g).join(' ');
  let html='';
  for(let row=3;row>=0;row--) {
    html+='<div class="bit-row"><div class="bit-row-label"><span>'+String(row*32+31).padStart(3,'0')+'</span><div class="ab">A<br><span>B</span></div></div><div class="bit-cells">';
    for(let bit=row*32+31;bit>=row*32;bit--) {
      const av=Number((a>>BigInt(bit))&1n),bv=Number((b>>BigInt(bit))&1n);
      const isSelected=selected.bits?selected.bits.includes(bit):bit>=selected.lo&&bit<=selected.hi;
      const hs=draft.hypotheses.filter(h=>h.bits?h.bits.includes(bit):bit>=h.lo&&bit<=h.hi);
      const source=sourceFields.filter(f=>f.bits.includes(bit));
      const title=`Bit ${bit} · A: ${av}, B: ${bv}${hs.length?' · '+hs.map(h=>h.label).join(', '):''}${source.length?' · Source: '+source.map(f=>'op'+f.operand+' '+f.name).join(', '):''}`;
      html+=`<button type="button" class="bit${av!==bv?' changed':''}${isSelected?' selected':''}${hs.length||source.length?' annotated':''}${bit%4===0?' nibble-edge':''}" data-bit="${bit}" tabindex="${bit===(focusBit??selected.lo)?0:-1}" aria-label="${escape(title)}" aria-pressed="${isSelected}" title="${escape(title)}"><span class="bit-index">${bit}</span><span>${av}</span><span>${bv}</span></button>`;
    }
    html+='</div></div>';
  }
  $('bit-grid').innerHTML=html;
  const ranges=changedRanges(a,b);
  $('changed-ranges').innerHTML=changed.length?'<span>Changed ranges</span>'+ranges.map(r=>`<button class="range-chip" data-range="${r.hi}:${r.lo}">${rangeLabel(r.hi,r.lo)}</button>`).join(''):'<span>Identical encodings · no differing bits</span>';
  if(focusBit!==null) $('bit-grid').querySelector(`[data-bit="${focusBit}"]`)?.focus({preventScroll:true});
}
function renderInspector() {
  $('field-hi').value=selected.hi;
  $('field-lo').value=selected.lo;
  $('selected-label').textContent='FIELD '+(selected.bits?'{'+selected.bits.join(',')+'}':rangeLabel(selected.hi,selected.lo))+' · '+(selected.bits?.length??selected.hi-selected.lo+1)+' BITS';
  if(values) {
    const a=selected.bits?extractBits(values.a,selected.bits):extract(values.a,selected.hi,selected.lo),b=selected.bits?extractBits(values.b,selected.bits):extract(values.b,selected.hi,selected.lo);
    $('field-a').textContent='0x'+a.toString(16).toUpperCase();
    $('field-b').textContent='0x'+b.toString(16).toUpperCase();
    $('field-decimal').textContent=`${selected.bits?'packed, ascending indices · ':'unsigned '}${a.toString()} → ${b.toString()}`;
  } else {
    $('field-a').textContent='—';$('field-b').textContent='—';
    $('field-decimal').textContent='Enter a pair to inspect a field';
  }
}
function selectRange(hi,lo,focusBit=null) {
  try { validateRange(hi,lo); }
  catch(error) { $('range-error').textContent=error.message;return; }
  selected={hi,lo};$('range-error').textContent='';renderBits(focusBit);renderInspector();
}
function bindDraft() {
  document.querySelectorAll('[data-draft]').forEach(el=>el.value=draft[el.dataset.draft]);
  document.querySelectorAll('[data-format]').forEach(el=>{
    const active=el.dataset.format===draft.format;
    el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));
  });
  const binary=draft.format==='binary';
  ['a','b'].forEach(letter=>{
    $('encoding-'+letter).placeholder=binary?'00000000 00000000 … (128 binary digits)':'00000000 00000000 00000000 00000000';
    $('encoding-'+letter).style.height=binary?'100px':'';
  });
  $('mutate-toggle').checked=false;
  readPair();renderHypotheses();updateRecordStatus();renderNotebook();showStorageStatus();
}
function switchTab(name,kind='') {
  const prefix=kind?kind+'-':'';
  for(const tab of ['observations','hypotheses']) {
    const active=name===tab;
    $(prefix+'tab-'+tab).classList.toggle('active',active);$(prefix+'tab-'+tab).setAttribute('aria-selected',String(active));
    $(prefix+'tab-'+tab).tabIndex=active?0:-1;
    $(prefix+'pane-'+tab).hidden=!active;
  }
}
function renderHypotheses() {
  $('hypothesis-count').textContent=draft.hypotheses.length;
  $('hypothesis-list').innerHTML=draft.hypotheses.length?draft.hypotheses.map(h=>`<article class="hypothesis-card"><header><button class="field-tag" data-h-range="${escape(h.id)}">${h.bits?'{'+h.bits.join(',')+'}':rangeLabel(h.hi,h.lo)}</button><h3>${escape(h.label)}</h3><span class="status ${h.status}">${h.status[0].toUpperCase()+h.status.slice(1)}</span></header><p>${escape(h.claim)}</p>${h.evidence?`<div class="hypothesis-detail"><strong>Evidence / rationale</strong><p>${escape(h.evidence)}</p></div>`:''}${h.test?`<div class="hypothesis-detail"><strong>Next discriminating test</strong><p>${escape(h.test)}</p></div>`:''}<div class="hypothesis-actions"><button class="text-button" data-edit-h="${escape(h.id)}">Edit hypothesis</button><button class="text-button" data-delete-h="${escape(h.id)}">Remove</button></div></article>`).join(''):'<div class="hypothesis-empty">No hypotheses yet. Select a field above to propose its meaning.</div>';
}
function renderNotebook() {
  const q=$('search').value.trim().toLowerCase();
  const filtered=[...experiments].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).filter(x=>JSON.stringify(x.data).toLowerCase().includes(q));
  $('notebook-count').textContent=experiments.length;
  if(!filtered.length) {
    $('notebook-list').innerHTML=`<div class="notebook-empty"><div class="empty-icon" aria-hidden="true">${q?'⌕':'▤'}</div><strong>${q?'No matching experiments':'A place for your discoveries'}</strong><p>${q?'Try a different search, including a field label or observation.':'Save an encoding pair, selected MLIR function or comparison with your observations.'}</p></div>`;
    return;
  }
  $('notebook-list').innerHTML=filtered.map(x=>{
    const currentId=currentView==='encoding'?activeId:workspaceIds[currentView];
    const count=x.kind?0:changedBits(BigInt('0x'+x.a),BigInt('0x'+x.b)).length;
    const summary=x.kind?(x.kind==='binary'?'Cubin & MLIR · saved function':'Compare MLIR · saved pair'):`Δ ${count} bit${count!==1?'s':''} · ${x.data.hypotheses.length} hypothes${x.data.hypotheses.length===1?'is':'es'}`;
    const architecture=x.kind?x.data.architecture||[...new Set(x.data.functions.map(f=>f.architecture).filter(Boolean))].join(' / '):x.data.architecture;
    const date=new Date(x.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'});
    return `<article class="notebook-card${x.id===currentId?' current':''}"><button class="notebook-open" data-open="${escape(x.id)}" ${x.id===currentId?'aria-current="true"':''}><span class="notebook-title">${escape(x.data.title)}</span><span class="notebook-arch">${escape(architecture||'Architecture not recorded')}</span><span class="notebook-meta"><span>${escape(summary)}</span><time datetime="${escape(x.updatedAt)}">${escape(date)}</time></span></button><button class="notebook-delete" data-delete="${escape(x.id)}" aria-label="Delete ${escape(x.data.title)}">×</button></article>`;
  }).join('');
}
function ask(title,message,action='Continue') {
  $('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-action').textContent=action;
  $('confirm-dialog').showModal();
  return new Promise(resolve=>confirmResolve=resolve);
}
$('confirm-dialog').addEventListener('close',()=>{
  confirmResolve?.($('confirm-dialog').returnValue==='confirm');confirmResolve=null;
});
async function mayLeaveDraft() {
  if(!dirty) return true;
  return ask('Leave this draft?','Your draft has changes that have not been saved as an experiment. Save it first to keep those changes in the notebook.','Leave draft');
}
function openHypothesis(id=null) {
  editingHypothesis=id;
  const h=id?draft.hypotheses.find(x=>x.id===id):{...selected,label:selected.label??'',claim:'',test:'',evidence:selected.source??'',status:'untested'};
  if(!h) return;
  $('hypothesis-dialog-title').textContent=id?'Edit hypothesis':'New hypothesis';
  for(const key of ['hi','lo','label','claim','test','evidence','status']) $('h-'+key).value=h[key];
  $('h-bits').value=h.bits?.join(',')??'';
  $('hypothesis-error').textContent='';$('hypothesis-dialog').showModal();
  $('h-label').focus();
}
function checkNotebookSize(records) {
  if(records.length>2000)throw new Error('A notebook can contain at most 2,000 experiments.');
  if(new TextEncoder().encode(exportNotebook(records,draft,activeId,now())).byteLength>10*1024*1024)throw new Error('This notebook would exceed the 10 MB import/export limit. Export existing experiments and save a smaller selection.');
}
function storeRecord(record) {
  const next=experiments.filter(x=>x.id!==record.id).concat(record);
  checkNotebookSize(next);
  experiments=next;
}
function workspaceChanged(kind) {
  const current=experiments.find(x=>x.id===workspaceIds[kind]);
  if(workspaceFields.some(key=>workspaceInput(kind,key).value!==(current?.data[key]||'')))return true;
  const workspace=binaryExplorer.snapshot(kind);
  if(!current)return workspace.functions.length>0;
  const fields=['name','text','source','lineStart','architecture','digest','generatedId'];
  return workspace.functions.length!==current.data.functions.length||workspace.functions.some((fn,i)=>fields.some(key=>(fn[key]??'')!==(current.data.functions[i][key]??'')))||JSON.stringify(workspace.settings)!==JSON.stringify(current.data.settings);
}
function updateWorkspaceStatus(kind) {
  const current=workspaceIds[kind];
  $(kind+'-record-status').textContent=current?(workspaceChanged(kind)?'Unsaved changes':'Saved record'):'New experiment';
  $(kind+'-save-experiment').innerHTML=(current?'Update experiment':'Save experiment')+' <span aria-hidden="true">↗</span>';
  $(kind+'-duplicate-experiment').hidden=!current;
  $(kind+'-duplicate-experiment').disabled=$(kind+'-save-experiment').disabled;
}
function saveExperiment(asDuplicate=false) {
  try {
    const time=now();
    const existing=!asDuplicate&&experiments.find(x=>x.id===activeId);
    const data=clone(draft);
    if(asDuplicate) data.title=data.title.trim()+' · copy';
    const record=snapshot(data,existing?.id??uid(),existing?.createdAt??time,time);
    storeRecord(record);
    draft=clone(record.data);activeId=record.id;dirty=false;
    $('experiment-title').value=draft.title;
    persist();updateRecordStatus();renderNotebook();toast(storageOK?(asDuplicate?'Experiment duplicated.':'Experiment saved.'):'Experiment kept in memory only. Export the notebook before closing.');
  } catch(error) {
    toast(error.message);
    if(!draft.title.trim()) $('experiment-title').focus();
  }
}
function saveWorkspace(kind,asNew=false) {
  try {
    const time=now(),existing=!asNew&&experiments.find(x=>x.id===workspaceIds[kind]);
    const data={...binaryExplorer.snapshot(kind),...Object.fromEntries(workspaceFields.map(key=>[key,workspaceInput(kind,key).value]))};
    if(asNew)data.title=data.title.trim()+' · copy';
    const record=snapshotWorkspace(kind,data,existing?.id??uid(),existing?.createdAt??time,time);
    storeRecord(record);workspaceIds[kind]=record.id;persist();renderNotebook();
    workspaceInput(kind,'title').value=record.data.title;$(kind+'-save-error').textContent='';updateWorkspaceStatus(kind);
    toast(storageOK?(asNew?'Experiment duplicated.':'Experiment saved.'):'Experiment kept in memory only. Export the notebook before closing.');
  } catch(error){
    $(kind+'-save-error').textContent=error.message;
    if(!workspaceInput(kind,'title').value.trim())workspaceInput(kind,'title').focus();
  }
}
for(const kind of ['binary','compare']) {
  $(kind+'-save-experiment').addEventListener('click',()=>saveWorkspace(kind));
  $(kind+'-duplicate-experiment').addEventListener('click',()=>saveWorkspace(kind,true));
  for(const key of workspaceFields)workspaceInput(kind,key).addEventListener('input',()=>{$(kind+'-save-error').textContent='';updateWorkspaceStatus(kind);});
}
async function copyText(value,success) {
  try { await navigator.clipboard.writeText(value);toast(success); }
  catch { toast('Clipboard access failed. Select and copy the mask directly.'); }
}

document.querySelectorAll('[data-draft]').forEach(el=>el.addEventListener('input',()=>{
  draft[el.dataset.draft]=el.value;
  markDirty();
  if(['aRaw','bRaw'].includes(el.dataset.draft)) readPair();
  else if(['architecture','pcA','pcB'].includes(el.dataset.draft))decodedPair?.refresh();
}));
document.querySelectorAll('[data-format]').forEach(el=>el.addEventListener('click',()=>{
  const format=el.dataset.format;
  if(format===draft.format) return;
  let a,b;
  try {
    a=draft.aRaw.trim()?parseEncoding(draft.aRaw,draft.format):null;
    b=draft.bRaw.trim()?parseEncoding(draft.bRaw,draft.format):null;
  } catch { toast('Correct the input before changing format.');return; }
  draft.aRaw=a===null?'':formatEncoding(a,format);draft.bRaw=b===null?'':formatEncoding(b,format);draft.format=format;
  markDirty();bindDraft();
}));
$('bit-grid').addEventListener('click',event=>{
  const target=event.target.closest('[data-bit]');
  if(!target||!values) return;
  const bit=Number(target.dataset.bit);
  if(event.shiftKey) selectRange(Math.max(anchor,bit),Math.min(anchor,bit),bit);
  else {
    anchor=bit;
    if($('mutate-toggle').checked) {
      draft.bRaw=formatEncoding(flipBit(values.b,bit),draft.format);
      $('encoding-b').value=draft.bRaw;markDirty();readPair();
    }
    selectRange(bit,bit,bit);
  }
});
$('bit-grid').addEventListener('keydown',event=>{
  const target=event.target.closest('[data-bit]');if(!target) return;
  const delta={ArrowLeft:1,ArrowRight:-1,ArrowUp:32,ArrowDown:-32}[event.key];
  if(delta===undefined) return;
  event.preventDefault();
  const bit=Math.max(0,Math.min(127,Number(target.dataset.bit)+delta));
  if(event.shiftKey) selectRange(Math.max(anchor,bit),Math.min(anchor,bit),bit);
  else {anchor=bit;selectRange(bit,bit,bit);}
});
$('changed-ranges').addEventListener('click',event=>{
  const target=event.target.closest('[data-range]');if(!target) return;
  const [hi,lo]=target.dataset.range.split(':').map(Number);anchor=lo;selectRange(hi,lo);
});
$('inspect-button').addEventListener('click',()=>{
  const hi=$('field-hi').value===''?NaN:Number($('field-hi').value),lo=$('field-lo').value===''?NaN:Number($('field-lo').value);
  selectRange(hi,lo);if(Number.isInteger(lo)) anchor=lo;
});
['field-hi','field-lo'].forEach(id=>$(id).addEventListener('keydown',event=>{if(event.key==='Enter') $('inspect-button').click();}));
$('copy-a-button').addEventListener('click',()=>{
  try {parseEncoding(draft.aRaw,draft.format);} catch(error) {toast('Baseline: '+error.message);return;}
  draft.bRaw=draft.aRaw;draft.assemblyB=draft.assemblyA;draft.pcB=draft.pcA;$('pc-b').value=draft.pcB;
  $('encoding-b').value=draft.bRaw;$('assembly-b').value=draft.assemblyB;markDirty();readPair();
});
$('swap-button').addEventListener('click',()=>{
  [draft.aRaw,draft.bRaw]=[draft.bRaw,draft.aRaw];[draft.assemblyA,draft.assemblyB]=[draft.assemblyB,draft.assemblyA];
  [draft.pcA,draft.pcB]=[draft.pcB,draft.pcA];
  markDirty();bindDraft();
});
$('copy-xor').addEventListener('click',()=>{if(values) copyText(hex(values.a^values.b),'XOR mask copied.');});
document.querySelectorAll('[data-tab]').forEach(el=>{
  el.addEventListener('click',()=>switchTab(el.dataset.tab,el.dataset.workspace));
  el.addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    event.preventDefault();const tab=event.key==='Home'?'observations':event.key==='End'?'hypotheses':el.dataset.tab==='observations'?'hypotheses':'observations';
    switchTab(tab,el.dataset.workspace);$((el.dataset.workspace?el.dataset.workspace+'-':'')+'tab-'+tab).focus();
  });
});
$('hypothesis-from-field').addEventListener('click',()=>openHypothesis());
$('add-hypothesis').addEventListener('click',()=>openHypothesis());
$('hypothesis-form').addEventListener('submit',event=>{
  event.preventDefault();
  try {
    const bitText=$('h-bits').value.trim();
    const bits=bitText?validateBits(bitText.split(',').map(x=>x.trim()===''?NaN:Number(x))):null;
    const hi=bits?bits.at(-1):Number($('h-hi').value),lo=bits?bits[0]:Number($('h-lo').value);validateRange(hi,lo);
    const h={id:editingHypothesis??uid(),hi,lo,label:$('h-label').value.trim(),claim:$('h-claim').value.trim(),status:$('h-status').value,test:$('h-test').value.trim(),evidence:$('h-evidence').value.trim()};
    if(bits)h.bits=bits;
    if(!h.label||!h.claim) throw new Error('Add a field label and a proposed meaning.');
    draft.hypotheses=draft.hypotheses.filter(x=>x.id!==h.id).concat(h);
    selected={hi,lo,...(bits?{bits}: {})};anchor=lo;markDirty();renderHypotheses();renderBits();renderInspector();switchTab('hypotheses');$('hypothesis-dialog').close();toast('Hypothesis added to this draft. Save the experiment to update its notebook record.');
  } catch(error) {$('hypothesis-error').textContent=error.message;}
});
$('hypothesis-list').addEventListener('click',async event=>{
  const edit=event.target.closest('[data-edit-h]'),del=event.target.closest('[data-delete-h]'),range=event.target.closest('[data-h-range]');
  if(edit) openHypothesis(edit.dataset.editH);
  if(del && await ask('Remove hypothesis?','This will remove the hypothesis from the current draft.','Remove')) {
    draft.hypotheses=draft.hypotheses.filter(x=>x.id!==del.dataset.deleteH);markDirty();renderHypotheses();renderBits();
  }
  if(range) {
    const h=draft.hypotheses.find(x=>x.id===range.dataset.hRange);
    if(h) {anchor=h.lo;selected={hi:h.hi,lo:h.lo,...(h.bits?{bits:h.bits}:{})};renderBits();renderInspector();$('bit-heading').scrollIntoView({behavior:'smooth',block:'start'});}
  }
});
$('save-button').addEventListener('click',()=>saveExperiment());
$('duplicate-button').addEventListener('click',()=>saveExperiment(true));
$('new-button').addEventListener('click',async()=>{
  if(['binary','compare'].includes(currentView)) {
    const kind=currentView;
    if(workspaceChanged(kind)&&!await ask('Start a new experiment?','This workspace has changes that have not been saved. Save its experiment first to keep those changes.','New experiment'))return;
    workspaceIds[kind]=null;
    for(const key of workspaceFields)workspaceInput(kind,key).value='';
    $(kind+'-save-error').textContent='';switchTab('observations',kind);updateWorkspaceStatus(kind);renderNotebook();workspaceInput(kind,'title').focus();
    return;
  }
  if(!await mayLeaveDraft()) return;
  draft=freshDraft();activeId=null;dirty=false;selected={hi:11,lo:0};anchor=0;
  switchTab('observations');persist();bindDraft();binaryExplorer.view('encoding');$('encoding-a').focus();
});
$('example-button').addEventListener('click',async()=>{
  if(!await mayLeaveDraft()) return;
  draft=exampleDraft();activeId=null;dirty=false;selected={hi:109,lo:109};anchor=109;
  switchTab('observations');persist();bindDraft();toast('Synthetic example loaded. It does not assign a meaning to bit 109.');
});
$('notebook-list').addEventListener('click',async event=>{
  const open=event.target.closest('[data-open]'),del=event.target.closest('[data-delete]');
  if(open) {
    const id=open.dataset.open;
    const record=experiments.find(x=>x.id===id);if(!record)return;
    if(record.kind) {
      if(workspaceChanged(record.kind)&&!await ask('Replace unsaved experiment changes?','This workspace has changes that have not been saved. Save its experiment first to keep those changes.','Replace changes'))return;
      try{
        binaryExplorer.restore(record);workspaceIds[record.kind]=record.id;
        for(const key of workspaceFields)workspaceInput(record.kind,key).value=record.data[key]||'';
        $(record.kind+'-save-error').textContent='';updateWorkspaceStatus(record.kind);
        renderNotebook();$(record.kind==='binary'?'ir-function':'compare-a-function').focus();
      }
      catch(error){toast('Could not reopen experiment: '+error.message);}
      return;
    }
    if(id!==activeId) {
      if(!await mayLeaveDraft()) return;
      draft=clone(record.data);activeId=record.id;dirty=false;persist();bindDraft();
    }
    binaryExplorer.view('encoding');
    $('encoding-a').focus({preventScroll:true});
    $('encoding-heading').scrollIntoView({behavior:'smooth',block:'start'});
  }
  if(del) {
    const record=experiments.find(x=>x.id===del.dataset.delete);if(!record) return;
    if(!await ask('Delete experiment?',`Delete “${record.data.title}” from this notebook? Export a backup first if you may need it later.`,'Delete experiment')) return;
    experiments=experiments.filter(x=>x.id!==record.id);
    if(activeId===record.id) {activeId=null;dirty=true;}
    for(const kind of ['binary','compare'])if(workspaceIds[kind]===record.id)workspaceIds[kind]=null;
    persist();updateRecordStatus();for(const kind of ['binary','compare'])updateWorkspaceStatus(kind);renderNotebook();toast('Experiment deleted. The open draft was kept.');
  }
});
$('search').addEventListener('input',renderNotebook);
$('export-button').addEventListener('click',()=>{
  const blob=new Blob([exportNotebook(experiments,draft,activeId,now())],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;
  a.download=`sass-notebook-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  toast('Notebook exported, including the current draft.');
});
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file) return;
  try {
    if(file.size>10*1024*1024) throw new Error('Notebook exceeds the 10 MB import limit.');
    const incoming=importNotebook(await file.text());
    const before=experiments.length;
    const merged=mergeNotebook(experiments,incoming.experiments);checkNotebookSize(merged);
    experiments=merged;
    incomingDraft=incoming;
    // If an imported record supersedes the open version, retain the local draft and mark it as unsaved.
    if(activeId) dirty=JSON.stringify(draft)!==JSON.stringify(experiments.find(x=>x.id===activeId)?.data);
    persist();renderNotebook();updateRecordStatus();for(const kind of ['binary','compare'])updateWorkspaceStatus(kind);
    $('import-summary').textContent=`${incoming.experiments.length} saved experiment${incoming.experiments.length!==1?'s':''} processed. ${experiments.length-before} added; matching IDs keep the newer saved version.`;
    $('import-dialog').showModal();
  } catch(error) {toast('Import failed: '+error.message);}
});
$('keep-draft').addEventListener('click',()=>{incomingDraft=null;$('import-dialog').close();});
$('open-import-draft').addEventListener('click',async()=>{
  $('import-dialog').close();
  if(!incomingDraft||!await mayLeaveDraft()) return;
  draft=clone(incomingDraft.draft);activeId=incomingDraft.activeId;incomingDraft=null;
  dirty=activeId?JSON.stringify(draft)!==JSON.stringify(experiments.find(x=>x.id===activeId)?.data):true;
  persist();bindDraft();binaryExplorer.view('encoding');$('encoding-a').focus();toast('Imported draft opened.');
});
document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>$(el.dataset.close).close()));
['help-button','conventions-button'].forEach(id=>$(id).addEventListener('click',()=>$('help-dialog').showModal()));
window.addEventListener('beforeunload',event=>{if(!storageOK||['binary','compare'].some(workspaceChanged)) {event.preventDefault();event.returnValue='';}});
window.addEventListener('storage',event=>{
  if(event.key===STORAGE_KEY) {
    storageOK=false;showStorageStatus();
    toast('Notebook changed in another tab. Export this tab’s work before reloading to prevent conflicts.');
  }
});
bindDraft();
async function loadEncoding({side,value,label,architecture,provenance,pc=0}) {
  if(side==='a'&&!await mayLeaveDraft())return false;
  // Start a fresh pair for A. B compares against the existing baseline.
  if(side==='a') {
    draft=freshDraft();activeId=null;
    draft.aRaw=formatEncoding(value,'hex');draft.bRaw=draft.aRaw;
    draft.assemblyA=label;draft.assemblyB=label;draft.title=label;
    draft.architecture=architecture;draft.setup=provenance;
    draft.pcA='0x'+BigInt(pc).toString(16);draft.pcB=draft.pcA;
  } else {
    draft.bRaw=formatEncoding(value,draft.format);draft.assemblyB=label;
    draft.pcB='0x'+BigInt(pc).toString(16);
    if(!draft.aRaw.trim()){draft.aRaw=draft.bRaw;draft.assemblyA=label;draft.pcA=draft.pcB;}
    if(!draft.title.trim())draft.title=label;
    if(!draft.architecture.trim())draft.architecture=architecture;
    draft.notes+=(draft.notes?'\n\n':'')+'Variant source:\n'+provenance;
  }
  dirty=true;persist();bindDraft();switchTab('observations');
  toast(`Instruction loaded as ${side.toUpperCase()}. Save the experiment to keep the encoding and provenance.`);
  return true;
}
const binaryExplorer=mountBinaryExplorer({onEncoding:loadEncoding,onView:name=>{currentView=name;renderNotebook();},onWorkspaceChange:kind=>queueMicrotask(()=>updateWorkspaceStatus(kind))});
reference=mountReference({getPair:()=>values,onSeed:loadEncoding,onFields:fields=>{sourceFields=fields;renderBits();},onSelection:({bits,label,source})=>{bits=validateBits(bits);selected={hi:bits.at(-1),lo:bits[0],bits,label,source};anchor=bits[0];renderBits();renderInspector();}});
decodedPair=mountDecodedPair({getDraft:()=>draft,onArchitecture:architecture=>{draft.architecture=architecture;$('architecture').value=architecture;markDirty();decodedPair.refresh();}});
