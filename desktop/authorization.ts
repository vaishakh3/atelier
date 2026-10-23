/** Main-process authorization. Session and capability values never cross the renderer bridge. */
export async function assertWorkspaceAdministrator(origin:string,capability:string,sessionToken:string|undefined,request:typeof fetch=fetch):Promise<void>{
  const denied=()=>new Error('A signed-in workspace administrator is required to change AI credentials.');
  let base:URL;
  try{base=new URL(origin);}catch{throw denied();}
  if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||base.origin!==origin||!base.port||!/^[a-f0-9]{64}$/.test(capability)||!sessionToken||!/^[a-f0-9]{64}$/.test(sessionToken))throw denied();
  try{
    const response=await request(`${origin}/api/auth/status`,{headers:{'X-Atelier-Desktop':capability,Cookie:`atelier_session=${sessionToken}`},redirect:'error',signal:AbortSignal.timeout(5000)});
    if(!response.ok||Number(response.headers.get('content-length')||0)>16384)throw denied();
    const text=await response.text();if(text.length>16384)throw denied();
    const status=JSON.parse(text) as{identityRequired?:unknown;authenticated?:unknown;user?:{isAdmin?:unknown}};
    if(status.identityRequired!==true||status.authenticated!==true||status.user?.isAdmin!==true)throw denied();
  }catch{throw denied();}
}
