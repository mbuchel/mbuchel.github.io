const cache=new Map();
export async function fetchJSON(path) {
  if(!cache.has(path))cache.set(path,fetch(path).then(r=>{if(!r.ok)throw new Error(`Source load failed (${r.status}).`);return r.json();}).catch(error=>{cache.delete(path);throw error;}));
  return cache.get(path);
}
export const catalog=()=>fetchJSON('data/catalog.json');
export async function sourceTable(meta) {
  const response=await fetch(meta.asset);
  if(!response.ok)throw new Error(`Source load failed (${response.status}).`);
  const bytes=await response.arrayBuffer(),header=new Uint8Array(bytes,0,Math.min(2,bytes.byteLength));
  const compressed=header[0]===0x1f&&header[1]===0x8b;
  if(compressed&&!globalThis.DecompressionStream)throw new Error('This browser cannot decompress source tables. Use a current browser or open local TSV files.');
  const buffer=compressed?await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():bytes;
  if(globalThis.crypto?.subtle) {
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
    if(hash!==meta.sha256)throw new Error('Source checksum does not match the snapshot.');
  }
  return new TextDecoder().decode(buffer);
}
