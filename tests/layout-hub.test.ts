import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../src/domain/seed';
import { previewLayout } from '../src/domain/layout';
import type { LayoutPreview } from '../src/domain/layout';
import type { BimElement, LayoutRequest, LayoutRoom, Project } from '../src/domain/types';
import { footprint, localToWorld, worldToLocal } from '../src/model/geometry';

const room = (key: string, use: LayoutRoom['use'], attachedTo: string | null = null): LayoutRoom => ({ key, name: key, use, area: null, attachedTo });
const programme = [1, 2, 3].flatMap(n => [room(`bed-${n}`, 'bedroom'), room(`bath-${n}`, 'bathroom', `bed-${n}`)]).concat([room('kitchen', 'kitchen'), room('library', 'study'), room('pool', 'pool')]);
const request = (rooms = programme, patch: Partial<LayoutRequest> = {}): LayoutRequest => ({ levelId: 'level-0', footprintId: null, width: null, depth: null, rooms: structuredClone(rooms), idPrefix: 'hub', ...patch });
function commit(project: Project, result: LayoutPreview): Project {
    return { ...structuredClone(project), levels: [...project.levels, ...result.levels], elements: [...project.elements.filter(e => !result.removedElements.some(r => r.id === e.id)), ...structuredClone(result.elements)] };
}
function inside(element: BimElement, point: { x: number; y: number }) {
    const p = worldToLocal(element, point);
    return p.x > .000001 && p.y > .000001 && p.x < element.width - .000001 && p.y < element.depth - .000001;
}
function bounds(element: BimElement, frame: LayoutPreview['footprint']) {
    const points = footprint(element).map(p => worldToLocal(frame, p));
    return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x)), back: Math.max(...points.map(p => p.y)) };
}
function overlap(a: ReturnType<typeof bounds>, b: ReturnType<typeof bounds>) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.back, b.back) - Math.max(a.y, b.y));
}
function checkPhysicalAccess(result: LayoutPreview) {
    const visited = new Set(['outside']);
    for (let n = 0; n < result.elements.length; n++) for (const link of result.connections) {
        if (visited.has(link.from)) visited.add(link.to);
        if (visited.has(link.to)) visited.add(link.from);
    }
    expect(result.rooms.every(r => visited.has(r.key))).toBe(true);
    for (const door of result.elements.filter(e => e.kind === 'door')) {
        const wall = result.elements.find(e => e.id === door.hostId)!, center = worldToLocal(wall, door).x + door.width / 2;
        const sides = [localToWorld(wall, center, -.03), localToWorld(wall, center, wall.depth + .03)];
        for (const key of [door.properties.accessFrom, door.properties.accessTo]) {
            if (key === 'outside') continue;
            const space = result.elements.find(e => e.kind === 'room' && e.levelId === door.levelId && e.properties.layoutKey === key)!;
            expect(space, `missing ${String(key)}`).toBeDefined();
            expect(sides.some(p => inside(space, p)), `${door.name} does not physically meet ${space.name}`).toBe(true);
        }
    }
    const solids = result.elements.filter(e => e.kind === 'room' || e.kind === 'wall');
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) if (solids[i].levelId === solids[j].levelId)
        expect(overlap(bounds(solids[i], result.footprint), bounds(solids[j], result.footprint)), `${solids[i].name}/${solids[j].name}`).toBeLessThan(1e-7);
}

describe('compact residential hub and honest gallery fallback', () => {
    it('prefers a real multi-sided foyer for the exact nine-room programme, with short perpendicular access', () => {
        const project = createBlankProject('Nine rooms'), before = structuredClone(project), result = previewLayout(project, request());
        expect(result.issues).toEqual([]);
        expect(result.strategy).toBe('compact-hub');
        expect(result.rooms.map(r => r.key).sort()).toEqual(programme.map(r => r.key).sort());
        expect(result.rooms.some(r => r.use === 'living')).toBe(false);
        const hub = result.elements.find(e => e.id === result.circulation!.elementId)!;
        expect(hub.properties.use).toBe('circulation');
        expect(hub.width).toBeLessThanOrEqual(4.6);
        expect(hub.depth).toBeLessThanOrEqual(3.2);
        expect(hub.width).toBeLessThan(result.footprint.width * .5);
        expect(result.metrics!.longestAccessBranch).toBeLessThan(5);
        expect(result.metrics!.circulationRatio).toBeLessThan(.17);
        expect(result.metrics!.hubArea).toBeCloseTo(hub.width * hub.depth, 2);
        const sides = new Set<string>();
        for (const door of result.elements.filter(e => e.kind === 'door' && e.properties.accessFrom === 'circulation')) {
            const center = localToWorld(door, door.width / 2, door.depth / 2), p = worldToLocal(hub, center);
            if (Math.abs(p.x) < .21) sides.add('left');
            if (Math.abs(p.x - hub.width) < .21) sides.add('right');
            if (Math.abs(p.y) < .21) sides.add('front');
            if (Math.abs(p.y - hub.depth) < .21) sides.add('rear');
        }
        expect(sides.size).toBeGreaterThanOrEqual(3);
        for (const resultRoom of result.rooms) {
            if (resultRoom.attachedTo) expect(resultRoom.accessFrom).toBe(resultRoom.attachedTo);
            if (!['bathroom', 'utility', 'garage'].includes(resultRoom.use)) expect(resultRoom.daylight).toBe('exterior-window');
        }
        checkPhysicalAccess(result);
        expect(project).toEqual(before);
        expect(previewLayout(project, request())).toEqual(result);
    });

    it('uses the requested living room as the public hub with physical living/dining/kitchen links', () => {
        const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('bed', 'bedroom'), room('bath', 'bathroom', 'bed'), room('pool', 'pool')];
        const result = previewLayout(createBlankProject('Social house'), request(rooms));
        expect(result.issues).toEqual([]);
        expect(result.strategy).toBe('compact-hub');
        expect(result.rooms.find(r => r.key === 'living')!.accessFrom).toBe('outside');
        expect(result.rooms.find(r => r.key === 'dining')!.accessFrom).toBe('living');
        expect(result.rooms.find(r => r.key === 'kitchen')!.accessFrom).toBe('dining');
        expect(result.rooms.find(r => r.key === 'pool')!.accessFrom).toBe('living');
        expect(result.elements.find(e => e.id === result.circulation!.elementId)!.properties.layoutKey).toBe('living');
        for (const link of result.connections) if (link.from === 'bed' || link.from === 'pool') expect(link.to).toBe('bath');
        checkPhysicalAccess(result);
    });

    it('keeps a two-storey four-bedroom hub coordinated with physical landings and an actual upper void', () => {
        const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('pool', 'pool'), ...[1, 2, 3, 4].flatMap(n => [room(`b${n}`, 'bedroom'), room(`a${n}`, 'bathroom', `b${n}`)])];
        const result = previewLayout(createBlankProject('Four bedroom house'), request(rooms, { storeys: 2, floorHeight: 3.6 }));
        expect(result.issues).toEqual([]);
        expect(result.strategy).toBe('compact-hub');
        expect(result.rooms).toHaveLength(12);
        const stair = result.elements.find(e => e.kind === 'stair')!, lower = result.elements.find(e => e.id === stair.properties.lowerLandingId)!, upper = result.elements.find(e => e.id === stair.properties.upperLandingId)!;
        expect(inside(lower, localToWorld(stair, stair.width / 2, -.03))).toBe(true);
        expect(inside(upper, localToWorld(stair, stair.width / 2, stair.depth + .03))).toBe(true);
        expect(stair.z + stair.height).toBeCloseTo(upper.z);
        for (const e of result.elements.filter(e => e.levelId === upper.levelId && ['room', 'slab'].includes(e.kind))) expect(overlap(bounds(e, result.footprint), bounds(stair, result.footprint))).toBeLessThan(1e-7);
        for (const e of result.elements.filter(e => e.kind === 'wall' && e.levelId === stair.levelId)) expect(overlap(bounds(e, result.footprint), bounds(stair, result.footprint))).toBeLessThan(1e-7);
        expect(result.rooms.filter(r => r.use === 'bedroom').every(r => r.levelId === upper.levelId && r.daylight === 'exterior-window')).toBe(true);
        checkPhysicalAccess(result);
    });

    it('labels a fixed rotated footprint fallback and preserves physical arrival for explicit upper living', () => {
        const p = createBlankProject('Fixed'), type = p.types.find(t => t.kind === 'slab')!;
        p.elements = [{ id: 'retained', kind: 'slab', name: 'Original slab', levelId: 'level-0', typeId: type.id, material: type.material, x: 23, y: -7, z: -.2, width: 10.4, depth: 14, height: .2, rotation: 27, editable: true, properties: {} }];
        const before = structuredClone(p), fixed = previewLayout(p, request(programme, { footprintId: 'retained' }));
        expect(fixed.issues).toEqual([]);
        expect(fixed.strategy).toBe('zoned-gallery');
        expect(fixed.footprint).toMatchObject({ x: 23, y: -7, width: 10.4, depth: 14, rotation: 27 });
        expect(fixed.assumptions.join(' ')).toMatch(/full-width distribution gallery remains/);
        expect(fixed.metrics!.hubArea).toBe(0);
        expect(p).toEqual(before);
        const rooms = [{ ...room('upper-living', 'living'), floor: 1 as const }, room('kitchen', 'kitchen'), room('b', 'bedroom')], upper = previewLayout(createBlankProject('Upper living'), request(rooms, { storeys: 2 }));
        expect(upper.issues).toEqual([]);
        expect(upper.strategy).toBe('zoned-gallery');
        const stair = upper.elements.find(e => e.kind === 'stair')!, landing = upper.elements.find(e => e.id === stair.properties.upperLandingId)!;
        expect(inside(landing, localToWorld(stair, stair.width / 2, stair.depth + .03))).toBe(true);
        checkPhysicalAccess(upper);
    });

    it('replaces the complete prior footprint after a selected replan while retaining far copied provenance', () => {
        const initial = previewLayout(createBlankProject('Chained'), request(programme, { width: 14, depth: 18 })), p = commit(createBlankProject('Chained'), initial), slab = p.elements.find(e => e.kind === 'slab')!;
        expect(initial.issues).toEqual([]);
        const selected = previewLayout(p, request(programme, { idPrefix: 'second', footprintId: slab.id, replaceConcept: true }));
        expect(selected.issues).toEqual([]);
        const second = commit(p, selected), wall = second.elements.find(e => e.kind === 'wall')!, far = { ...structuredClone(wall), id: 'far-copy', x: wall.x + 500 };
        second.elements.push(far);
        const shrink = previewLayout(second, request([room('study', 'study')], { idPrefix: 'third', replaceConcept: true }));
        expect(shrink.issues).toEqual([]);
        expect(shrink.removedElements.map(e => e.id).sort()).toEqual(second.elements.filter(e => e.id !== far.id).map(e => e.id).sort());
        expect(shrink.removedElements.some(e => e.id === 'far-copy')).toBe(false);
        const crossing = structuredClone(second);
        crossing.elements.find(e => e.id === wall.id)!.x = slab.x - .1;
        expect(previewLayout(crossing, request([room('study', 'study')], { idPrefix: 'blocked', replaceConcept: true })).issues.join(' ')).toMatch(/crosses the original footprint/);
    });

    it('blocks real retained foreign-level volume conflicts while allowing touches and spatial separation', () => {
        const make = (x: number, z: number, kind: BimElement['kind'] = 'slab') => {
            const p = createBlankProject('Mezzanine');
            p.levels.push({ id: 'mezzanine', name: 'Manual mezzanine', elevation: z });
            const type = p.types.find(t => t.kind === (kind === 'room' ? 'room' : 'slab'))!;
            p.elements.push({ id: 'manual', kind, name: 'Manual mezzanine', levelId: 'mezzanine', typeId: type.id, material: type.material, x, y: 0, z, width: 4, depth: 4, height: .2, rotation: 15, editable: true, properties: {} });
            return p;
        };
        const rooms = [room('living', 'living'), room('kitchen', 'kitchen'), room('bed', 'bedroom')];
        expect(previewLayout(make(0, 1.5), request(rooms, { storeys: 2 })).issues.join(' ')).toMatch(/another level physically intersects/);
        expect(previewLayout(make(500, 1.5), request(rooms, { storeys: 2 })).issues).toEqual([]);
        expect(previewLayout(make(0, 20), request(rooms, { storeys: 2 })).issues).toEqual([]);
        expect(previewLayout(make(0, -.4), request(rooms, { storeys: 2 })).issues).toEqual([]);
        expect(previewLayout(make(0, 1.5, 'room'), request(rooms, { storeys: 2 })).issues).toEqual([]);
    });
});
