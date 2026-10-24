import {isValidElement} from 'react';
import type {ReactNode} from 'react';
import {describe,expect,it} from 'vitest';
import {FurnitureMesh} from '../src/components/InteriorScene';
import {FURNITURE_CATALOG} from '../src/interior/catalog';

describe('interior catalogue geometry',()=>{
 it('keeps every visible furniture part inside the exact SKU envelope used for fit and sourcing',()=>{
  for(const asset of FURNITURE_CATALOG){
   const mesh=FurnitureMesh({asset,placement:{id:'placement',assetId:asset.id,roomId:'room',levelId:'level',x:7,y:11,rotation:90},elevation:3.35});
   expect(mesh.props.position).toEqual([7,3.35,11]);let boxes=0;
   function visit(node:ReactNode){if(Array.isArray(node)){node.forEach(visit);return;}if(!isValidElement<{children?:ReactNode;position?:number[];args?:number[]}>(node))return;if(node.type==='mesh'){
    const children=Array.isArray(node.props.children)?node.props.children:[node.props.children],geometry=children.find(child=>isValidElement(child)&&child.type==='boxGeometry');if(isValidElement<{args:number[]}>(geometry)){
     boxes++;const size=geometry.props.args,position=node.props.position??[0,0,0],minimum=[-asset.width/2,0,-asset.depth/2],maximum=[asset.width/2,asset.height,asset.depth/2];for(let axis=0;axis<3;axis++){expect(position[axis]-size[axis]/2,`${asset.name} lower axis ${axis}`).toBeGreaterThanOrEqual(minimum[axis]-1e-8);expect(position[axis]+size[axis]/2,`${asset.name} upper axis ${axis}`).toBeLessThanOrEqual(maximum[axis]+1e-8);}
    }
   }visit(node.props.children);}
   visit(mesh);expect(boxes,asset.name).toBeGreaterThan(2);
  }
 });
});
