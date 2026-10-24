import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../src/domain/seed';
import { projectSchema } from '../src/domain/schema';
import type { BimElement, Project } from '../src/domain/types';
import { acceptServiceProposal, createServicePlan, inspectServices, pointPosition, previewServiceRoomSwap, rerouteServicePlan, serviceModelSignature, servicePlanIsCurrent } from '../src/services/model';
import { servicePlanSchema } from '../src/services/schema';

function fixture(): Project {
  const project = createBlankProject('Services coordination');
  project.levels.push({ id: 'level-1', name: 'Upper floor', elevation: 3.2 });
  const room = (id: string, use: string, levelId: string, x: number, y: number, width = 4, depth = 3): BimElement => ({ id, name: id, kind: 'room', levelId, typeId: 'room-default', material: 'Not applicable', x, y, z: levelId === 'level-1' ? 3.2 : 0, width, depth, height: .02, rotation: 0, editable: true, properties: { use, layoutKey: id } });
  project.elements = [room('kitchen', 'kitchen', 'level-0', 0, 0), room('living', 'living', 'level-0', 4, 0), room('bathroom', 'bathroom', 'level-1', 8, 0, 2, 3), room('study', 'study', 'level-1', 0, 0, 4, 4)];
  return project;
}
const lengths = (project: Project) => project.services!.routes.reduce((total, route) => total + route.points.slice(1).reduce((n, point, index) => n + Math.hypot(point.x - route.points[index].x, point.y - route.points[index].y, point.z - route.points[index].z), 0), 0);

describe('concept services model and architectural coordination', () => {
  it('produces connected deterministic services on two floors without changing the source', () => {
    const project = fixture(), before = structuredClone(project), plan = createServicePlan(project);
    expect(project).toEqual(before);
    expect(createServicePlan(project)).toEqual(plan);
    expect(servicePlanSchema.safeParse(plan).success).toBe(true);
    expect(projectSchema.safeParse({ ...project, services: plan }).success).toBe(true);
    expect(plan.points.filter(point => point.kind === 'basin' || point.kind === 'wc' || point.kind === 'shower')).toHaveLength(3);
    expect(plan.points.filter(point => point.kind === 'sink')).toHaveLength(1);
    for (const route of plan.routes) {
      const start = pointPosition(project, plan.points.find(point => point.id === route.fromId)!);
      const end = pointPosition(project, plan.points.find(point => point.id === route.toId)!);
      expect(route.points[0]).toEqual(start); expect(route.points.at(-1)).toEqual(end);
    }
    expect(inspectServices(project, plan).filter(issue => issue.severity === 'error')).toEqual([]);
    expect(plan.assumptions.rates.every(rate => rate.material === null && rate.labour === null && rate.productivity === null)).toBe(true);
  });

  it('resolves a rotated local host and level datum without accidentally adding room.z twice', () => {
    const project = fixture(), room = project.elements.find(room => room.id === 'bathroom')!;
    room.x = 10; room.y = 20; room.rotation = 90; room.z = 3.4;
    const plan = createServicePlan(project), point = plan.points.find(point => point.roomId === room.id && point.kind === 'basin')!;
    expect(pointPosition(project, point)).toEqual({ x: 9.7, y: 20.5, z: 4 });
    const unhosted = { ...point, roomId: undefined, offset: { x: 10, y: 20, z: .8 } };
    expect(pointPosition(project, unhosted)).toEqual({ x: 10, y: 20, z: 4 });
    expect(inspectServices(project, plan).some(issue => issue.id === 'services-stale')).toBe(false);
  });

  it('retains edited offsets, assigned load and quotations when rerouting changed architecture', () => {
    const project = fixture(), plan = createServicePlan(project), point = plan.points.find(point => point.kind === 'socket')!;
    point.offset.x = 1.3; point.offset.y = .7; point.loadWatts = 850;
    plan.assumptions.rateSource = 'Installer quotation'; plan.assumptions.rates[0].material = 1234;
    project.elements.find(room => room.id === point.roomId)!.x += 2;
    expect(servicePlanIsCurrent(project, plan)).toBe(false);
    const before = structuredClone(plan), result = rerouteServicePlan(project, plan);
    expect(plan).toEqual(before);
    expect(result.points).toEqual(plan.points); expect(result.assumptions).toEqual(plan.assumptions);
    expect(servicePlanIsCurrent(project, result)).toBe(true);
    expect(inspectServices(project, result).filter(issue => issue.severity === 'error')).toEqual([]);
  });

  it('previews a bathroom function swap with shorter routes and exact shell/door retention', () => {
    const project = fixture();
    project.elements.find(room => room.id === 'bathroom')!.properties.attachedTo = 'study';
    project.elements.push({ ...project.elements[0], id: 'door', name: 'Door', kind: 'door', width: .8, depth: .2, height: 2.1, properties: { accessFrom: 'study', accessTo: 'bathroom' } });
    project.services = createServicePlan(project);
    const before = structuredClone(project), electrical = project.services.points.filter(point => ['light', 'switch', 'socket', 'panel'].includes(point.kind));
    const next = previewServiceRoomSwap(project, 'bathroom', 'study');
    expect(project).toEqual(before);
    expect(next.elements.find(room => room.id === 'study')!.properties.use).toBe('bathroom');
    expect(next.elements.find(room => room.id === 'bathroom')!.properties.use).toBe('study');
    const shell = (e: BimElement) => [e.id, e.x, e.y, e.z, e.rotation, e.width, e.depth, e.height, e.hostId];
    expect(next.elements.map(shell)).toEqual(project.elements.map(shell));
    expect(next.elements.find(room => room.id === 'bathroom')!.properties.attachedTo).toBeUndefined();
    expect(next.elements.find(room => room.id === 'door')!.properties).toEqual({ accessFrom: 'study', accessTo: 'bathroom', servicesAccessReview: true });
    expect(next.services!.points.filter(point => ['light', 'switch', 'socket', 'panel'].includes(point.kind))).toEqual(electrical);
    expect(next.services!.points.filter(point => ['wc', 'basin', 'shower'].includes(point.kind)).every(point => point.roomId === 'study')).toBe(true);
    expect(lengths(next)).toBeLessThan(lengths(project));
    const beforeStack = inspectServices(project, project.services).find(issue => issue.id === 'wet-stack-bathroom')!;
    const afterStack = inspectServices(next, next.services!).find(issue => issue.id === 'wet-stack-study')!;
    expect(beforeStack.message).toContain('7.00 m'); expect(afterStack.message).toContain('0.50 m');
    expect(inspectServices(next, next.services!).some(issue => issue.id === 'swapped-room-access')).toBe(true);
    expect(servicePlanIsCurrent(next, next.services!)).toBe(true);
  });

  it('excludes specialist pool systems and reports unknown space coverage without guessing room uses', () => {
    const project = fixture();
    project.elements.push({ ...project.elements[0], id: 'pool', name: 'Pool', properties: { use: 'pool' } });
    project.elements.push({ ...project.elements[0], id: 'unknown', name: 'Bathroom by name alone', properties: {} });
    const plan = createServicePlan(project);
    expect(plan.points.some(point => point.roomId === 'pool' || point.roomId === 'unknown')).toBe(false);
    expect(plan.notes.join(' ')).toContain('Pool pumps'); expect(plan.notes.join(' ')).toContain('Unclassified room');
    expect(() => createServicePlan(createBlankProject('Empty'))).toThrow(/explicit room uses/);
    project.elements = project.elements.filter(element => element.id === 'unknown');
    expect(() => createServicePlan(project)).toThrow(/explicit room uses/);
  });

  it('preserves orphaned plans as stale project data but refuses silently rerouting missing hosts', () => {
    const project = fixture(), plan = createServicePlan(project);
    project.elements = project.elements.filter(room => room.id !== 'bathroom');
    expect(projectSchema.safeParse({ ...project, services: plan }).success).toBe(true);
    expect(inspectServices(project, plan).some(issue => issue.id.startsWith('missing-room-') && issue.severity === 'error')).toBe(true);
    expect(() => rerouteServicePlan(project, plan)).toThrow(/host no longer exists/);
  });

  it('reports real wall-volume intersections and unsupported geometry without a compliance pass', () => {
    const project = fixture();
    project.elements.push({ ...project.elements[0], id: 'partition', kind: 'wall', x: 3, y: 0, width: .2, depth: 4, height: 3, properties: {} });
    const issues = inspectServices(project, createServicePlan(project));
    expect(issues.some(issue => issue.id === 'penetrations-electrical' && issue.sourceIds.includes('partition'))).toBe(true);
    expect(issues.some(issue => issue.message.includes('statutory compliance'))).toBe(true);
    project.elements[0].properties.nonRectangular = true;
    expect(() => createServicePlan(project)).toThrow(/nonrectangular/);
  });
});

describe('services schema and reviewed transaction boundaries', () => {
  it('rejects malformed/non-finite/duplicate/disconnected/cross-system route data', () => {
    const plan = createServicePlan(fixture());
    const malformed = [
      { ...plan, status: 'certified' },
      { ...plan, points: [...plan.points, plan.points[0]] },
      { ...plan, routes: [...plan.routes, plan.routes[0]] },
      { ...plan, routes: plan.routes.map((route, i) => i === 0 ? { ...route, id: plan.points[0].id } : route) },
      { ...plan, routes: plan.routes.map((route, i) => i === 0 ? { ...route, toId: 'missing' } : route) },
      { ...plan, routes: plan.routes.map((route, i) => i === 0 ? { ...route, system: 'cold-water' } : route) },
      { ...plan, routes: plan.routes.slice(1) },
      { ...plan, points: plan.points.map((point, i) => i === 0 ? { ...point, offset: { ...point.offset, x: Infinity } } : point) },
      { ...plan, assumptions: { ...plan.assumptions, demandFactor: 1.1 } },
      { ...plan, assumptions: { ...plan.assumptions, crews: 0 } },
    ];
    for (const value of malformed) expect(servicePlanSchema.safeParse(value).success).toBe(false);
  });

  it('accepts detached review snapshots only with current exact baseline and editor authority', () => {
    const project = fixture(), before = structuredClone(project), candidate = { ...structuredClone(project), services: createServicePlan(project) };
    const accepted = acceptServiceProposal(project, before, candidate, 'editor');
    expect(accepted).toEqual(candidate); expect(accepted).not.toBe(candidate); expect(project).toEqual(before);
    expect(() => acceptServiceProposal(project, before, candidate, 'reviewer')).toThrow(/Only an editor/);
    expect(() => acceptServiceProposal(project, before, candidate, 'contributor')).toThrow(/Only an editor/);
    const concurrent = structuredClone(project); concurrent.name = 'Concurrent edit';
    expect(() => acceptServiceProposal(concurrent, before, candidate, 'admin')).toThrow(/changed after/);
    expect(() => acceptServiceProposal(project, before, { ...candidate, constraints: { ...candidate.constraints, budget: 0 } }, 'admin')).toThrow(/cannot change/);
  });

  it('enforces service, room, nested metadata and source access door locks', () => {
    for (const lock of ['services', '*', 'services.assumptions', 'model.services.points']) {
      const project = fixture(); project.constraints.lockedProperties.push(lock);
      expect(() => acceptServiceProposal(project, structuredClone(project), { ...project, services: createServicePlan(project) }, 'admin')).toThrow(/locked/);
    }
    for (const lock of ['use', 'properties.use', 'elements.bathroom.properties', 'model.elements.*.name', 'bathroom.properties.requestedArea']) {
      const project = fixture(); project.constraints.lockedProperties.push(lock);
      expect(() => previewServiceRoomSwap(project, 'bathroom', 'study')).toThrow(/locked/);
    }
    const project = fixture(); project.constraints.lockedElementIds.push('study');
    expect(() => previewServiceRoomSwap(project, 'bathroom', 'study')).toThrow(/locked/);
    const candidate = { ...structuredClone(project), services: createServicePlan(project) };
    expect(() => acceptServiceProposal(project, structuredClone(project), candidate, 'admin')).toThrow(/locked/);
    project.constraints.lockedElementIds = []; project.elements.find(room => room.id === 'study')!.editable = false;
    expect(() => previewServiceRoomSwap(project, 'bathroom', 'study')).toThrow(/not editable/);
    const pointLocked = fixture(); pointLocked.services = createServicePlan(pointLocked);
    const socket = pointLocked.services.points.find(point => point.kind === 'socket')!;
    pointLocked.constraints.lockedElementIds.push(socket.id);
    const pointChanged = structuredClone(pointLocked); pointChanged.services!.points.find(point => point.id === socket.id)!.loadWatts = 500;
    expect(() => acceptServiceProposal(pointLocked, structuredClone(pointLocked), pointChanged, 'admin')).toThrow(/is locked/);
  });

  it('rejects cross-floor, unsupported and stale model swaps and candidate geometry tampering', () => {
    const project = fixture(); project.services = createServicePlan(project);
    expect(() => previewServiceRoomSwap(project, 'bathroom', 'living')).toThrow(/same floor/);
    expect(() => previewServiceRoomSwap(project, 'bathroom', 'kitchen')).toThrow(/Kitchen/);
    const valid = previewServiceRoomSwap(project, 'bathroom', 'study');
    expect(acceptServiceProposal(project, structuredClone(project), valid, 'admin')).toEqual(valid);
    const tampered = structuredClone(valid); tampered.elements[0].x += 1;
    expect(() => acceptServiceProposal(project, structuredClone(project), tampered, 'admin')).toThrow(/Only the reviewed/);
    project.elements[0].width += 1;
    expect(() => previewServiceRoomSwap(project, 'bathroom', 'study')).toThrow(/Reroute the existing/);
  });

  it('detects changed geometry even without a version change, and catches malformed endpoint positions', () => {
    const project = fixture(), plan = createServicePlan(project), before = serviceModelSignature(project);
    project.elements[0].rotation += .01;
    expect(serviceModelSignature(project)).not.toBe(before); expect(servicePlanIsCurrent(project, plan)).toBe(false);
    const detached = structuredClone(plan); detached.modelSignature = serviceModelSignature(project); detached.routes[0].points[0].x += 1;
    expect(inspectServices(project, detached).some(issue => issue.id.startsWith('route-endpoints-') && issue.severity === 'error')).toBe(true);
    expect(() => acceptServiceProposal(project, structuredClone(project), { ...project, services: detached }, 'admin')).toThrow(/no longer meets/);
  });

  it('never trusts a matching stamp when imported point hosts, endpoints or connections are invalid', () => {
    const project = fixture(), plan = createServicePlan(project);
    const offsetEdit = structuredClone(plan); offsetEdit.points.find(point => point.kind === 'socket')!.offset.x -= .1;
    expect(offsetEdit.modelSignature).toBe(serviceModelSignature(project)); expect(servicePlanIsCurrent(project, offsetEdit)).toBe(false);
    const missingHost = structuredClone(plan); missingHost.points[0].roomId = 'missing-host';
    expect(servicePlanIsCurrent(project, missingHost)).toBe(false);
    const missingRoute = structuredClone(plan); missingRoute.routes.shift();
    expect(servicePlanIsCurrent(project, missingRoute)).toBe(false);
    expect(servicePlanIsCurrent(project, plan)).toBe(true);
  });
});
