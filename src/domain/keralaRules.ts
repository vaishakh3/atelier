import type {PlanningContext} from './planning';

export const keralaSources={
 municipal:{title:'Kerala Municipality Building (Amendment) Rules, 2025',version:'G.O.(P) 53/2025/LSGD · S.R.O. 1240/2025',url:'https://go.lsgkerala.gov.in/pages/fileOpen.php?fname=gz20251029_39867.pdf&id=39867'},
 panchayat:{title:'Kerala Panchayat Building (Amendment) Rules, 2025',version:'G.O.(P) 54/2025/LSGD · S.R.O. 1241/2025',url:'https://go.lsgkerala.gov.in/pages/fileOpen.php?fname=gz20251029_39868.pdf&id=39868'},
 index:'https://lsgd.kerala.gov.in/en/orders-and-circulars/gazette-notifications/',
}as const;
/** Dated review worksheet, deliberately not a current-law or permit-validation preset. */
export function keralaResidentialWorksheet(input:PlanningContext):PlanningContext{
 if(input.country.trim().toLowerCase()!=='india'||input.region.trim().toLowerCase()!=='kerala'||input.authorityType==='unconfirmed')throw new Error('Choose India, Kerala and a confirmed local-body type first.');
 const panchayat=input.authorityType==='panchayat';
 if(panchayat&&!['I','II'].includes(input.panchayatCategory??''))throw new Error('Confirm the notified panchayat Category I or II; it cannot be inferred from the locality name.');
 const source=panchayat?keralaSources.panchayat:keralaSources.municipal,categoryII=panchayat&&input.panchayatCategory==='II';
 return{...input,ruleSource:{...source,country:input.country,region:input.region,authority:input.authority,authorityType:input.authorityType,effectiveFrom:'2025-10-29',reviewedOn:'',confirmedBy:'',amendmentsChecked:false,worksheet:'kerala-a1-2025',...(panchayat?{panchayatCategory:input.panchayatCategory as 'I'|'II'}:{}),applicability:`Dated 2025 Group A1 worksheet for model height at most 10 m. Uniform-envelope proxies use ordinary average yards (front 3 m, rear 1.5 m, sides 1 m); absolute minima and road-line restrictions are separate. ${panchayat?`Panchayat Category ${input.panchayatCategory}. `:''}Check subsequent amendments, local plans, height definition and statutory area inclusions before confirming. No small-plot, consent, no-opening or paid-FSI relaxations are assumed.`},rules:[
  {id:'kerala-front',metric:'front-setback',limit:3,clause:'Rule 26(4), Table 4: ordinary average front yard; uniform-envelope proxy only. Separate minimum and Rule 23 road/building-line review required.'},
  {id:'kerala-rear',metric:'rear-setback',limit:1.5,clause:'Rule 26(4), Table 4: ordinary average rear yard; uniform-envelope proxy only.'},
  {id:'kerala-left',metric:'left-setback',limit:1,clause:'Rule 26(4), Table 4: ordinary side yard; exceptions not applied.'},
  {id:'kerala-right',metric:'right-setback',limit:1,clause:'Rule 26(4), Table 4: ordinary side yard; exceptions not applied.'},
  {id:'kerala-coverage',metric:'coverage',limit:categoryII?60:65,clause:'Rule 27(2), Table 6: A1 coverage; model slab union is only an area proxy. Confirm statutory inclusions.'},
  {id:'kerala-fsi',metric:'floor-area-ratio',limit:categoryII?2.5:3,clause:'Rule 27(2), Table 6: A1 FSI without additional fee; model area proxy. Paid extensions are not applied.'},
 ]};
}
