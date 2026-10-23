import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
export { createApp } from './app';
export type { AppOptions } from './app';

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  config({path:path.resolve('.env.local'),quiet:true});
  const port=Number(process.env.PORT)||3001;
  createApp().listen(port,'127.0.0.1',()=>console.log(`Atelier local pilot API listening at http://127.0.0.1:${port}`));
}
