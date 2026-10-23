import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
 plugins:[react()],
 server:{port:5173,strictPort:true,host:'127.0.0.1',proxy:{'/api':'http://127.0.0.1:3001'}},
 build:{rollupOptions:{output:{manualChunks(id){
  if(id.includes('/node_modules/')){
   if(/\/(three|@react-three|three-stdlib|maath|meshline|troika-[^/]+)\//.test(id))return 'model-viewer';
   if(/\/(jspdf|xlsx|html2canvas|dompurify|fflate|canvg)\//.test(id))return 'document-export';
   if(/\/(react|react-dom|scheduler)\//.test(id))return 'react';
  }
 }}}}
});
