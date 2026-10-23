import path from 'node:path';

/** ASAR's lookup traverses native path separators, while our portable manifest uses '/'. */
export function archiveEntryPath(entry,platformPath=path){
 if(typeof entry!=='string'||!entry||entry.includes('\0')||/^[\\/]|^[a-zA-Z]:/.test(entry))throw new Error('Invalid relative archive entry.');
 const parts=entry.split(/[\\/]/);if(parts.some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid relative archive entry.');
 return platformPath.join(...parts);
}
