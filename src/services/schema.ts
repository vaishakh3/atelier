import { z } from 'zod';
import type { Project } from '../domain/types';
import type { ServiceIssue, ServicePlan } from './types';

z.config({ jitless: true });
const id = z.string().min(1).max(160).refine(value => value.trim() === value && !!value.trim(), 'IDs cannot contain leading/trailing whitespace.');
const text = z.string().max(3000);
const finite = z.number().finite();
const vector = z.object({ x: finite.min(-1e7).max(1e7), y: finite.min(-1e7).max(1e7), z: finite.min(-1e5).max(1e5) }).strict();
const electrical = new Set(['light', 'switch', 'socket', 'equipment', 'panel']);
const fixtures = new Set(['basin', 'wc', 'shower', 'sink']);
export const servicePointSchema = z.object({
  id, name: z.string().min(1).max(3000), kind: z.enum(['light', 'switch', 'socket', 'equipment', 'panel', 'water-inlet', 'drain-outlet', 'basin', 'wc', 'shower', 'sink']),
  levelId: id, roomId: id.optional(), offset: vector, loadWatts: finite.min(0).max(1e7).nullable(), circuitId: id.optional(),
}).strict();
export const serviceAssumptionsSchema = z.object({
  currency: z.enum(['INR', 'USD', 'EUR']), rateSource: text, rateDate: z.string().max(100),
  rates: z.array(z.object({ key: id, name: text, unit: z.enum(['ea', 'm']), material: finite.min(0).max(1e9).nullable(), labour: finite.min(0).max(1e9).nullable(), productivity: finite.positive().max(1e6).nullable() }).strict()).max(100),
  wastePercent: finite.min(0).max(100), voltage: finite.min(1).max(1000), powerFactor: finite.positive().max(1), demandFactor: finite.min(0).max(1),
  drainageGradient: finite.min(1).max(1000), workHoursPerDay: finite.positive().max(24), crews: z.number().int().min(1).max(1000),
}).strict().superRefine((value, context) => {
  if (new Set(value.rates.map(rate => rate.key)).size !== value.rates.length) context.addIssue({ code: 'custom', message: 'Duplicate services rate key.' });
});
export const servicePlanSchema = z.object({
  schemaVersion: z.literal(1), status: z.literal('concept'), modelSignature: z.string().min(1).max(2000000),
  points: z.array(servicePointSchema).min(1).max(2000),
  routes: z.array(z.object({ id, system: z.enum(['electrical', 'cold-water', 'drainage']), fromId: id, toId: id, points: z.array(vector).min(2).max(20), circuitId: id.optional() }).strict()).max(6000),
  assumptions: serviceAssumptionsSchema, notes: z.array(text).max(100),
}).strict().superRefine((plan, context) => {
  const points = new Map(plan.points.map(point => [point.id, point]));
  if (points.size !== plan.points.length) context.addIssue({ code: 'custom', message: 'Duplicate services point ID.' });
  if (new Set(plan.routes.map(route => route.id)).size !== plan.routes.length) context.addIssue({ code: 'custom', message: 'Duplicate services route ID.' });
  if (plan.routes.some(route => points.has(route.id))) context.addIssue({ code: 'custom', message: 'Point and route IDs must be globally unique.' });
  const connections = new Set<string>();
  for (const route of plan.routes) {
    const from = points.get(route.fromId), to = points.get(route.toId);
    if (!from || !to || from.id === to.id) { context.addIssue({ code: 'custom', message: 'A services route must connect two existing distinct point IDs.' }); continue; }
    const connection = `${route.system}:${route.fromId}:${route.toId}`;
    if (connections.has(connection)) context.addIssue({ code: 'custom', message: 'Duplicate services connection.' });
    connections.add(connection);
    if (route.system === 'electrical' && (!electrical.has(from.kind) || !electrical.has(to.kind) || from.kind !== 'panel' || to.kind === 'panel' || !route.circuitId || to.circuitId !== route.circuitId)) context.addIssue({ code: 'custom', message: 'Concept electrical branches must run from a panel to a point in the named circuit.' });
    if (route.system === 'cold-water' && (from.kind !== 'water-inlet' || !fixtures.has(to.kind) || route.circuitId)) context.addIssue({ code: 'custom', message: 'Cold-water branches must connect the inlet to a plumbing fixture.' });
    if (route.system === 'drainage' && (!fixtures.has(from.kind) || to.kind !== 'drain-outlet' || route.circuitId)) context.addIssue({ code: 'custom', message: 'Drainage branches must connect a plumbing fixture to the outlet.' });
    if (route.points.every(point => point.x === route.points[0].x && point.y === route.points[0].y && point.z === route.points[0].z)) context.addIssue({ code: 'custom', message: 'A services route must have positive length.' });
  }
  for (const point of plan.points) {
    if (electrical.has(point.kind) && point.kind !== 'panel' && !plan.routes.some(route => route.system === 'electrical' && route.toId === point.id)) context.addIssue({ code: 'custom', message: `Electrical point ${point.id} is disconnected.` });
    if (fixtures.has(point.kind)) for (const system of ['cold-water', 'drainage'] as const) if (!plan.routes.some(route => route.system === system && (route.fromId === point.id || route.toId === point.id))) context.addIssue({ code: 'custom', message: `Plumbing fixture ${point.id} lacks its ${system} connection.` });
  }
});

/** Project references can become stale after model edits; preserve the plan for repair. */
export function inspectServiceReferences(project: Project, plan: ServicePlan): ServiceIssue[] {
  const issues: ServiceIssue[] = [];
  for (const point of plan.points) {
    if (!project.levels.some(level => level.id === point.levelId)) issues.push({ id: `missing-level-${point.id}`, severity: 'error', message: `${point.name}: its building level no longer exists.`, sourceIds: [point.id, point.levelId] });
    if (point.roomId) {
      const room = project.elements.find(element => element.id === point.roomId && element.kind === 'room');
      if (!room) issues.push({ id: `missing-room-${point.id}`, severity: 'error', message: `${point.name}: its room host no longer exists; reassign the point before rerouting.`, sourceIds: [point.id, point.roomId] });
      else if (room.levelId !== point.levelId) issues.push({ id: `room-level-${point.id}`, severity: 'error', message: `${point.name}: point and host must share a building level.`, sourceIds: [point.id, room.id] });
      else if (point.offset.x < 0 || point.offset.y < 0 || point.offset.x > room.width || point.offset.y > room.depth) issues.push({ id: `room-bounds-${point.id}`, severity: 'error', message: `${point.name}: its local point position is outside the room shell.`, sourceIds: [point.id, room.id] });
    }
  }
  return issues;
}
