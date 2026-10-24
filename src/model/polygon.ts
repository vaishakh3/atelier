export interface PolygonPoint {x:number;y:number}
export function polygonArea(points:PolygonPoint[]):number{return Math.abs(points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0))/2;}
export function polygonPerimeter(points:PolygonPoint[]):number{return points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+Math.hypot(b.x-a.x,b.y-a.y);},0);}
export function polygonProblem(points:PolygonPoint[]):string|null {
 if(points.length<3||points.length>128)return 'Use between 3 and 128 polygon vertices.';
 if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>100000||Math.abs(p.y)>100000))return 'Polygon coordinates must be finite and within 100 km of the model origin.';
 const cross=(a:PolygonPoint,b:PolygonPoint,c:PolygonPoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),eps=1e-8;
 const on=(a:PolygonPoint,b:PolygonPoint,c:PolygonPoint)=>Math.abs(cross(a,b,c))<eps&&c.x>=Math.min(a.x,b.x)-eps&&c.x<=Math.max(a.x,b.x)+eps&&c.y>=Math.min(a.y,b.y)-eps&&c.y<=Math.max(a.y,b.y)+eps;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length];if(Math.hypot(a.x-b.x,a.y-b.y)<1e-5)return 'Polygon edges must have distinct endpoints.';
  for(let j=i+1;j<points.length;j++){
   if(j===i+1||i===0&&j===points.length-1)continue;const c=points[j],d=points[(j+1)%points.length];
   const c1=cross(a,b,c),c2=cross(a,b,d),c3=cross(c,d,a),c4=cross(c,d,b);
   if(c1*c2< -eps&&c3*c4< -eps||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))return 'Polygon must be simple, without crossing or touching non-adjacent edges.';
  }
 }
 if(polygonArea(points)<.01)return 'Polygon area must be at least 0.01 m².';
 return null;
}
