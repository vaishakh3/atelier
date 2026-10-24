/** User-clicked catalogue/search links open in the user's browser, never in the privileged workspace. */
export function checkedProductLink(value:unknown):string {
  if(typeof value!=='string'||value.length>2048)throw new Error('Choose a supported furniture product or search link.');
  let url:URL;try{url=new URL(value);}catch{throw new Error('This product link is invalid.');}
  const hosts=new Set(['www.ikea.com','ikea.com','www.google.com','google.com','lens.google.com']);
  if(url.protocol!=='https:'||url.username||url.password||url.port||!hosts.has(url.hostname))throw new Error('Only supported HTTPS product and visual-search sites can open from Atelier.');
  return url.href;
}
