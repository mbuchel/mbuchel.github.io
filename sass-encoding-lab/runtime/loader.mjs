// All paths stay relative to this module so /repository/ GitHub Pages paths work.
import {prepareTables} from './decoder.mjs';
let indexPromise=null,vocabularyPromise=null;const models=new Map();
const json=async url=>{const r=await fetch(url);if(!r.ok)throw new Error(`Runtime data could not be loaded (${r.status}).`);return r.json();};
export async function loadRuntime(sm){
  sm=String(sm).replace(/^(?:sm_|sm|SM)/,'');
  const index=await (indexPromise??=json(new URL('../data/runtime/index.json',import.meta.url)));
  const meta=index.models.find(m=>m.sm===sm)||index.models.find(m=>sm.endsWith('a')&&m.sm===sm.slice(0,-1));
  if(!meta)throw new Error(`No decoder tables for sm_${sm} in the supplied repository.`);
  if(!models.has(meta.sm))models.set(meta.sm,(async()=>{
    const r=await fetch(new URL('../'+meta.path,import.meta.url));if(!r.ok)throw new Error(`Decoder tables could not be loaded (${r.status}).`);
    const bytes=await r.arrayBuffer(),header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
    // Static hosts may apply Content-Encoding: gzip, which fetch already decodes.
    const compressed=header[0]===0x1f&&header[1]===0x8b;
    if(globalThis.crypto?.subtle){const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(digest!==(compressed?meta.sha256:meta.uncompressedSha256))throw new Error('Decoder table checksum mismatch.');}
    if(compressed&&typeof DecompressionStream==='undefined')throw new Error('Browser gzip decompression is unavailable. Use a current browser.');
    const body=compressed?new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')):bytes;
    return prepareTables(await new Response(body).json());
  })().catch(e=>{models.delete(meta.sm);throw e;}));
  const [model,vocabulary]=await Promise.all([models.get(meta.sm),vocabularyPromise??=json(new URL('../data/runtime/vocabulary.json',import.meta.url))]);
  return {model,vocabulary};
}
