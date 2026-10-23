import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {IdentityService} from '../server/auth';
import {deriveKey,RecordStore} from '../server/storage';

const directories:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
async function service(){const directory=await mkdtemp(path.join(tmpdir(),'atelier-credential-'));directories.push(directory);const store=new RecordStore(directory,Buffer.alloc(32,28));return{store,identity:new IdentityService(store)};}
const credentials={name:'Local owner',email:'owner@example.test',password:'A carefully chosen password 2026'};

describe('credential derivation migration and session atomicity',()=>{
 it('upgrades a genuine legacy hash only after successful verification without exposing KDF metadata',async()=>{
  const {store,identity}=await service(),salt=randomBytes(16),hash=await deriveKey(credentials.password,salt,1),user={id:'user-legacy',name:credentials.name,email:credentials.email,isAdmin:true,createdAt:new Date().toISOString(),salt:salt.toString('hex'),passwordHash:hash.toString('hex')};hash.fill(0);
  await store.write('accounts',{schemaVersion:1,users:[user]});
  await expect(identity.login({email:credentials.email,password:'An incorrect password'},'local')).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});
  expect((await store.read<{users:typeof user[]}>('accounts')).users[0]).toEqual(user);
  const result=await identity.login({email:credentials.email,password:credentials.password},'local');expect(result.user.id).toBe(user.id);expect(result.user).not.toHaveProperty('kdfVersion');expect(await identity.user(result.token)).toEqual(result.user);
  const upgraded=(await store.read<{users:(typeof user&{kdfVersion:number})[]}>('accounts')).users[0];expect(upgraded.kdfVersion).toBe(2);expect(upgraded.salt).not.toBe(user.salt);expect(upgraded.passwordHash).not.toBe(user.passwordHash);
  expect((await identity.login({email:credentials.email,password:credentials.password},'local')).user).toEqual(result.user);
 });
 it('uses the current derivation for new accounts and self resets and revokes every earlier session',async()=>{
  const {store,identity}=await service(),owner=await identity.setup(credentials,'local'),first=await identity.login({email:credentials.email,password:credentials.password},'local');
  const replacement='A new carefully chosen password 2026';await identity.changePassword(owner,owner.id,{currentPassword:credentials.password,newPassword:replacement});expect(await identity.user(first.token)).toBeNull();
  expect((await store.read<{users:{kdfVersion:number}[]}>('accounts')).users[0].kdfVersion).toBe(2);
  await expect(identity.login({email:credentials.email,password:credentials.password},'local')).rejects.toMatchObject({code:'INVALID_CREDENTIALS'});expect((await identity.login({email:credentials.email,password:replacement},'local')).user.id).toBe(owner.id);
 });
 it('serializes a password reset behind an in-flight login and revokes its newly issued session',async()=>{
  const {store,identity}=await service(),owner=await identity.setup(credentials,'local');let release!:()=>void,entered!:()=>void;
  const paused=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>entered=resolve),original=store.transaction.bind(store);let held=false;
  vi.spyOn(store,'transaction').mockImplementation(async(record,action)=>{if(record==='credential-hash'&&!held){held=true;entered();await paused;}return original(record,action);});
  const pendingLogin=identity.login({email:credentials.email,password:credentials.password},'local');await started;
  const reset=identity.changePassword(owner,owner.id,{currentPassword:credentials.password,newPassword:'An independently reset password 2026'});release();
  const [session]=await Promise.all([pendingLogin,reset]);expect(await identity.user(session.token)).toBeNull();
  expect((await identity.login({email:credentials.email,password:'An independently reset password 2026'},'local')).user.id).toBe(owner.id);
 });
});
