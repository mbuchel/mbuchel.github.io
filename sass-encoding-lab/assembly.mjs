const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const span=(kind,text)=>`<span class="assembly-${kind}">${escape(text)}</span>`;

export function instructionHTML(text) {
  const match=/^(@\S+\s+)?([A-Z][A-Z0-9_]*)(\.[^\s]+)?([\s\S]*)$/.exec(text);
  if(!match)return escape(text);
  const [,guard,mnemonic,modifiers,operands]=match;
  let body='',at=0;
  const flags=/(?:\b(?:UR|UP|R|P)(?:Z|T|R|\d+)|\])(?:\.[A-Za-z0-9_]+)+|[!~|]|-(?=[A-Za-z0-9])/g;
  for(const token of operands.matchAll(flags)) {
    body+=escape(operands.slice(at,token.index));
    const dot=token[0].indexOf('.');
    body+=dot<0?span('modifier',token[0]):escape(token[0].slice(0,dot))+span('modifier',token[0].slice(dot));
    at=token.index+token[0].length;
  }
  body+=escape(operands.slice(at));
  return (guard?span('modifier',guard):'')+span('mnemonic',mnemonic)+(modifiers?span('modifier',modifiers):'')+(operands?`<span class="assembly-operands">${body}</span>`:'');
}

export function assemblyCommentHTML(line) {
  const match=/^(\s*\/\/\s*\+0x[\da-f]+\s+)(.+)$/i.exec(line);
  return match?escape(match[1])+instructionHTML(match[2]):null;
}
