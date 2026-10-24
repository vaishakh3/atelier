/** Metres and world-space centre coordinates; SKU dimensions are never scaled. */
export interface FurniturePlacement { id:string; assetId:string; roomId:string; levelId:string; x:number; y:number; rotation:number }
export type FurnitureCategory='sofa'|'chair'|'bed'|'desk'|'table'|'cabinet';
export interface FurnitureAsset { id:string; name:string; category:FurnitureCategory; width:number; depth:number; height:number; color:string; styles:string[]; source:{vendor:string;url:string;checkedAt:string;availability:'unverified'} }
export interface InteriorStyleImage {src:string;alt:string;credit:string;sourceUrl:string;licenseUrl:string}
export interface InteriorStyle {id:string;name:string;description:string;palette:string[];materials:string[];lighting:string;tags:string[];sources:{title:string;url:string}[];image?:InteriorStyleImage}
export interface InteriorReference {id:string;name:string;dataUrl:string;styleId:string}
export interface InteriorState {schemaVersion:1;styleId:string;placements:FurniturePlacement[];references:InteriorReference[]}
