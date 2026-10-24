import {z} from 'zod';
const text=z.string().max(3000),finite=z.number().finite();
const date=z.string().refine(value=>value===''||/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value,'Use an ISO calendar date.');
const source=z.object({title:text,url:z.string().max(3000).refine(value=>value===''||/^https:\/\//.test(value)&&(()=>{try{return new URL(value).protocol==='https:';}catch{return false;}})(),'Use a complete HTTPS source URL.'),version:text,effectiveFrom:date,reviewedOn:date,country:text,region:text,authority:text,authorityType:z.enum(['municipality','corporation','panchayat','unconfirmed']),applicability:text,confirmedBy:text,amendmentsChecked:z.boolean().optional(),worksheet:z.literal('kerala-a1-2025').optional(),panchayatCategory:z.enum(['I','II']).optional()}).strict();
export const planningContextSchema=z.object({
 country:text,region:text,authority:text,authorityType:z.enum(['municipality','corporation','panchayat','unconfirmed']),occupancy:z.literal('single-family-residential'),
 plot:z.object({x:finite.min(-1e7).max(1e7),y:finite.min(-1e7).max(1e7),width:finite.min(1).max(10000),depth:finite.min(1).max(10000),rotation:finite.min(-360).max(360)}).strict().nullable(),
 frontBoundary:z.enum(['south','north','west','east']),northAngle:finite.min(-360).max(360).nullable(),groundElevation:finite.min(-1e5).max(1e5).nullable(),roadWidth:finite.min(0).max(500).nullable(),notes:text,panchayatCategory:z.enum(['I','II','unconfirmed']).optional(),
 ruleSource:source,rules:z.array(z.object({id:z.string().min(1).max(160),metric:z.enum(['front-setback','rear-setback','left-setback','right-setback','coverage','floor-area-ratio','height','storeys']),limit:finite.min(0).max(10000),clause:text}).strict()).max(8),
 vaastu:z.object({enabled:z.boolean(),preferences:z.array(z.object({id:z.string().min(1).max(160),target:z.enum(['kitchen','bedroom','bathroom','living','study','entrance','stair']),mode:z.enum(['prefer','avoid']),sectors:z.array(z.enum(['N','NE','E','SE','S','SW','W','NW','centre'])).min(1).max(9)}).strict()).max(20)}).strict(),
}).strict().superRefine((value,ctx)=>{
 if(new Set(value.rules.map(r=>r.metric)).size!==value.rules.length||new Set(value.rules.map(r=>r.id)).size!==value.rules.length)ctx.addIssue({code:'custom',message:'Use one rule per metric and unique rule IDs.'});
 if(new Set(value.vaastu.preferences.map(r=>r.id)).size!==value.vaastu.preferences.length)ctx.addIssue({code:'custom',message:'Use unique preference IDs.'});
});
