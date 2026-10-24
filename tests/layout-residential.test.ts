import { describe, it, expect } from 'vitest';
import { createBlankProject } from '../src/domain/seed';
import { previewLayout } from '../src/domain/layout';
import type { LayoutPreview } from '../src/domain/layout';
import type { BimElement, LayoutRequest, LayoutRoom, Project } from '../src/domain/types';
import { footprint, localToWorld, worldToLocal, validateModelGeometry } from '../src/model/geometry';
const room = (key: string, use: LayoutRoom['use'], attachedTo: string | null = null, floor?: 0 | 1): LayoutRoom => ({ key, name: key, use, area: null, attachedTo, ...(floor === undefined ? {} : { floor }) });
const programme = [room('bed1', 'bedroom'), room('bath1', 'bathroom', 'bed1'), room('bed2', 'bedroom'), room('bath2', 'bathroom', 'bed2'), room('bed3', 'bedroom'), room('bath3', 'bathroom', 'bed3'), room('kitchen', 'kitchen'), room('library', 'study'), room('pool', 'pool')];
const spec = (rooms = programme, patch: Partial<LayoutRequest> = {}): LayoutRequest => ({ levelId: 'level-0', footprintId: null, width: null, depth: null, rooms: structuredClone(rooms), idPrefix: 'residential', ...patch });
function inside(e: BimElement, p: {
    x: number;
    y: number;
}, strict = true) { const q = worldToLocal(e, p), tol = strict ? -.00001 : .00001; return q.x >= -tol && q.y >= -tol && q.x <= e.width + tol && q.y <= e.depth + tol; }
function box(e: BimElement, frame: LayoutPreview['footprint']) { const points = footprint(e).map(p => worldToLocal(frame, p)); return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), right: Math.max(...points.map(p => p.x)), top: Math.max(...points.map(p => p.y)) }; }
function overlap(a: ReturnType<typeof box>, b: ReturnType<typeof box>) { return Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.top, b.top) - Math.max(a.y, b.y)); }
function commit(project: Project, preview: LayoutPreview): Project { return { ...structuredClone(project), levels: [...project.levels, ...preview.levels], elements: [...project.elements.filter(e => !preview.removedElements.some(r => r.id === e.id)), ...structuredClone(preview.elements)] }; }
function slabProject() { const p = createBlankProject('Retained footprint'); p.elements = [{ id: 'base-slab', kind: 'slab', name: 'Manual surveyed slab', levelId: 'level-0', typeId: 'slab-concrete', material: 'Reinforced concrete', x: 24, y: -7, z: -.2, width: 10.4, depth: 14, height: .2, rotation: 27, editable: true, properties: {} }]; return p; }
function checkDoors(preview: LayoutPreview) {
    for (const door of preview.elements.filter(e => e.kind === 'door')) {
        const host = preview.elements.find(e => e.id === door.hostId)!;
        expect(host.kind).toBe('wall');
        const offset = worldToLocal(host, door).x + door.width / 2, points = [localToWorld(host, offset, -.03), localToWorld(host, offset, host.depth + .03)];
        for (const key of [door.properties.accessFrom, door.properties.accessTo]) {
            if (key === 'outside') {
                expect(points.some(p => { const q = worldToLocal(preview.footprint, p); return q.x < 0 || q.y < 0 || q.x > preview.footprint.width || q.y > preview.footprint.depth; })).toBe(true);
                continue;
            }
            const space = preview.elements.find(e => e.kind === 'room' && e.levelId === door.levelId && e.properties.layoutKey === key);
            expect(space, `missing access space ${String(key)}`).toBeDefined();
            expect(points.some(p => inside(space!, p)), `${door.name} must physically adjoin ${String(key)}`).toBe(true);
        }
    }
}
function checkSolids(preview: LayoutPreview) {
    const solids = preview.elements.filter(e => e.kind === 'room' || e.kind === 'wall');
    for (let i = 0; i < solids.length; i++)
        for (let j = i + 1; j < solids.length; j++)
            if (solids[i].levelId === solids[j].levelId)
                expect(overlap(box(solids[i], preview.footprint), box(solids[j], preview.footprint)), `${solids[i].name} / ${solids[j].name}`).toBeLessThan(1e-7);
}
describe('residential zoning, real access and coordinated storeys', () => {
    it('fits the released10.4×14m exact9-room programme with coherent rotated zoning and compact circulation', () => {
        const project = slabProject(), before = structuredClone(project), preview = previewLayout(project, spec(programme, { footprintId: 'base-slab', width: 10.4, depth: 14 }));
        expect(preview.issues).toEqual([]);
        expect(preview.footprint).toMatchObject({ x: 24, y: -7, width: 10.4, depth: 14, rotation: 27 });
        expect(preview.rooms.map(r => r.key).sort()).toEqual(programme.map(r => r.key).sort());
        expect(preview.strategy).toBe('zoned-gallery');
        expect(preview.assumptions.join(' ')).toMatch(/full-width distribution gallery remains/);
        expect(preview.metrics!.circulationRatio).toBeLessThan(.2);
        expect(preview.rooms.some(r => r.use === 'living')).toBe(false);
        expect(preview.elements.some(e => e.id === 'base-slab')).toBe(false);
        checkDoors(preview);
        checkSolids(preview);
        expect(project).toEqual(before);
    });
    it('places living–dining–kitchen in adjacent public spaces rather than routing bedrooms through them', () => {
        const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('bed', 'bedroom'), room('ensuite', 'bathroom', 'bed'), room('pool', 'pool')], p = createBlankProject('Social house'), preview = previewLayout(p, spec(rooms));
        expect(preview.issues).toEqual([]);
        expect(preview.rooms.find(r => r.key === 'dining')!.accessFrom).toBe('living');
        expect(preview.rooms.find(r => r.key === 'kitchen')!.accessFrom).toBe('dining');
        expect(preview.rooms.find(r => r.key === 'pool')!.accessFrom).toBe('living');
        for (const door of preview.elements.filter(e => e.kind === 'door'))
            if (door.properties.accessFrom === 'bed')
                expect(door.properties.accessTo).toBe('ensuite');
        checkDoors(preview);
        checkSolids(preview);
    });
    it('uses real exterior faces and scaled glazing, including dual-aspect living and explicit interior-bath warnings', () => {
        const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('bed1', 'bedroom'), room('bath1', 'bathroom', 'bed1'), room('bed2', 'bedroom'), room('bath2', 'bathroom', 'bed2')], preview = previewLayout(createBlankProject('Daylight proxy'), spec(rooms));
        expect(preview.issues).toEqual([]);
        for (const result of preview.rooms) {
            const e = preview.elements.find(e => e.id === result.elementId)!;
            let glazed = 0;
            for (const id of result.windowIds) {
                const w = preview.elements.find(e => e.id === id)!, host = preview.elements.find(e => e.id === w.hostId)!;
                expect(host.properties.exterior).toBe(true);
                expect(w.properties.roomKey).toBe(result.key);
                const center = worldToLocal(host, w).x + w.width / 2, points = [localToWorld(host, center, -.03), localToWorld(host, center, host.depth + .03)];
                expect(points.some(p => inside(e, p))).toBe(true);
                glazed += w.width * w.height;
            }
            if (!['bathroom', 'utility', 'garage'].includes(result.use)) {
                expect(result.daylight).toBe('exterior-window');
                const target = e.width * e.depth * .15;
                if (glazed + 1e-5 < target)
                    expect(preview.assumptions.some(text => text.includes(result.name) && text.includes('below the 15%'))).toBe(true);
                else
                    expect(glazed).toBeGreaterThanOrEqual(target - 1e-5);
            }
        }
        expect(preview.rooms.find(r => r.key === 'living')!.windowIds.length).toBeGreaterThanOrEqual(2);
        expect(preview.assumptions.join(' ')).toMatch(/not solar\/daylight simulation/);
        for (const room of preview.rooms.filter(room => room.daylight === 'none'))
            expect(preview.assumptions.some(text => text.includes(room.name) && text.includes('no direct exterior glazing'))).toBe(true);
    });
    it('keeps every access connection reachable without an invented programme room', () => {
        const preview = previewLayout(createBlankProject('Connected'), spec());
        expect(preview.issues).toEqual([]);
        const seen = new Set(['outside']);
        let changed = true;
        while (changed) {
            changed = false;
            for (const c of preview.connections) {
                if (seen.has(c.from) && !seen.has(c.to)) {
                    seen.add(c.to);
                    changed = true;
                }
                if (seen.has(c.to) && !seen.has(c.from)) {
                    seen.add(c.from);
                    changed = true;
                }
            }
        }
        expect(preview.rooms.every(r => seen.has(r.key))).toBe(true);
        expect(preview.rooms).toHaveLength(9);
        for (const r of preview.rooms)
            if (r.attachedTo)
                expect(r.accessFrom).toBe(r.attachedTo);
        checkDoors(preview);
    });
    it('coordinates public ground/private upper rooms, a real stair and slabs around its exact void', () => {
        const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('bed1', 'bedroom'), room('bath1', 'bathroom', 'bed1'), room('bed2', 'bedroom'), room('bath2', 'bathroom', 'bed2'), room('pool', 'pool')], p = createBlankProject('Two floors'), preview = previewLayout(p, spec(rooms, { storeys: 2, floorHeight: 3.6 }));
        expect(preview.issues).toEqual([]);
        expect(preview.levels).toHaveLength(1);
        expect(preview.floors).toHaveLength(2);
        expect(preview.levels[0].elevation).toBe(3.6);
        for (const r of preview.rooms)
            expect(r.levelId).toBe(['bedroom'].includes(r.use) || r.attachedTo ? preview.levels[0].id : 'level-0');
        const stair = preview.elements.find(e => e.kind === 'stair')!;
        expect(stair.height).toBe(3.6);
        expect(stair.properties.toLevelId).toBe(preview.levels[0].id);
        expect(Number(stair.properties.riser)).toBeLessThanOrEqual(.175);
        expect(Number(stair.properties.tread)).toBeCloseTo(.27);
        const upper = preview.elements.filter(e => e.levelId === preview.levels[0].id), slabs = upper.filter(e => e.kind === 'slab');
        expect(slabs.length).toBeGreaterThanOrEqual(3);
        const lowerLanding = preview.elements.find(e => e.id === stair.properties.lowerLandingId)!, upperLanding = preview.elements.find(e => e.id === stair.properties.upperLandingId)!;
        expect(inside(lowerLanding, localToWorld(stair, stair.width / 2, -.03))).toBe(true);
        expect(inside(upperLanding, localToWorld(stair, stair.width / 2, stair.depth + .03))).toBe(true);
        expect(stair.z + stair.height).toBeCloseTo(upperLanding.z);
        for (const e of upper.filter(e => e.kind === 'slab' || e.kind === 'room'))
            expect(overlap(box(e, preview.footprint), box(stair, preview.footprint)), e.name).toBeLessThan(1e-7);
        expect(slabs.reduce((n, e) => n + e.width * e.depth, 0)).toBeCloseTo(preview.footprint.width * preview.footprint.depth - stair.width * stair.depth, 5);
        expect(slabs.every(e => Math.abs(e.z + e.height - 3.6) < 1e-5)).toBe(true);
        expect(validateModelGeometry(commit(p, preview))).toEqual([]);
        checkDoors(preview);
        checkSolids(preview);
    });
    it('reuses an empty upper level and respects explicit floor and ensuite assignments', () => {
        const p = createBlankProject('Existing floor');
        p.levels.push({ id: 'existing-upper', name: 'Existing first floor', elevation: 3.2 });
        const rooms = [room('ground-bed', 'bedroom', null, 0), room('bath', 'bathroom', 'ground-bed'), room('upper-study', 'study', null, 1)];
        const preview = previewLayout(p, spec(rooms, { storeys: 2 }));
        expect(preview.issues).toEqual([]);
        expect(preview.levels).toEqual([]);
        expect(preview.rooms.find(r => r.key === 'bath')!.levelId).toBe('level-0');
        expect(preview.rooms.find(r => r.key === 'upper-study')!.levelId).toBe('existing-upper');
        checkDoors(preview);
        expect(previewLayout(p, spec([room('b', 'bedroom', null, 0), room('a', 'bathroom', 'b', 1)], { storeys: 2 })).issues.join(' ')).toMatch(/share its bedroom/);
    });
    it('places an unspecified common bathroom near upper bedrooms that have no ensuite', () => {
        const rooms = [room('living', 'living'), room('kitchen', 'kitchen'), room('bed1', 'bedroom'), room('bed2', 'bedroom'), room('common', 'bathroom')], preview = previewLayout(createBlankProject('Shared bathroom'), spec(rooms, { storeys: 2 }));
        expect(preview.issues).toEqual([]);
        expect(preview.rooms.find(r => r.key === 'common')!.levelId).toBe(preview.floors[1].level.id);
        checkDoors(preview);
    });
    it('keeps every declared open circulation link physically clear of walls', () => {
        const preview = previewLayout(createBlankProject('Open access'), spec(programme, { storeys: 2 }));
        expect(preview.issues).toEqual([]);
        for (const link of preview.connections.filter(link => link.kind === 'open')) {
            const a = preview.elements.find(e => e.kind === 'room' && e.levelId === link.levelId && e.properties.layoutKey === link.from)!, b = preview.elements.find(e => e.kind === 'room' && e.levelId === link.levelId && e.properties.layoutKey === link.to)!, aa = box(a, preview.footprint), bb = box(b, preview.footprint);
            let path: {
                x: number;
                y: number;
            }[] = [];
            const sharedX = Math.min(aa.right, bb.right) - Math.max(aa.x, bb.x), sharedY = Math.min(aa.top, bb.top) - Math.max(aa.y, bb.y);
            if (sharedX >= .89) {
                const x = (Math.max(aa.x, bb.x) + Math.min(aa.right, bb.right)) / 2, from = aa.y < bb.y ? aa.top - .03 : aa.y + .03, to = aa.y < bb.y ? bb.y + .03 : bb.top - .03;
                expect(Math.abs(to - from)).toBeLessThanOrEqual(.261);
                path = Array.from({ length: 9 }, (_, i) => ({ x, y: from + (to - from) * i / 8 }));
            }
            else {
                expect(sharedY).toBeGreaterThanOrEqual(.89);
                const y = (Math.max(aa.y, bb.y) + Math.min(aa.top, bb.top)) / 2, from = aa.x < bb.x ? aa.right - .03 : aa.x + .03, to = aa.x < bb.x ? bb.x + .03 : bb.right - .03;
                expect(Math.abs(to - from)).toBeLessThanOrEqual(.261);
                path = Array.from({ length: 9 }, (_, i) => ({ x: from + (to - from) * i / 8, y }));
            }
            for (const point of path) {
                const world = localToWorld(preview.footprint, point.x, point.y);
                expect(preview.elements.some(e => e.kind === 'wall' && e.levelId === link.levelId && inside(e, world)), `${link.from} to ${link.to} crosses a wall`).toBe(false);
            }
        }
    });
    it('rejects missing stair approval, locked levels, nonconcept upper data and identity collisions', () => {
        const p = createBlankProject('Guards');
        p.types.find(t => t.kind === 'stair')!.approved = false;
        expect(previewLayout(p, spec(programme, { storeys: 2 })).issues.join(' ')).toMatch(/stair/);
        p.types.find(t => t.kind === 'stair')!.approved = true;
        p.constraints.lockedProperties = ['levels'];
        expect(previewLayout(p, spec(programme, { storeys: 2 })).issues.join(' ')).toMatch(/locked/);
        p.constraints.lockedProperties = [];
        p.levels.push({ id: 'residential-level-1', name: 'Wrong elevation', elevation: 8 });
        expect(previewLayout(p, spec(programme, { storeys: 2 })).issues.join(' ')).toMatch(/identifier/);
        const q = slabProject();
        q.levels.push({ id: 'upper', name: 'Upper', elevation: 3.2 });
        q.elements.push({ ...q.elements[0], id: 'manual-upper', levelId: 'upper', z: 3, width: 10.4, depth: 14 });
        expect(previewLayout(q, spec(programme, { storeys: 2, footprintId: 'base-slab' })).issues.join(' ')).toMatch(/occupied/);
    });
    it('replans a selected concept without mutating the source and refuses manual/locked replacements', () => {
        const p = createBlankProject('Replan'), first = previewLayout(p, spec()), model = commit(p, first), floor = model.elements.find(e => e.kind === 'slab')!;
        expect(first.issues).toEqual([]);
        const before = structuredClone(model), replacement = previewLayout(model, spec(programme, { idPrefix: 'revision', footprintId: floor.id, replaceConcept: true }));
        expect(replacement.issues).toEqual([]);
        expect(replacement.removedElements.length).toBe(first.elements.length - 1);
        for (const removed of replacement.removedElements)
            expect(removed).toEqual(model.elements.find(e => e.id === removed.id));
        expect(replacement.removedElements.some(e => e.id === floor.id)).toBe(false);
        replacement.removedElements[0].properties.status = 'Preview-only edit';
        expect(model).toEqual(before);
        expect(previewLayout(model, spec(programme, { idPrefix: 'revision', footprintId: floor.id })).issues.join(' ')).toMatch(/occupied/);
        const oldWall = model.elements.find(e => e.kind === 'wall')!;
        model.constraints.lockedElementIds = [oldWall.id];
        expect(previewLayout(model, spec(programme, { idPrefix: 'revision', footprintId: floor.id, replaceConcept: true })).issues.join(' ')).toMatch(/locked/);
        model.constraints.lockedElementIds = [];
        oldWall.properties.conceptLayout = false;
        expect(previewLayout(model, spec(programme, { idPrefix: 'revision', footprintId: floor.id, replaceConcept: true })).issues.join(' ')).toMatch(/manual/);
        oldWall.properties.conceptLayout = true;
        oldWall.externalId = '';
        expect(previewLayout(model, spec(programme, { idPrefix: 'revision', footprintId: floor.id, replaceConcept: true })).issues.join(' ')).toMatch(/external/);
    });
    it('removes an entire legacy source cohort beyond a smaller replacement envelope', () => {
        const p = createBlankProject('Released0.3.3'), type = p.types.find(t => t.kind === 'slab')!, base: BimElement = { id: 'old-floor', kind: 'slab', name: 'Old concept floor', levelId: 'level-0', typeId: type.id, material: type.material, x: 0, y: 0, z: -.2, width: 20, depth: 20, height: .2, rotation: 0, editable: true, properties: { conceptLayout: true } };
        p.elements = [base, { ...base, id: 'old-rear-wall', kind: 'wall', typeId: 'wall-aac', name: 'Old rear wall', y: 19.8, width: 20, depth: .2, height: 2.9, z: 0 }, { ...base, id: 'old-room', kind: 'room', typeId: 'room-default', name: 'Old far room', x: 15, y: 15, width: 3, depth: 3, height: .02, z: 0 }];
        const output = previewLayout(p, spec([room('study', 'study')], { idPrefix: 'replacement', replaceConcept: true }));
        expect(output.issues).toEqual([]);
        expect(output.footprint.width).toBeLessThan(20);
        expect(output.footprint.depth).toBeLessThan(20);
        expect(output.removedElements.map(e => e.id).sort()).toEqual(p.elements.map(e => e.id).sort());
        p.elements[1].editable = false;
        expect(previewLayout(p, spec([room('study', 'study')], { idPrefix: 'replacement', replaceConcept: true })).issues.join(' ')).toMatch(/read-only/);
    });
    it('requires the retained manual base slab for an unselected later replan', () => {
        const p = slabProject(), initial = previewLayout(p, spec(programme, { footprintId: 'base-slab' }));
        expect(initial.issues).toEqual([]);
        const model = commit(p, initial), output = previewLayout(model, spec(programme, { replaceConcept: true, idPrefix: 'new-house' }));
        expect(output.elements).toEqual([]);
        expect(output.issues.join(' ')).toMatch(/Select the original base slab/);
    });
    it('preserves an established nondefault rise and base level during an upper-tab replan', () => {
        const p = createBlankProject('Established rise'), initial = previewLayout(p, spec(programme, { storeys: 2, floorHeight: 3.6 }));
        expect(initial.issues).toEqual([]);
        const model = commit(p, initial), upper = initial.levels[0];
        const replan = previewLayout(model, spec(programme, { idPrefix: 'replanned', levelId: upper.id, storeys: 2, floorHeight: null, replaceConcept: true }));
        expect(replan.issues).toEqual([]);
        expect(replan.levels).toEqual([]);
        expect(replan.floors[0].level.id).toBe('level-0');
        expect(replan.floors[1].level.id).toBe(upper.id);
        expect(replan.elements.find(e => e.kind === 'stair')!.height).toBe(3.6);
        expect(replan.removedElements).toHaveLength(model.elements.length);
        expect(previewLayout(model, spec(programme, { idPrefix: 'bad-rise', storeys: 2, floorHeight: 3.2, replaceConcept: true })).issues.join(' ')).toMatch(/established/);
        expect(previewLayout(model, spec(programme, { idPrefix: 'bad-storey', storeys: 1, replaceConcept: true })).issues.join(' ')).toMatch(/two storeys/);
    });
    it('rejects ambiguous multiple footprints and same-prefix replacement identities', () => {
        const p = createBlankProject('Identity scopes'), first = previewLayout(p, spec()), model = commit(p, first);
        expect(previewLayout(model, spec(programme, { replaceConcept: true })).issues.join(' ')).toMatch(/identifier/);
        const slab = model.elements.find(e => e.kind === 'slab')!;
        model.elements.push({ ...slab, id: 'other-footprint', x: 100 });
        expect(previewLayout(model, spec(programme, { replaceConcept: true, idPrefix: 'new' })).issues.join(' ')).toMatch(/Several concept footprints/);
    });
});
