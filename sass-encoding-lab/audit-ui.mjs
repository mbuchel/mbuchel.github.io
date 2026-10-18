import {fetchJSON} from './opcode-data.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>n.toLocaleString('en-US');
const canonical=sm=>sm.replace(/^(?:sm_?|SM)/,'');
export function opcodeAuditResult(data,architecture,opcode){
  if(!data)return {status:'unavailable',text:'Audit loading / unavailable'};
  const sm=canonical(architecture),arch=data.architectures[sm];
  if(!arch)return {status:'unobserved',text:'Architecture not covered by this cubin corpus'};
  const observed=arch.opcodes[opcode]||0;
  if(!observed)return {status:'unobserved',text:'Not observed in this corpus'};
  const rejected=data.issues.find(i=>i.sm===sm&&i.opcode===opcode)?.occurrences||0;
  return {status:rejected?'undecoded':'matched',text:`${number(observed)} occurrences · ${rejected?number(rejected)+' native undecoded':'native/browser match'}`};
}
export function mountOpcodeAudit({onReady=()=>{},onInspect=()=>{}}={}){
  const loading=document.getElementById('opcode-audit-loading'),content=document.getElementById('opcode-audit-content');
  let data=null,architecture='',pending=null;
  function renderContext(){
    if(!data)return;
    const sm=canonical(architecture),arch=data.architectures[sm],context=document.getElementById('opcode-audit-context');
    context.textContent=arch?`Selected sm_${sm}: ${number(arch.files)} files · ${number(arch.instructions)} instruction occurrences · ${number(arch.undecoded)} native undecoded · ${arch.mismatches} browser/native mismatches.`:'The selected source is not covered by this retained cubin corpus. Local uploads and unobserved architectures do not inherit its results.';
  }
  function load(){
    if(pending)return pending;
    pending=fetchJSON('data/decoder-audit.json').then(snapshot=>{
      data=snapshot;const t=data.total;
      content.innerHTML=`<p>Retained CPU audit · ${esc(data.date)} · native core <code>${esc(data.nativeCommit.slice(0,7))}</code>. Counts include duplicate binaries and function occurrences; exact repeated decoding inputs reuse verified results.</p><div class="audit-totals">${[[t.files,'cubins'],[t.instructions,'instruction occurrences'],[t.mismatches,'browser/native mismatches'],[t.undecoded,'native undecoded'],[t.noCode,'files without executable code']].map(([n,label])=>`<div><strong>${number(n)}</strong><span>${label}</span></div>`).join('')}</div><p>${esc(data.scope)}</p><p id="opcode-audit-context" class="audit-status" role="status"></p><details><summary>Coverage by architecture</summary><div class="binary-table-scroll"><table><caption>Native admission and exact assembly comparison</caption><thead><tr><th scope="col">SM</th><th scope="col">Files</th><th scope="col">Instruction occurrences</th><th scope="col">Native undecoded</th><th scope="col">Mismatches</th></tr></thead><tbody>${Object.entries(data.architectures).sort(([a],[b])=>parseInt(a)-parseInt(b)||a.localeCompare(b)).map(([sm,a])=>`<tr><th scope="row">sm_${esc(sm)}</th><td>${number(a.files)}</td><td>${number(a.instructions)}</td><td>${number(a.undecoded)}</td><td>${a.mismatches}</td></tr>`).join('')}</tbody></table></div></details><h3>What “native undecoded” means</h3><p><strong>“Native” means sass2mlir’s C++ decoder, not the GPU.</strong> For these 128-bit instruction words, that decoder returned false instead of a mnemonic and operands. The browser made the same decision and keeps the raw bits visible rather than inventing assembly.</p><p>In this corpus, all ${number(t.undecoded)} undecoded occurrences are on SM75 with the low 12-bit opcode selector <code>0x23e</code>. The source lists <code>HIDDEN_SM75_INST</code>, but the generated native runtime has no decoder entry for it. This is a known gap in the decoder tables; these words have not been successfully decoded.</p><p><strong>Zero mismatches means browser/native agreement, including agreement to leave those words unknown.</strong> It does not mean every instruction decoded, or that a GPU rejected or successfully executed the unknown words. Expand the case below for the raw word, function, files and hashes.</p>${data.issues.map(i=>`<details class="audit-issue"><summary>sm_${esc(i.sm)} · 0x${i.opcode.toString(16)} · ${number(i.occurrences)} native-undecoded occurrences</summary><p>The source table has <code>${esc(i.sourceMnemonic)}</code> with approach <code>hidden</code>. The generated native runtime table has no usable entry for this selector. Its zero seed is a placeholder, not the real instruction. We do not substitute a decoder from another SM.</p><p>${i.fileCount} files / ${i.uniqueFileHashes} distinct binary hashes. All rejected occurrences in this corpus use this selector.</p><p class="audit-sample">Example: <code>${esc(i.sample.hi.padStart(16,'0')+i.sample.lo.padStart(16,'0'))}</code><br>Function-relative PC: 0x${i.sample.pc.toString(16)}<br>${esc(i.sample.function)}<br>${esc(i.sample.file)}</p><button class="button small" data-audit-sm="SM${esc(i.sm)}" data-audit-opcode="${i.opcode}">Find this placeholder in the source table →</button><details><summary>Affected files and hashes</summary><ul>${i.files.map(f=>`<li class="audit-sample">${esc(f.file)} · ${number(f.undecoded)} occurrences<br>SHA-256: ${esc(f.sha256)}</li>`).join('')}</ul></details></details>`).join('')}<p class="audit-sample"><a href="data/decoder-audit.json" download>Download audit data (JSON) ↓</a></p><p>“Not observed” is not a pass. This snapshot does not establish hardware execution, native MLIR correctness or a lossless re-encoding round trip.</p>`;
      loading.hidden=true;content.hidden=false;renderContext();onReady();
    }).catch(error=>{loading.textContent='Audit unavailable: '+error.message;pending=null;});return pending;
  }
  content.addEventListener('click',event=>{const button=event.target.closest('[data-audit-opcode]');if(button)onInspect({architecture:button.dataset.auditSm,opcode:Number(button.dataset.auditOpcode)});});
  return {load,setArchitecture(value){architecture=value;renderContext();},result(opcode){const r=opcodeAuditResult(data,architecture,opcode);return `<span class="audit-result ${r.status}">${esc(r.text)}</span>`;}};
}
