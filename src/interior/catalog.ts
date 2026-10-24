import type {FurnitureAsset} from './types';
export {INTERIOR_STYLES} from './styles';
const source=(path:string)=>({vendor:'IKEA India',url:`https://www.ikea.com/in/en/p/${path}/`,checkedAt:'2026-10-24',availability:'unverified' as const});
/** Manufacturer-listed assembled outer dimensions, checked on the linked product pages.
 * These are schematic, SKU-sized planning proxies, not licensed manufacturer 3D meshes.
 * Theme matches are Atelier curation for a setting, not manufacturer style certification.
 * Existing products retain their stated materials, finishes and fixed dimensions.
 * Stock, delivery to the project location, finish options and pricing remain unverified.
 */
export const FURNITURE_CATALOG:FurnitureAsset[]=[
 {id:'ikea-kivik-3-seat',name:'KIVIK three-seat sofa',category:'sofa',width:2.28,depth:.95,height:.83,color:'#c8bcaa',styles:['japandi','scandinavian','contemporary','tropical-modern','kerala-contemporary','coastal','bohemian','mid-century'],source:source('kivik-3-seat-sofa-tresund-light-beige-s49482832')},
 {id:'ikea-klippan-2-seat',name:'KLIPPAN two-seat sofa',category:'sofa',width:1.8,depth:.88,height:.66,color:'#b5ada2',styles:['modern','contemporary','japandi','industrial','bohemian','mid-century'],source:source('klippan-2-seat-sofa-grimsmala-black-beige-s69625203')},
 {id:'ikea-lisabo-chair',name:'LISABO ash chair',category:'chair',width:.46,depth:.51,height:.8,color:'#c9ac7b',styles:['japandi','japanese','scandinavian','modern','tropical-modern','kerala-contemporary','coastal','bohemian','mid-century'],source:source('lisabo-chair-ash-tallmyra-white-black-50561041')},
 {id:'ikea-malm-bed-160',name:'MALM bed frame · 160 × 200 mattress',category:'bed',width:1.76,depth:2.09,height:1,color:'#e0dbd0',styles:['japanese','japandi','modern','scandinavian','contemporary','tropical-modern','kerala-contemporary','coastal','bohemian','industrial'],source:source('malm-bed-frame-high-white-s79028628')},
 {id:'ikea-micke-desk-142',name:'MICKE desk · 142 cm',category:'desk',width:1.42,depth:.5,height:.75,color:'#dfded8',styles:['modern','scandinavian','contemporary','coastal'],source:source('micke-desk-white-40354278')},
 {id:'ikea-micke-desk-73',name:'MICKE compact desk · 73 cm',category:'desk',width:.73,depth:.5,height:.75,color:'#706252',styles:['japandi','japanese','modern','contemporary','industrial','mid-century','kerala-contemporary'],source:source('micke-desk-black-brown-20354279')},
 {id:'ikea-lisabo-table',name:'LISABO dining table',category:'table',width:1.4,depth:.78,height:.74,color:'#c6a773',styles:['japandi','japanese','scandinavian','modern','tropical-modern','kerala-contemporary','coastal','bohemian','mid-century'],source:source('lisabo-table-ash-veneer-80365717')},
 {id:'ikea-lack-side-table',name:'LACK side table',category:'table',width:.55,depth:.55,height:.45,color:'#655347',styles:['japanese','japandi','modern','contemporary','industrial','mid-century','kerala-contemporary','bohemian'],source:source('lack-side-table-black-brown-80352927')},
 {id:'ikea-billy-bookcase',name:'BILLY bookcase',category:'cabinet',width:.8,depth:.28,height:2.02,color:'#e7e1d7',styles:['scandinavian','modern','japandi','contemporary','tropical-modern','coastal','bohemian','industrial'],source:source('billy-bookcase-white-00522047')},
];
