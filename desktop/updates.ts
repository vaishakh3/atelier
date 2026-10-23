import { createPublicKey, verify } from 'node:crypto';

export interface TrustedUpdateConfig {feedUrl:string;publicKey:string;teamId:string;downloadOrigins?:string[]}
export function validateUpdateConfig(value:unknown):TrustedUpdateConfig|null {
  if(!value||typeof value!=='object')return null;
  const v=value as Record<string,unknown>;
  if(typeof v.feedUrl!=='string'||typeof v.publicKey!=='string'||!v.publicKey.startsWith('-----BEGIN PUBLIC KEY-----')||typeof v.teamId!=='string'||!/^[A-Z0-9]{10}$/.test(v.teamId))return null;
  try{
    const url=new URL(v.feedUrl),key=createPublicKey(v.publicKey);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||[...url.searchParams.keys()].some(key=>/token|secret|password|api.?key/i.test(key))||['localhost','127.0.0.1','[::1]'].includes(url.hostname)||key.asymmetricKeyType!=='ed25519')return null;
    const downloadOrigins=Array.isArray(v.downloadOrigins)?v.downloadOrigins.filter((origin):origin is string=>typeof origin==='string'&&new URL(origin).protocol==='https:'&&new URL(origin).origin===origin):[];
    return{feedUrl:url.href,publicKey:v.publicKey,teamId:v.teamId,downloadOrigins};
  }catch{return null;}
}
/** Verify the exact Squirrel JSON feed bytes before native code-signature-checked updates. */
export function verifySignedUpdateFeed(body:string,signature:string,configuration:TrustedUpdateConfig):void {
  if(Buffer.byteLength(body)>65536||!signature||!/^[a-zA-Z0-9+/]+={0,2}$/.test(signature)||!verify(null,Buffer.from(body),createPublicKey(configuration.publicKey),Buffer.from(signature,'base64')))throw new Error('Update feed authenticity could not be verified.');
  const feed=JSON.parse(body),allowed=new Set([new URL(configuration.feedUrl).origin,...configuration.downloadOrigins??[]]);
  if(!Array.isArray(feed.releases)||feed.releases.length>50)throw new Error('The signed update feed has an unsupported shape.');
  for(const release of feed.releases){const target=release?.updateTo;if(typeof release?.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(release.version)||!target||typeof target.url!=='string'||!/^([a-f0-9]{64})$/i.test(target.sha256)||!Number.isSafeInteger(target.size)||target.size<=0)throw new Error('An update release is missing integrity metadata.');const url=new URL(target.url);if(url.protocol!=='https:'||!allowed.has(url.origin)||url.username||url.password)throw new Error('The update download origin is not trusted.');if(target.delta)throw new Error('Delta updates require an explicitly supported verification path.');}
}
