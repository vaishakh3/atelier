import type { BimElement, Project, QuantityLine } from '../domain/types';
import { hostedOpeningGeometry } from '../model/geometry';

const round = (value:number) => Math.abs(value)<=Number.MAX_SAFE_INTEGER/1e6?Math.round(value * 1e6) / 1e6:value;
const validDimension = (value:number) => Number.isFinite(value) && value >= 0;

/** Deterministic gross/net measurements. Canonical geometry is always in metres. */
export function quantities(project:Project):QuantityLine[] {
  const types=new Map(project.types.map(type=>[type.id,type]));
  const levels=new Set(project.levels.map(level=>level.id));
  const children=new Map<string,BimElement[]>();
  for(const element of project.elements)if(element.hostId)children.set(element.hostId,[...(children.get(element.hostId)??[]),element]);
  return project.elements.map(element => {
    const issues:string[] = [];
    const type = types.get(element.typeId);
    if (!type) issues.push('Component type is missing.');
    if (type && type.kind !== element.kind) issues.push('Component type does not match element kind.');
    if(!levels.has(element.levelId))issues.push('Element has no valid building level.');
    if(![element.x,element.y,element.z,element.rotation].every(Number.isFinite))issues.push('Geometry contains a negative or non-finite coordinate or rotation.');
    const dimensions = [element.width, element.depth, element.height];
    if (!dimensions.every(validDimension)) issues.push('Geometry contains a negative or non-finite dimension.');
    const width = validDimension(element.width) ? element.width : 0;
    const depth = validDimension(element.depth) ? element.depth : 0;
    const height = validDimension(element.height) ? element.height : 0;
    let quantity = 0;
    let unit:string = type?.unit ?? defaultUnit(element);
    let formula = '';
    if (element.kind === 'wall') {
      const openingGeometry=hostedOpeningGeometry(element,children.get(element.id)??[]);
      issues.push(...openingGeometry.issues.map(issue=>issue.message));
      const openingArea = openingGeometry.unionArea;
      const grossArea = width * height;
      const netArea = Math.max(0, grossArea - openingArea);
      if (openingArea > grossArea) issues.push('Hosted openings exceed gross wall area; net quantity was clipped to zero.');
      if (unit === 'm³') { quantity = netArea * depth; formula = `(${width} × ${height} − ${round(openingArea)}) × ${depth} m³`; }
      else if (unit === 'm') { quantity = width; formula = `${width} m centre-line length; openings do not reduce length`; }
      else if (unit === 'ea') { quantity = 1; formula = '1 wall element'; }
      else { unit = 'm²'; quantity = netArea; formula = `${width} × ${height} − ${round(openingArea)} m² clipped hosted-opening union`; }
      if (width === 0 || height === 0 || depth === 0) issues.push('Wall length, height and thickness must be positive.');
    } else if (['slab', 'roof', 'room'].includes(element.kind)) {
      // MVP roofs are horizontal plan-area assemblies; sloped/freeform roofs remain reference-only.
      if (element.kind === 'room') unit = 'm²';
      if (unit === 'm³') { quantity = width * depth * height; formula = `${width} × ${depth} × ${height} m³`; }
      else if (unit === 'ea') { quantity = 1; formula = `1 ${element.kind} element`; }
      else if (unit === 'm') { quantity = 2 * (width + depth); formula = `2 × (${width} + ${depth}) m perimeter`; }
      else { unit = 'm²'; quantity = width * depth; formula = `${width} × ${depth} m² plan area`; }
      if (width === 0 || depth === 0) issues.push('Plan dimensions must be positive.');
      if (element.kind === 'roof') issues.push('Roof measured as horizontal plan area; pitch and complex geometry require review.');
    } else if (['door', 'window'].includes(element.kind)) {
      if (unit === 'm²') { quantity = width * height; formula = `${width} × ${height} m² opening area`; }
      else if (unit === 'm³') { quantity = width * height * depth; formula = `${width} × ${height} × ${depth} m³`; }
      else if (unit === 'm') { quantity = 2 * (width + height); formula = `2 × (${width} + ${height}) m perimeter`; }
      else { unit = 'ea'; quantity = 1; formula = '1 opening assembly'; }
      if (width === 0 || height === 0) issues.push('Opening dimensions must be positive.');
      if (!element.hostId || !project.elements.some(candidate => candidate.id === element.hostId && candidate.kind === 'wall')) issues.push('Opening has no valid host wall.');
    } else if (element.kind === 'stair') {
      if (unit === 'm³') { quantity = width * depth * height; formula = `${width} × ${depth} × ${height} m³ bounding assembly; verify stair specification`; }
      else { unit = 'ea'; quantity = 1; formula = '1 stair assembly'; }
    } else {
      unit = 'ea'; formula = 'Reference-only geometry excluded from measured scope';
      issues.push('Reference geometry has no supported measurement rule and is excluded from costing.');
    }
    if(!Number.isFinite(quantity)){quantity=0;issues.push('Invalid measurement: geometry overflowed the supported finite calculation range; quantity is unresolved.');}
    if(type&&element.kind!=='room'&&element.kind!=='reference'&&unit!==type.unit)issues.push(`Assembly unit ${type.unit} does not match the supported measurement unit ${unit}.`);
    return { elementId:element.id, name:element.name, kind:element.kind, typeId:element.typeId, quantity:round(quantity), unit, formula, issues };
  });
}

function defaultUnit(element:BimElement):string {
  return ['door', 'window', 'stair', 'reference'].includes(element.kind) ? 'ea' : 'm²';
}
