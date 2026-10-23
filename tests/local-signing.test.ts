import {describe,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

const moduleUrl=pathToFileURL(path.join(process.cwd(),'scripts','local-signing.mjs')).href;
const execute=promisify(execFile);
async function check(program:string){return execute(process.execPath,['--input-type=module','--eval',`import assert from 'node:assert/strict';import * as signing from ${JSON.stringify(moduleUrl)};${program}`],{timeout:10_000});}
describe('persistent local macOS signing policy without keychain access',()=>{
 it('preserves production Developer ID priority and its hardened distribution profile',async()=>{
  await expect(check(`const choice=await signing.selectMacSigning({hostPlatform:'darwin',targetPlatform:'darwin',productionIdentity:'Developer ID Application: Existing Owner',requireLocal:true,entitlements:'/entitlements.plist',loadLocal:async()=>{throw new Error('Must not load local secrets');}});assert.equal(choice.signing,'developer-id');assert.equal(choice.options.osxSign.identity,'Developer ID Application: Existing Owner');assert.equal(choice.options.osxSign.optionsForFile().hardenedRuntime,true);assert.equal(choice.options.osxSign.identityValidation,undefined);assert.equal(choice.lock,undefined);`)).resolves.toMatchObject({stdout:'',stderr:''});
 });
 it('reuses a retained local signer, labels it honestly and keeps nested identity defaults certificate based',async()=>{
  await expect(check(`let locked=0;const identity='A'.repeat(40),keychain='/private/Atelier Build Signing/atelier-local-signing.keychain-db';const local={identity,keychain,lock:async()=>{locked++;}};const choice=await signing.selectMacSigning({hostPlatform:'darwin',targetPlatform:'darwin',entitlements:'/entitlements.plist',loadLocal:async({required})=>{assert.equal(required,false);return local;}});assert.equal(choice.signing,'local-development');assert.equal(choice.identity,identity);assert.equal(choice.options.osxSign.keychain,keychain);assert.equal(choice.options.osxSign.identityValidation,false);assert.equal(choice.options.osxSign.strictVerify,true);assert.deepEqual(choice.options.osxSign.optionsForFile(),{hardenedRuntime:false,timestamp:'none',entitlements:'/entitlements.plist'});assert.equal(choice.options.osxSign.requirements,undefined);assert.equal(choice.options.osxNotarize,undefined);await choice.lock();assert.equal(locked,1);assert.equal(JSON.stringify(choice).includes('Password'),false);`)).resolves.toMatchObject({stdout:'',stderr:''});
 });
 it('keeps CI/cross builds available and fails closed when local signing is explicitly required',async()=>{
  await expect(check(`const missing=await signing.selectMacSigning({hostPlatform:'darwin',targetPlatform:'darwin',loadLocal:async()=>null});assert.equal(missing.signing,'ad-hoc');await assert.rejects(signing.selectMacSigning({hostPlatform:'darwin',targetPlatform:'darwin',requireLocal:true,loadLocal:async()=>null}));const cross=await signing.selectMacSigning({hostPlatform:'linux',targetPlatform:'darwin',loadLocal:async()=>{throw new Error('No local read on cross host');}});assert.equal(cross.signing,'ad-hoc');await assert.rejects(signing.selectMacSigning({hostPlatform:'linux',targetPlatform:'darwin',requireLocal:true}));assert.equal((await signing.selectMacSigning({hostPlatform:'linux',targetPlatform:'linux'})).signing,'unsigned');`)).resolves.toMatchObject({stdout:'',stderr:''});
 });
 it('limits new signing-key access to its exact dedicated keychain and rejects loose configuration',async()=>{
  await expect(check(`const config={version:1,state:'ready',certificateSha1:'A'.repeat(40),keychainPassword:'k'.repeat(43),archivePassword:'p'.repeat(43)};assert.equal(signing.validateLocalSigningConfig(config),config);for(const invalid of [{...config,certificateSha1:'wrong'},{...config,keychainPassword:'short'},{...config,extra:'unexpected'}])assert.throws(()=>signing.validateLocalSigningConfig(invalid));const args=signing.localKeyAccessArguments(config,'/private/Atelier Build Signing');assert.equal(args.at(-1),'/private/Atelier Build Signing/atelier-local-signing.keychain-db');assert.equal(args[args.indexOf('-t')+1],'private');assert.equal(args[args.indexOf('-l')+1],'Imported Private Key');assert.equal(args.includes('-A'),false);assert.equal(args.includes('list-keychains'),false);assert.equal(args.includes('add-trusted-cert'),false);`)).resolves.toMatchObject({stdout:'',stderr:''});
 });
 it('checks resource integrity plus the retained certificate and application requirement',async()=>{
  await expect(check(`const identity='A'.repeat(40),calls=[];const run=async(command,args)=>{calls.push([command,args]);return args.includes('--display')?'designated => identifier "com.atelier.bim" and anchor H"'+identity+'"':'';};await signing.verifyLocalSignature('/Atelier.app',identity,run);assert.deepEqual(calls[0][1],['--verify','--deep','--strict','/Atelier.app']);for(const pin of ['anchor root = H"'+identity+'"','certificate leaf = H"'+identity.toLowerCase()+'"','certificate 0 = H"'+identity+'"'])await signing.verifyLocalSignature('/Atelier.app',identity,async()=> 'designated => identifier "com.atelier.bim" and '+pin);for(const requirement of ['designated => cdhash H"'+identity+'"','designated => identifier "com.atelier.bim" and cdhash H"'+identity+'"','designated => identifier "com.atelier.bim" and anchor H"'+identity+'" or true','designated => identifier "com.atelier.bim" and anchor H"'+'B'.repeat(40)+'"','designated => identifier "another.app" and anchor H"'+identity+'"','designated => identifier "COM.ATELIER.BIM" and anchor H"'+identity+'"'])await assert.rejects(signing.verifyLocalSignature('/Atelier.app',identity,async()=>requirement));`)).resolves.toMatchObject({stdout:'',stderr:''});
 });
 it('repairs both pending and older ready identities without importing or replacing their key',async()=>{
  await expect(check(`
   import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {X509Certificate} from 'node:crypto';import {execFileSync} from 'node:child_process';
   const directory=await mkdtemp(path.join(os.tmpdir(),'atelier-signing-test-'));await chmod(directory,0o700);
   try{
    const certificate=path.join(directory,'certificate.pem');execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'test-key.pem'),'-out',certificate,'-days','3650','-subj','/CN=Signing Test','-addext','extendedKeyUsage=codeSigning'],{stdio:'ignore'});await chmod(certificate,0o600);
    for(const name of ['identity.p12','atelier-local-signing.keychain-db'])await writeFile(path.join(directory,name),'synthetic fixture',{mode:0o600});
    const identity=new X509Certificate(await readFile(certificate)).fingerprint.replaceAll(':','').toUpperCase();const configuration=path.join(directory,'identity.json');const original={version:1,state:'ready',certificateSha1:identity,keychainPassword:'k'.repeat(43),archivePassword:'p'.repeat(43)};
    Object.defineProperty(process,'platform',{value:'darwin'});
    for(const state of ['pending','ready']){
     await writeFile(configuration,JSON.stringify({...original,state}),{mode:0o600});const calls=[];const run=async(command,args)=>{calls.push(args);return args[0]==='find-identity'?identity:'';};
     const result=await signing.provisionLocalSigning({directory,runCommand:run});assert.equal(result.reused,true);assert.equal(result.certificateSha1,identity);assert.equal(calls.some(args=>args[0]==='import'||args[0]==='create-keychain'),false);assert.equal(calls.filter(args=>args[0]==='set-key-partition-list').length,1);const saved=JSON.parse(await readFile(configuration,'utf8'));assert.equal(saved.state,'ready');assert.equal(saved.accessVersion,1);assert.equal(saved.keychainPassword,original.keychainPassword);assert.equal(saved.archivePassword,original.archivePassword);
    }
    await assert.rejects(signing.provisionLocalSigning({directory,runCommand:async(command,args)=>{if(args[0]==='set-key-partition-list')throw new Error('synthetic ACL failure');return args[0]==='find-identity'?identity:'';}}));assert.equal(JSON.parse(await readFile(configuration,'utf8')).state,'pending');await assert.rejects(signing.loadLocalSigning({directory,runCommand:async()=>{throw new Error('Must not unlock incomplete configuration');}}));
   }finally{await rm(directory,{recursive:true,force:true});}
  `)).resolves.toMatchObject({stdout:'',stderr:''});
 });
 it('does not expose child stderr, arguments or passwords through process errors',async()=>{
  await expect(check(`const secret='synthetic-private-signing-password';let caught;try{await signing.privateCommand(process.execPath,['-e','process.stderr.write(process.argv[1]);process.exit(1)',secret]);}catch(error){caught=error;}assert.ok(caught);assert.equal(String(caught).includes(secret),false);assert.equal(String(caught).includes('process.stderr'),false);`)).resolves.toMatchObject({stdout:'',stderr:''});
 });
});
