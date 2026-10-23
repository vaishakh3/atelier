import {randomBytes,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {RecordStore,deriveKey,digest,CURRENT_KDF_VERSION} from './storage';
import type {KdfVersion} from './storage';
import {ApiError} from './errors';

export const passwordSchema=z.string().min(15).max(128);
const emailSchema=z.string().trim().toLowerCase().email().max(254);
export const newUserSchema=z.object({name:z.string().trim().min(1).max(100),email:emailSchema,password:passwordSchema,isAdmin:z.boolean().optional()}).strict();
export const loginSchema=z.object({email:emailSchema,password:z.string().min(1).max(128)}).strict();
export interface PublicUser {id:string;name:string;email:string;isAdmin:boolean;createdAt:string}
interface User extends PublicUser {salt:string;passwordHash:string;kdfVersion?:KdfVersion}
const userSchema=z.object({id:z.string().regex(/^user-[\w-]+$/),name:z.string().min(1).max(100),email:emailSchema,isAdmin:z.boolean(),createdAt:z.string(),salt:z.string().regex(/^[a-f0-9]{32}$/),passwordHash:z.string().regex(/^[a-f0-9]{64}$/),kdfVersion:z.union([z.literal(1),z.literal(2)]).optional()}).strict();
const accountsSchema=z.object({schemaVersion:z.literal(1),users:z.array(userSchema).min(1).max(1000)}).strict();
const visible=({salt:_,passwordHash:__,kdfVersion:___,...user}:User):PublicUser=>user;

export class IdentityService {
  private sessions=new Map<string,{userId:string;expires:number}>();private attempts=new Map<string,{count:number;until:number}>();
  constructor(private store:RecordStore){}
  private async accounts():Promise<{schemaVersion:1;users:User[]}|null>{try{return await this.store.read('accounts',value=>accountsSchema.parse(value),{recover:false});}catch(error){if(error instanceof ApiError&&error.code==='NOT_FOUND')return null;throw error;}}
  async hasAccounts(){return(await this.accounts())!==null;}
  async users(){return(await this.accounts())?.users.map(visible)??[];}
  async user(token:string|undefined):Promise<PublicUser|null>{if(!token)return null;const key=digest(token),session=this.sessions.get(key);if(!session)return null;if(session.expires<Date.now()){this.sessions.delete(key);return null;}const user=(await this.accounts())?.users.find(user=>user.id===session.userId);return user?visible(user):null;}
  issue(userId:string){for(const [key,session]of this.sessions)if(session.expires<Date.now())this.sessions.delete(key);const token=randomBytes(32).toString('hex');this.sessions.set(digest(token),{userId,expires:Date.now()+12*60*60*1000});return token;}
  logout(token:string|undefined){if(token)this.sessions.delete(digest(token));}
  private revokeUser(id:string){for(const [key,session]of this.sessions)if(session.userId===id)this.sessions.delete(key);}
  private checkRate(ip:string,email:string){const now=Date.now();for(const [key,value]of this.attempts)if(value.until<now)this.attempts.delete(key);for(const [key,limit]of [[`ip:${ip}`,24],[`login:${ip}:${digest(email)}`,8]]as const){const attempt=this.attempts.get(key)??{count:0,until:now+15*60*1000};if(attempt.count>=limit)throw new ApiError(429,'LOGIN_RATE_LIMIT','Too many authentication attempts. Wait 15 minutes before retrying.');attempt.count++;this.attempts.set(key,attempt);}}
  private async hash(password:string,salt:Buffer,version:KdfVersion=CURRENT_KDF_VERSION){return this.store.transaction('credential-hash',()=>deriveKey(password,salt,version));}
  async setup(input:unknown,ip:string){const data=newUserSchema.parse(input);this.checkRate(ip,data.email);return this.store.transaction('accounts',async()=>{if(await this.hasAccounts())throw new ApiError(409,'ALREADY_CONFIGURED','A local owner account already exists. Sign in instead.');const salt=randomBytes(16),hash=await this.hash(data.password,salt);const user:User={id:`user-${crypto.randomUUID()}`,name:data.name,email:data.email,isAdmin:true,createdAt:new Date().toISOString(),salt:salt.toString('hex'),passwordHash:hash.toString('hex'),kdfVersion:CURRENT_KDF_VERSION};hash.fill(0);await this.store.write('accounts',{schemaVersion:1,users:[user]});return visible(user);});}
  async login(input:unknown,ip:string){const data=loginSchema.parse(input);this.checkRate(ip,data.email);return this.store.transaction('accounts',async()=>{
    const accounts=await this.accounts(),user=accounts?.users.find(user=>user.email===data.email);
    const salt=user?Buffer.from(user.salt,'hex'):Buffer.alloc(16,7),candidate=await this.hash(data.password,salt,user?(user.kdfVersion??1):CURRENT_KDF_VERSION),expected=user?Buffer.from(user.passwordHash,'hex'):Buffer.alloc(32,0);
    const match=timingSafeEqual(candidate,expected);candidate.fill(0);if(!accounts||!user||!match)throw new ApiError(401,'INVALID_CREDENTIALS','Email or password is incorrect.');
    if((user.kdfVersion??1)!==CURRENT_KDF_VERSION){const freshSalt=randomBytes(16),hash=await this.hash(data.password,freshSalt);user.salt=freshSalt.toString('hex');user.passwordHash=hash.toString('hex');user.kdfVersion=CURRENT_KDF_VERSION;hash.fill(0);await this.store.write('accounts',accounts);}
    // Issuing under the same lock makes a concurrent password reset revoke this session too.
    return{user:visible(user),token:this.issue(user.id)};
  });}
  async create(input:unknown){const data=newUserSchema.parse(input);return this.store.transaction('accounts',async()=>{const accounts=await this.accounts();if(!accounts)throw new ApiError(409,'SETUP_REQUIRED','Create the owner account first.');if(accounts.users.some(user=>user.email===data.email))throw new ApiError(409,'EMAIL_EXISTS','An account with that email already exists.');if(accounts.users.length>=1000)throw new ApiError(409,'USER_LIMIT','This local workspace has reached its account limit.');const salt=randomBytes(16),hash=await this.hash(data.password,salt),user:User={id:`user-${crypto.randomUUID()}`,name:data.name,email:data.email,isAdmin:data.isAdmin??false,createdAt:new Date().toISOString(),salt:salt.toString('hex'),passwordHash:hash.toString('hex'),kdfVersion:CURRENT_KDF_VERSION};hash.fill(0);await this.store.write('accounts',{...accounts,users:[...accounts.users,user]});return visible(user);});}
  async changePassword(actor:PublicUser,targetId:string,input:unknown){const data=z.object({currentPassword:z.string().max(128).optional(),newPassword:passwordSchema}).strict().parse(input);if(!actor.isAdmin&&actor.id!==targetId)throw new ApiError(403,'FORBIDDEN','Only an administrator can reset another account.');this.checkRate('password-change',actor.id);return this.store.transaction('accounts',async()=>{const accounts=await this.accounts(),target=accounts?.users.find(user=>user.id===targetId);if(!accounts||!target)throw new ApiError(404,'NOT_FOUND','Account not found');if(actor.id===targetId){if(!data.currentPassword)throw new ApiError(400,'CURRENT_PASSWORD_REQUIRED','Enter your current password.');const candidate=await this.hash(data.currentPassword,Buffer.from(target.salt,'hex'),target.kdfVersion??1),matches=timingSafeEqual(candidate,Buffer.from(target.passwordHash,'hex'));candidate.fill(0);if(!matches)throw new ApiError(401,'INVALID_CREDENTIALS','Current password is incorrect.');}const salt=randomBytes(16),hash=await this.hash(data.newPassword,salt);target.salt=salt.toString('hex');target.passwordHash=hash.toString('hex');target.kdfVersion=CURRENT_KDF_VERSION;hash.fill(0);await this.store.write('accounts',accounts);this.revokeUser(targetId);return visible(target);});}
}
