import type { BimElement, Project, Role } from '../domain/types';
import { localToWorld, worldToLocal } from '../model/geometry';
import { defaultServiceAssumptions } from './calculations';
import { inspectServiceReferences, servicePlanSchema } from './schema';
import type { ServiceIssue, ServicePlan, ServicePoint, ServicePointKind, ServiceRoute, ServiceVector } from './types';

const programme = new Set(['bedroom', 'bathroom', 'living', 'kitchen', 'dining', 'theater', 'pool', 'study', 'utility', 'garage', 'other']);
const swapUses = new Set(['bedroom', 'living', 'dining', 'study', 'utility']);
const plumbing = new Set<ServicePointKind>(['basin', 'wc', 'shower', 'sink']);
const electrical = new Set<ServicePointKind>(['light', 'switch', 'socket', 'equipment']);
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const distance = (a: ServiceVector, b: ServiceVector) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Full bounded geometry/reference signature, not a version-only or lossy hash comparison. */
export function serviceModelSignature(project: Project): string {
  return canonical({ currency: project.currency, levels: [...project.levels].sort((a, b) => a.id.localeCompare(b.id)), elements: [...project.elements].sort((a, b) => a.id.localeCompare(b.id)) });
}
export function servicePlanIsCurrent(project: Project, plan: ServicePlan): boolean { return plan.modelSignature === serviceModelSignature(project) && inspectServiceIntegrity(project, plan).length === 0; }
export const isServicePlanCurrent = servicePlanIsCurrent;

/** Room offsets use rotated room axes; z is always measured above the level datum. */
export function pointPosition(project: Project, point: ServicePoint): ServiceVector {
  const level = project.levels.find(value => value.id === point.levelId);
  if (!level || !Number.isFinite(level.elevation)) throw new Error(`${point.name}: the referenced building level is unavailable.`);
  if (![point.offset.x, point.offset.y, point.offset.z].every(Number.isFinite)) throw new Error(`${point.name}: position must contain finite coordinates.`);
  if (!point.roomId) return { x: point.offset.x, y: point.offset.y, z: round(level.elevation + point.offset.z) };
  const room = project.elements.find(value => value.id === point.roomId && value.kind === 'room');
  if (!room || room.levelId !== point.levelId) throw new Error(`${point.name}: the room host is unavailable or belongs to another level. Reassign the point before rerouting.`);
  const xy = localToWorld(room, point.offset.x, point.offset.y);
  return { x: round(xy.x), y: round(xy.y), z: round(level.elevation + point.offset.z) };
}
export const resolveServicePoint = pointPosition;

/** Cheap validity guard shared by pricing/scheduling; geometric review is separate. */
export function inspectServiceIntegrity(project: Project, plan: ServicePlan): ServiceIssue[] {
  const parsed = servicePlanSchema.safeParse(plan);
  if (!parsed.success) return [{ id: 'invalid-services', severity: 'error', message: `Invalid services model: ${parsed.error.issues.slice(0, 3).map(issue => issue.message).join(' ')}`, sourceIds: [] }];
  const issues = inspectServiceReferences(project, plan), points = new Map(plan.points.map(point => [point.id, point]));
  for (const route of plan.routes) {
    try {
      const start = pointPosition(project, points.get(route.fromId)!), end = pointPosition(project, points.get(route.toId)!);
      if (distance(route.points[0], start) > .001 || distance(route.points.at(-1)!, end) > .001) issues.push({ id: `route-endpoints-${route.id}`, severity: 'error', message: `${route.system} route ${route.id} no longer meets its point positions. Reroute before accepting.`, sourceIds: [route.id, route.fromId, route.toId] });
    } catch { /* Missing references already carry actionable issues above. */ }
  }
  return issues;
}

function idPart(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return `${value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 45)}-${(hash >>> 0).toString(16)}`;
}
function validateRooms(project: Project): BimElement[] {
  const rooms = project.elements.filter(element => element.kind === 'room' && programme.has(String(element.properties.use))).sort((a, b) => a.levelId.localeCompare(b.levelId) || a.id.localeCompare(b.id));
  if (!rooms.length) throw new Error('Assign explicit room uses (bedroom, bathroom, kitchen, living, etc.) before proposing services. Empty models and unclassified imported spaces cannot be inferred safely.');
  if (rooms.length > 100) throw new Error('Concept services currently support up to 100 classified programme rooms. Narrow the model scope first.');
  for (const room of rooms) {
    if (![room.x, room.y, room.z, room.rotation, room.width, room.depth].every(Number.isFinite) || room.width < 1 || room.depth < 1 || room.width > 1000 || room.depth > 1000 || room.properties.geometryUnsupported === true || room.properties.nonRectangular === true) throw new Error(`${room.name}: services need a finite rectangular room shell at least 1 × 1 m. Review unsupported imported/nonrectangular geometry first.`);
    if (!project.levels.some(level => level.id === room.levelId)) throw new Error(`${room.name}: room references an unknown building level.`);
  }
  return rooms;
}

export function createServicePlan(project: Project): ServicePlan {
  const rooms = validateRooms(project), points: ServicePoint[] = [];
  const lowest = [...project.levels].filter(level => rooms.some(room => room.levelId === level.id)).sort((a, b) => a.elevation - b.elevation || a.id.localeCompare(b.id))[0];
  const baseRoom = rooms.find(room => room.levelId === lowest.id && !['pool', 'bathroom'].includes(String(room.properties.use))) ?? rooms.find(room => room.levelId === lowest.id)!;
  const wetRoom = rooms.find(room => room.levelId === lowest.id && ['bathroom', 'kitchen', 'utility'].includes(String(room.properties.use))) ?? baseRoom;
  const add = (room: BimElement, kind: ServicePointKind, x: number, y: number, z: number, loadWatts: number | null, suffix = '') => {
    const circuitId = electrical.has(kind) ? `${kind === 'light' || kind === 'switch' ? 'lighting' : 'power'}-${idPart(room.levelId)}` : undefined;
    points.push({ id: `svc-${idPart(room.id)}-${kind}${suffix}`, name: `${room.name} · ${kind}${suffix ? ` ${suffix}` : ''}`, kind, roomId: room.id, levelId: room.levelId, offset: { x: round(x), y: round(y), z }, loadWatts, ...(circuitId ? { circuitId } : {}) });
  };
  add(baseRoom, 'panel', .15, .15, 1.5, null);
  add(wetRoom, 'water-inlet', .15, .15, .15, null);
  add(wetRoom, 'drain-outlet', .15, .3, -.25, null);
  for (const room of rooms) {
    if (room.properties.use === 'pool') continue;
    add(room, 'light', room.width / 2, room.depth / 2, 2.6, 12);
    add(room, 'switch', .15, Math.min(.5, room.depth / 2), 1.2, 0);
    if (room.properties.use !== 'bathroom') {
      add(room, 'socket', room.width - .15, room.depth / 3, .45, null, '-1');
      add(room, 'socket', .15, room.depth * 2 / 3, .45, null, '-2');
    }
    if (room.properties.use === 'bathroom') {
      add(room, 'basin', room.width * .25, .3, .8, null);
      add(room, 'wc', room.width * .7, .3, .2, null);
      add(room, 'shower', room.width * .75, room.depth - .3, 1.8, null);
    } else if (room.properties.use === 'kitchen') add(room, 'sink', room.width * .65, .3, .8, null);
  }
  const plan: ServicePlan = {
    schemaVersion: 1, status: 'concept', modelSignature: serviceModelSignature(project), points, routes: [], assumptions: defaultServiceAssumptions(project.currency),
    notes: [
      'Concept coordination only. Point placements and orthogonal centreline routes are editable proposals; they are not installation drawings or a code-compliance approval.',
      'A 12 W allowance is assigned to each proposed light. Socket and equipment loads remain unknown until entered; circuits are conceptual groups, not breaker or cable selections.',
      'Electrical runs represent one panel-to-point centreline per branch, not conductor lengths. Plumbing branches share conceptual inlet/outlet positions; fittings, pipe diameters, hot water, venting and shared distribution sizing are excluded.',
      'Drainage centreline routes do not resolve gravity falls, traps, invert elevations, stack capacity or discharge permissions. The gradient calculation is an entered-ratio arithmetic check only.',
      'Water inlet, drain outlet and panel positions are placeholders in the lowest occupied level. Confirm utility connections, meter/panel clearances, wet-zone separation, shafts and penetrations before use.',
      'Rates and installation productivity start blank. Enter a dated local quotation and crew outputs before using cost or duration comparisons.',
      'This initial point proposal excludes circulation/stair/exterior lighting, communications, hot water, ventilation and specialist equipment. Add and coordinate these scopes explicitly; point counts are not a complete building-services specification.',
      ...(rooms.some(room => room.properties.use === 'pool') ? ['Pool pumps, filtration, heating, dehumidification, electrical bonding and specialist hydraulic design are excluded from this proposal and estimate.'] : []),
      ...(project.elements.some(element => element.kind === 'room' && !programme.has(String(element.properties.use)) && element.properties.use !== 'circulation') ? ['Unclassified room spaces were excluded; assign explicit room uses and review coverage before relying on the proposal.'] : []),
    ],
  };
  return rerouteServicePlan(project, plan);
}

function routeBetween(project: Project, from: ServicePoint, to: ServicePoint, system: ServiceRoute['system']): ServiceRoute {
  const a = pointPosition(project, from), b = pointPosition(project, to);
  // A shared vertical spine at the source is an explicit concept, not an allocated shaft.
  const raw = [a, { x: a.x, y: a.y, z: b.z }, { x: b.x, y: a.y, z: b.z }, b];
  const points = raw.filter((point, index) => index === 0 || distance(point, raw[index - 1]) > 1e-7);
  if (points.length < 2) throw new Error(`${from.name} and ${to.name} occupy the same position; separate the proposed points.`);
  return { id: `route-${system}-${idPart(system === 'drainage' ? from.id : to.id)}`, system, fromId: from.id, toId: to.id, points, ...(system === 'electrical' ? { circuitId: to.circuitId } : {}) };
}

/** Retains point edits, loads and assumptions; recalculates routes against the current shell. */
export function rerouteServicePlan(project: Project, plan: ServicePlan): ServicePlan {
  const detached = structuredClone(plan), references = inspectServiceReferences(project, detached);
  if (references.length) throw new Error(references.map(issue => issue.message).join(' '));
  const panels = detached.points.filter(point => point.kind === 'panel'), inlets = detached.points.filter(point => point.kind === 'water-inlet'), outlets = detached.points.filter(point => point.kind === 'drain-outlet');
  if (panels.length !== 1 || inlets.length !== 1 || outlets.length !== 1) throw new Error('Concept rerouting requires exactly one electrical panel, water inlet and drain outlet. Multiple service sources require specialist coordination.');
  const routes: ServiceRoute[] = [];
  for (const point of detached.points) {
    if (electrical.has(point.kind)) {
      if (!point.circuitId?.trim()) throw new Error(`${point.name}: assign a circuit group before rerouting.`);
      routes.push(routeBetween(project, panels[0], point, 'electrical'));
    }
    if (plumbing.has(point.kind)) {
      routes.push(routeBetween(project, inlets[0], point, 'cold-water'));
      routes.push(routeBetween(project, point, outlets[0], 'drainage'));
    }
  }
  detached.routes = routes;
  detached.modelSignature = serviceModelSignature(project);
  const result = servicePlanSchema.safeParse(detached);
  if (!result.success) throw new Error(`The services proposal is invalid: ${result.error.issues.slice(0, 3).map(issue => issue.message).join(' ')}`);
  return result.data;
}

function intersectsBox(from: ServiceVector, to: ServiceVector, element: BimElement): boolean {
  const a = worldToLocal(element, from), b = worldToLocal(element, to);
  const starts = [a.x, a.y, from.z], ends = [b.x, b.y, to.z], minima = [0, 0, element.z], maxima = [element.width, element.depth, element.z + element.height];
  let enter = 0, exit = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = ends[axis] - starts[axis];
    if (Math.abs(delta) < 1e-9) { if (starts[axis] <= minima[axis] + 1e-5 || starts[axis] >= maxima[axis] - 1e-5) return false; continue; }
    const first = (minima[axis] - starts[axis]) / delta, last = (maxima[axis] - starts[axis]) / delta;
    enter = Math.max(enter, Math.min(first, last)); exit = Math.min(exit, Math.max(first, last));
    if (exit - enter < 1e-6) return false;
  }
  return exit > 1e-6 && enter < 1 - 1e-6;
}

export function inspectServices(project: Project, plan: ServicePlan): ServiceIssue[] {
  const issues = inspectServiceIntegrity(project, plan);
  if (issues.some(issue => issue.id === 'invalid-services')) return issues;
  if (plan.modelSignature !== serviceModelSignature(project)) issues.push({ id: 'services-stale', severity: 'review', message: 'The architectural model changed after this services proposal. Reroute and review affected connections and quantities.', sourceIds: [] });
  const physical = project.elements.filter(element => ['wall', 'slab', 'stair'].includes(element.kind));
  for (const system of ['electrical', 'cold-water', 'drainage'] as const) {
    const hits = new Set<string>(), routes = new Set<string>();
    for (const route of plan.routes.filter(route => route.system === system)) for (const element of physical) if (route.points.some((point, index) => index > 0 && intersectsBox(route.points[index - 1], point, element))) { hits.add(element.id); routes.add(route.id); }
    if (hits.size) issues.push({ id: `penetrations-${system}`, severity: 'review', message: `${system}: ${routes.size} proposed routes intersect ${hits.size} wall/slab/stair bounding volumes. Confirm shafts, openings, sleeves, access and fire stopping; these geometry proxies do not approve penetrations.`, sourceIds: [...hits, ...routes] });
  }
  const wet = project.elements.filter(element => element.kind === 'room' && ['bathroom', 'kitchen', 'utility'].includes(String(element.properties.use)));
  const centre = (room: BimElement) => localToWorld(room, room.width / 2, room.depth / 2);
  for (const bathroom of wet.filter(room => room.properties.use === 'bathroom')) {
    const level = project.levels.find(level => level.id === bathroom.levelId);
    if (!level) continue;
    const lowerLevels = project.levels.filter(other => other.elevation < level.elevation).sort((a, b) => b.elevation - a.elevation);
    if (!lowerLevels.length) continue;
    const below = wet.filter(room => room.levelId === lowerLevels[0].id).map(room => ({ room, d: Math.hypot(centre(room).x - centre(bathroom).x, centre(room).y - centre(bathroom).y) })).sort((a, b) => a.d - b.d);
    if (!below.length) issues.push({ id: `wet-stack-${bathroom.id}`, severity: 'review', message: `${bathroom.name}: no classified wet room exists on the level immediately below. Consider a coordinated service shaft and review vertical drainage.`, sourceIds: [bathroom.id] });
    else issues.push({ id: `wet-stack-${bathroom.id}`, severity: 'review', message: `${bathroom.name}: nearest wet room on the level below is ${below[0].room.name}, ${below[0].d.toFixed(2)} m between plan centres. ${below[0].d > 2 ? 'Compare a closer bathroom position to simplify routing.' : 'Potential wet-area grouping; confirm fixture/shaft alignment.'} Centre distance is a proxy, not a verified stack or structural opening.`, sourceIds: [bathroom.id, below[0].room.id] });
  }
  for (const kitchen of wet.filter(room => room.properties.use === 'kitchen')) {
    const near = wet.filter(room => room.id !== kitchen.id && room.levelId === kitchen.levelId).map(room => ({ room, d: Math.hypot(centre(room).x - centre(kitchen).x, centre(room).y - centre(kitchen).y) })).sort((a, b) => a.d - b.d)[0];
    issues.push({ id: `wet-group-${kitchen.id}`, severity: 'review', message: near ? `${kitchen.name}: nearest same-level wet/service room is ${near.room.name}, ${near.d.toFixed(2)} m between plan centres. Compare a shared service zone while retaining kitchen hygiene, privacy and maintenance access; centre distance does not establish adjacency.` : `${kitchen.name}: no other same-level wet/service room is classified. Review a dedicated accessible route to the service connections.`, sourceIds: [kitchen.id, ...(near ? [near.room.id] : [])] });
  }
  const unknownLoads = plan.points.filter(point => electrical.has(point.kind) && point.loadWatts === null);
  if (unknownLoads.length) issues.push({ id: 'unknown-electrical-loads', severity: 'review', message: `${unknownLoads.length} electrical point loads are unknown. Enter equipment/socket assumptions before interpreting current or demand-factor calculations.`, sourceIds: unknownLoads.map(point => point.id) });
  const wetSockets = plan.points.filter(point => ['socket', 'equipment', 'panel'].includes(point.kind) && point.roomId && project.elements.some(room => room.id === point.roomId && room.properties.use === 'bathroom'));
  if (wetSockets.length) issues.push({ id: 'bathroom-electrical-review', severity: 'review', message: `${wetSockets.length} retained socket/equipment/panel positions are hosted in bathrooms. Wet-zone separation and equipment suitability are not verified; an electrical specialist must review or relocate them before installation.`, sourceIds: wetSockets.flatMap(point => [point.id, point.roomId!]) });
  if (project.elements.some(element => element.properties.servicesAccessReview === true)) issues.push({ id: 'swapped-room-access', severity: 'review', message: 'A room-function swap retained its existing walls, doors and windows. Review privacy, access, bathroom clearances, ventilation, waterproofing and all former ensuite relationships before design approval.', sourceIds: project.elements.filter(element => element.properties.servicesAccessReview === true).map(element => element.id) });
  issues.push({ id: 'services-engineering-review', severity: 'review', message: 'Concept routes do not verify cable/protection/earthing, wet-zone electrical separation, pipe sizing, gravity drainage, venting or statutory compliance. Specialist installation design and review remain required.', sourceIds: [] });
  return issues;
}

function assertUnlocked(project: Project, element: BimElement, fields: string[]) {
  if (!element.editable || project.constraints.lockedElementIds.includes(element.id)) throw new Error(`${element.name} is locked or not editable.`);
  const scopes = ['*', 'elements', 'elements.*', 'model.elements', 'model.elements.*', `${element.id}.*`, `elements.${element.id}`, `elements.${element.id}.*`, `model.elements.${element.id}`, `model.elements.${element.id}.*`];
  if (project.constraints.lockedProperties.some(lock => scopes.includes(lock) || fields.some(field => [field, `model.${field}`, `${element.id}.${field}`, `elements.${field}`, `elements.${element.id}.${field}`, `elements.*.${field}`, `model.elements.${field}`, `model.elements.*.${field}`, `model.elements.${element.id}.${field}`].includes(lock)))) throw new Error(`${element.name}: a required property is locked.`);
}

/** Swap room FUNCTIONS within existing shells; never silently move walls or door openings. */
export function previewServiceRoomSwap(project: Project, bathroomId: string, targetRoomId: string): Project {
  const bathroom = project.elements.find(element => element.id === bathroomId && element.kind === 'room'), target = project.elements.find(element => element.id === targetRoomId && element.kind === 'room');
  if (!bathroom || !target || bathroom.id === target.id || bathroom.properties.use !== 'bathroom' || !swapUses.has(String(target.properties.use))) throw new Error('Choose one classified bathroom and a different bedroom, living, dining, study or utility room. Kitchen, garage and pool function swaps require specialist replanning.');
  if (bathroom.levelId !== target.levelId) throw new Error('The supported room-function swap must stay on the same floor; cross-floor circulation and access need a separate layout review.');
  assertUnlocked(project, bathroom, ['name', 'properties', 'properties.*', 'use', 'properties.use', 'attachedTo', 'properties.attachedTo', 'requestedArea', 'properties.requestedArea', 'services']);
  assertUnlocked(project, target, ['name', 'properties', 'properties.*', 'use', 'properties.use', 'attachedTo', 'properties.attachedTo', 'requestedArea', 'properties.requestedArea', 'services']);
  const next = structuredClone(project), bathNext = next.elements.find(element => element.id === bathroomId)!, targetNext = next.elements.find(element => element.id === targetRoomId)!;
  bathNext.name = target.name; targetNext.name = bathroom.name;
  bathNext.properties.use = target.properties.use; targetNext.properties.use = 'bathroom';
  if (Object.hasOwn(target.properties, 'requestedArea')) bathNext.properties.requestedArea = target.properties.requestedArea; else delete bathNext.properties.requestedArea;
  if (Object.hasOwn(bathroom.properties, 'requestedArea')) targetNext.properties.requestedArea = bathroom.properties.requestedArea; else delete targetNext.properties.requestedArea;
  const keys = [bathroom.properties.layoutKey, target.properties.layoutKey].filter((key): key is string => typeof key === 'string');
  for (const element of next.elements) {
    const attached = element.properties.attachedTo;
    if (element.id === bathroomId || element.id === targetRoomId || typeof attached === 'string' && keys.includes(attached)) {
      assertUnlocked(project, project.elements.find(original => original.id === element.id)!, ['properties', 'properties.*', 'attachedTo', 'properties.attachedTo', 'servicesAccessReview', 'properties.servicesAccessReview']);
      delete element.properties.attachedTo;
      element.properties.servicesAccessReview = true;
    }
    if (element.kind === 'door' && keys.some(key => element.properties.accessFrom === key || element.properties.accessTo === key)) {
      assertUnlocked(project, project.elements.find(original => original.id === element.id)!, ['properties', 'properties.*', 'servicesAccessReview', 'properties.servicesAccessReview']);
      element.properties.servicesAccessReview = true;
    }
  }
  if (project.services) {
    if (!servicePlanIsCurrent(project, project.services)) throw new Error('Reroute the existing services against the current model before comparing a bathroom swap.');
    const plan = structuredClone(project.services);
    for (const point of plan.points) if (point.roomId === bathroomId && plumbing.has(point.kind)) {
      point.roomId = targetRoomId;
      point.offset.x = round(point.offset.x / bathroom.width * target.width);
      point.offset.y = round(point.offset.y / bathroom.depth * target.depth);
    }
    plan.notes = [...plan.notes.filter(note => !note.startsWith('Room-function swap:')), 'Room-function swap: bathroom fixtures move proportionally into the target shell. Electrical points and infrastructure positions remain in their existing rooms. Existing doors/windows and clearances need review; former ensuite attachments are cleared, not silently reassigned.'];
    next.services = rerouteServicePlan(next, plan);
  }
  return next;
}

/** Exact reviewed baseline, permission/lock enforcement and narrow model mutation scope. */
export function acceptServiceProposal(project: Project, baselineSnapshot: Project | string, candidate: Project, role: Role): Project {
  if (role !== 'admin' && role !== 'editor') throw new Error('Only an editor or administrator can accept a services proposal.');
  const baseline = typeof baselineSnapshot === 'string' ? baselineSnapshot : JSON.stringify(baselineSnapshot);
  if (JSON.stringify(project) !== baseline) throw new Error('The project changed after this preview. Review a fresh services proposal.');
  const locks = project.constraints.lockedProperties;
  if (locks.some(lock => lock === '*' || lock === 'services' || lock === 'services.*' || lock === 'model.services' || lock.startsWith('services.') || lock.startsWith('model.services.'))) throw new Error('Services or their assumptions are locked.');
  const { services: _oldServices, elements: _oldElements, ...oldRest } = project, { services: _newServices, elements: _newElements, ...newRest } = candidate;
  if (!same(oldRest, newRest)) throw new Error('A services proposal cannot change project identity, constraints, audit, architectural rates, schedule or other project settings.');
  if (!candidate.services) throw new Error('The reviewed proposal must contain a services plan.');
  if (!same(project.elements, candidate.elements)) {
    const oldBath = project.elements.find(element => element.kind === 'room' && element.properties.use === 'bathroom' && candidate.elements.find(next => next.id === element.id)?.properties.use !== 'bathroom');
    const newBath = project.elements.find(element => element.kind === 'room' && element.properties.use !== 'bathroom' && candidate.elements.find(next => next.id === element.id)?.properties.use === 'bathroom');
    if (!oldBath || !newBath || !same(previewServiceRoomSwap(project, oldBath.id, newBath.id).elements, candidate.elements)) throw new Error('Only the reviewed same-floor bathroom function swap may alter architectural room metadata in a services proposal.');
  }
  const errors = inspectServices(candidate, candidate.services).filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(errors.map(issue => issue.message).join(' '));
  if (!servicePlanIsCurrent(candidate, candidate.services)) throw new Error('Reroute the services against the reviewed architectural model before accepting.');
  for (const [previous, proposed] of [[project.services?.points ?? [], candidate.services.points], [project.services?.routes ?? [], candidate.services.routes]] as const) {
    const oldById = new Map(previous.map(item => [item.id, item])), nextById = new Map(proposed.map(item => [item.id, item]));
    for (const id of new Set([...oldById.keys(), ...nextById.keys()])) if (!same(oldById.get(id), nextById.get(id))) {
      if (project.constraints.lockedElementIds.includes(id) || locks.some(lock => lock === id || lock.startsWith(`${id}.`))) throw new Error(`Services point or route ${id} is locked.`);
    }
  }
  const changedIds = new Set(candidate.services.points.filter(point => !same(point, project.services?.points.find(previous => previous.id === point.id))).map(point => point.roomId).filter((id): id is string => !!id));
  for (const oldPoint of project.services?.points ?? []) if (!candidate.services.points.some(point => point.id === oldPoint.id) && oldPoint.roomId) changedIds.add(oldPoint.roomId);
  if (!same(project.services?.routes, candidate.services.routes)) for (const point of candidate.services.points) if (point.roomId) changedIds.add(point.roomId);
  for (const id of changedIds) {
    const room = project.elements.find(element => element.id === id);
    if (room) assertUnlocked(project, room, ['services', 'services.*']);
  }
  return structuredClone(candidate);
}
