import {createContext,useCallback,useContext,useEffect,useState} from 'react';
import type {ReactNode} from 'react';
import {setIdentityMode} from './api';

export interface WorkspaceUser {id:string;name:string;email:string;isAdmin:boolean;createdAt:string}
interface AuthState {loading:boolean;identityRequired:boolean;setupRequired:boolean;authenticated:boolean;user:WorkspaceUser|null;sessionUser:WorkspaceUser|null;generation:number;error:string}
interface AuthContextValue extends AuthState {refresh:()=>Promise<void>;authenticate:(input:{name?:string;email:string;password:string})=>Promise<void>;signOut:()=>Promise<void>}
const Context=createContext<AuthContextValue|null>(null);
export function AuthProvider({children}:{children:ReactNode}){
 const [state,setState]=useState<AuthState>({loading:true,identityRequired:true,setupRequired:false,authenticated:false,user:null,sessionUser:null,generation:0,error:''});
 const refresh=useCallback(async()=>{
  try{const response=await fetch('/api/auth/status',{credentials:'same-origin'});if(!response.ok)throw new Error('The local workspace could not be opened.');const data=await response.json();setIdentityMode(Boolean(data.identityRequired));setState(previous=>({...previous,loading:false,identityRequired:Boolean(data.identityRequired),setupRequired:Boolean(data.setupRequired),authenticated:!data.identityRequired||Boolean(data.authenticated),user:data.user||null,sessionUser:data.user||previous.sessionUser,error:''}));}
  catch{setState(previous=>({...previous,loading:false,error:'The local project engine is unavailable. Reopen Atelier to retry.'}));}
 },[]);
 useEffect(()=>{void refresh();const expire=()=>setState(previous=>({...previous,authenticated:false,user:null,error:''}));window.addEventListener('atelier:auth-required',expire);return()=>window.removeEventListener('atelier:auth-required',expire);},[refresh]);
 const authenticate=async(input:{name?:string;email:string;password:string})=>{const response=await fetch(state.setupRequired?'/api/auth/setup':'/api/auth/login',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||'Could not sign in.');setState(previous=>({...previous,setupRequired:false,authenticated:true,user:data.user,sessionUser:data.user,error:''}));};
 const signOut=async()=>{const response=await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Could not sign out.');setState(previous=>({...previous,authenticated:false,user:null,sessionUser:null,generation:previous.generation+1,error:''}));};
 return <Context.Provider value={{...state,refresh,authenticate,signOut}}>{children}</Context.Provider>;
}
export function useAuth(){const value=useContext(Context);if(!value)throw new Error('Workspace identity is unavailable');return value;}
