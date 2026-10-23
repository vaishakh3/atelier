import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {parseWorkspaceAuthStatus,requestWorkspaceAuthStatus,setIdentityMode,WorkspaceStartupError} from './api';
import type {WorkspaceIdentityUser} from './api';

export type WorkspaceUser=WorkspaceIdentityUser;
interface AuthState {loading:boolean;identityRequired:boolean;setupRequired:boolean;authenticated:boolean;user:WorkspaceUser|null;sessionUser:WorkspaceUser|null;generation:number;error:string}
interface AuthContextValue extends AuthState {refresh:()=>Promise<void>;authenticate:(input:{name?:string;email:string;password:string})=>Promise<void>;signOut:()=>Promise<void>}
const Context=createContext<AuthContextValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<AuthState>({loading:true,identityRequired:true,setupRequired:false,authenticated:false,user:null,sessionUser:null,generation:0,error:''});
 const mounted=useRef(true),requestId=useRef(0),pending=useRef<AbortController|null>(null);
 const supersede=()=>{pending.current?.abort();pending.current=null;return++requestId.current;};
 const refresh=useCallback(async()=>{
  pending.current?.abort();const controller=new AbortController(),id=++requestId.current;pending.current=controller;
  setState(previous=>({...previous,loading:true,error:''}));
  try{
   const data=await requestWorkspaceAuthStatus({signal:controller.signal,requireIdentity:Boolean(window.atelierDesktop)});
   if(!mounted.current||id!==requestId.current||controller.signal.aborted)return;
   setIdentityMode(data.identityRequired);
   setState(previous=>({...previous,loading:false,identityRequired:data.identityRequired,setupRequired:data.setupRequired,authenticated:!data.identityRequired||data.authenticated,user:data.user,sessionUser:data.user||previous.sessionUser,error:''}));
  }catch(error){
   if(!mounted.current||id!==requestId.current||controller.signal.aborted)return;
   const message=error instanceof WorkspaceStartupError?error.message:'The local project engine could not open the workspace. Retry without changing the original data.';
   setState(previous=>({...previous,loading:false,authenticated:false,user:null,error:message}));
  }finally{if(id===requestId.current)pending.current=null;}
 },[]);
 useEffect(()=>{
  mounted.current=true;void refresh();
  const expire=()=>{supersede();setState(previous=>({...previous,loading:false,authenticated:false,user:null,error:''}));};
  window.addEventListener('atelier:auth-required',expire);
  return()=>{mounted.current=false;supersede();window.removeEventListener('atelier:auth-required',expire);};
 },[refresh]);
 const authenticate=async(input:{name?:string;email:string;password:string})=>{
  const id=supersede(),response=await fetch(state.setupRequired?'/api/auth/setup':'/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}),data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Could not sign in.');
  const verified=verifyAuthenticatedUser(data);
  if(mounted.current&&id===requestId.current)setState(previous=>({...previous,loading:false,setupRequired:false,authenticated:true,user:verified,sessionUser:verified,error:''}));
 };
 const signOut=async()=>{const id=supersede(),response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Could not sign out.');if(mounted.current&&id===requestId.current)setState(previous=>({...previous,loading:false,authenticated:false,user:null,sessionUser:null,generation:previous.generation+1,error:''}));};
 return <Context.Provider value={{...state,refresh,authenticate,signOut}}>{children}</Context.Provider>;
}
function verifyAuthenticatedUser(data:unknown):WorkspaceUser{
 // Login/setup return only a public user. Reuse the strict status contract rather than trusting a 200 alone.
 return parseWorkspaceAuthStatus({identityRequired:true,setupRequired:false,authenticated:true,user:typeof data==='object'&&data!==null?'user'in data?data.user:undefined:undefined},true).user!;
}
export function useAuth(){const value=useContext(Context);if(!value)throw new Error('Workspace identity is unavailable');return value;}
