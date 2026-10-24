import { describe, expect, it } from 'vitest';
import { previewLayout } from '../src/domain/layout';
import { assessLayoutQuality } from '../src/domain/layoutQuality';
import { createBlankProject } from '../src/domain/seed';
import type { LayoutRequest, LayoutRoom } from '../src/domain/types';
import { footprint, localToWorld, worldToLocal } from '../src/model/geometry';

const room = (key: string, use: LayoutRoom['use'], attachedTo: string | null = null): LayoutRoom => ({ key, name: key, use, area: null, attachedTo, floor: null });
const twelve = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('laundry', 'utility'), room('pantry', 'utility'), room('guestWC', 'bathroom'), room('family-bath', 'bathroom'), ...[1, 2, 3, 4].map(n => room(`bed${n}`, 'bedroom')), room('ensuite', 'bathroom', 'bed1')];
const nine = [1, 2, 3].flatMap(n => [room(`bed${n}`, 'bedroom'), room(`bath${n}`, 'bathroom', `bed${n}`)]).concat([room('kitchen', 'kitchen'), room('library', 'study'), room('pool', 'pool')]);
const request = (rooms = twelve, patch: Partial<LayoutRequest> = {}): LayoutRequest => ({ idPrefix: 'quality', levelId: 'level-0', footprintId: null, width: null, depth: null, rooms, storeys: 2, ...patch });

describe('bounded residential sizing and honest fit assessments', () => {
    it('physically bounds service rooms in the twelve-room house and counts residual access instead of hiding it', () => {
        const source = createBlankProject('Four bedrooms'), before = structuredClone(source), preview = previewLayout(source, request());
        expect(preview.issues).toEqual([]);
        expect(preview.rooms.map(r => r.key).sort()).toEqual(twelve.map(r => r.key).sort());
        for (const service of preview.rooms.filter(r => ['bathroom', 'utility'].includes(r.use))) {
            expect(service.area).toBeGreaterThanOrEqual(service.requestedArea - .001);
            expect(service.area).toBeLessThanOrEqual(7);
            const element = preview.elements.find(e => e.id === service.elementId)!;
            expect(element.width * element.depth).toBeCloseTo(service.area, 2);
        }
        expect(preview.rooms.find(r => r.key === 'pantry')!.accessFrom).toBe('kitchen');
        expect(preview.quality?.circulationReview).toBe(true);
        expect(preview.quality?.scope.join(' ')).toMatch(/Service access alcoves are included/);
        const actualCirculation = preview.elements.filter(e => e.kind === 'room' && e.properties.use === 'circulation').reduce((n, e) => n + e.width * e.depth, 0);
        expect(preview.metrics!.circulationArea).toBeCloseTo(actualCirculation, 2);
        for (const link of preview.connections.filter(c => c.kind === 'door')) {
            const door = preview.elements.find(e => e.id === link.elementId)!;
            const host = preview.elements.find(e => e.id === door.hostId)!;
            const offset = worldToLocal(host, door).x + door.width / 2;
            const points = [localToWorld(host, offset, -.03), localToWorld(host, offset, host.depth + .03)];
            for (const key of [link.from, link.to].filter(key => key !== 'outside')) {
                const space = preview.elements.find(e => e.kind === 'room' && e.levelId === link.levelId && e.properties.layoutKey === key)!;
                expect(points.some(point => { const p = worldToLocal(space, point); return p.x > 0 && p.y > 0 && p.x < space.width && p.y < space.depth; }), `${key} physical door`).toBe(true);
            }
        }
        // Open links must cross an actual clear shared boundary, not a new
        // programme-room privacy wall without a doorway.
        for (const link of preview.connections.filter(c => c.kind === 'open')) {
            const a = preview.elements.find(e => e.kind === 'room' && e.levelId === link.levelId && e.properties.layoutKey === link.from)!;
            const b = preview.elements.find(e => e.kind === 'room' && e.levelId === link.levelId && e.properties.layoutKey === link.to)!;
            expect(a.properties.use).toBe('circulation');
            expect(b.properties.use).toBe('circulation');
        }
        expect(source).toEqual(before);
    });

    it('produces a stable distinct daylight-proxy alternative while preserving the exact nine-room programme', () => {
        const project = createBlankProject('Nine rooms');
        const base = request(nine, { storeys: 1, variant: 'balanced' });
        const balanced = previewLayout(project, base), alternative = previewLayout(project, { ...base, variant: 'daylight' });
        expect(balanced.issues).toEqual([]);
        expect(alternative.issues).toEqual([]);
        expect([alternative.footprint.width, alternative.footprint.depth]).not.toEqual([balanced.footprint.width, balanced.footprint.depth]);
        expect(alternative.rooms.map(r => r.key).sort()).toEqual(nine.map(r => r.key).sort());
        expect(alternative.rooms.filter(r => !['bathroom', 'utility'].includes(r.use)).every(r => r.windowIds.length)).toBe(true);
        expect(previewLayout(project, { ...base, variant: 'daylight' })).toEqual(alternative);
        expect(previewLayout(project, { ...base, variant: null })).toEqual(balanced);
        expect(alternative.quality!.scope.join(' ')).toMatch(/not a daylight/);
    });

    it('offers three physically distinct bounded recipes when the programme allows them', () => {
        const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('bed', 'bedroom'), room('bath', 'bathroom', 'bed')];
        const project = createBlankProject('Alternatives');
        const previews = (['balanced', 'compact', 'daylight'] as const).map(variant => previewLayout(project, request(rooms, { storeys: 1, variant })));
        expect(previews.every(p => p.issues.length === 0)).toBe(true);
        const signatures = previews.map(p => JSON.stringify(p.elements.map(e => [e.kind, e.x, e.y, e.width, e.depth, e.rotation])));
        expect(new Set(signatures).size).toBe(3);
        for (const preview of previews) {
            expect(preview.rooms.map(r => r.key).sort()).toEqual(rooms.map(r => r.key).sort());
            expect(preview.rooms.find(r => r.key === 'bath')!.accessFrom).toBe('bed');
            expect(preview.rooms.find(r => r.key === 'kitchen')!.accessFrom).toBe('dining');
        }
    });

    it('retains an explicitly selected rotated slab for every variant and preserves explicit room floors', () => {
        const project = createBlankProject('Fixed'), type = project.types.find(t => t.kind === 'slab')!;
        const slab = { id: 'fixed', name: 'Surveyed slab', kind: 'slab' as const, levelId: 'level-0', typeId: type.id, material: type.material, x: 10, y: 20, z: -.2, width: 14, depth: 18, height: .2, rotation: 31, editable: true, properties: {} };
        project.elements = [slab];
        const before = structuredClone(project);
        for (const variant of ['balanced', 'compact', 'daylight'] as const) {
            const rooms = twelve.map(r => ({ ...r, floor: (r.use === 'bedroom' || r.attachedTo || r.key === 'family-bath' ? 1 : 0) as 0 | 1 }));
            const result = previewLayout(project, request(rooms, { footprintId: slab.id, variant }));
            expect(result.issues).toEqual([]);
            expect(result.footprint).toMatchObject({ x: slab.x, y: slab.y, width: slab.width, depth: slab.depth, rotation: slab.rotation });
            for (const r of result.rooms) expect(r.levelId).toBe(result.floors[rooms.find(input => input.key === r.key)!.floor].level.id);
            for (const element of result.elements) for (const point of footprint(element)) {
                const p = worldToLocal(slab, point);
                expect(p.x).toBeGreaterThanOrEqual(-.001);
                expect(p.y).toBeGreaterThanOrEqual(-.001);
                expect(p.x).toBeLessThanOrEqual(slab.width + .001);
                expect(p.y).toBeLessThanOrEqual(slab.depth + .001);
            }
        }
        expect(project).toEqual(before);
    });

    it('measures rotated rectangular fit envelopes and flags oversize, proportions and unresolved fit without claiming furnishing validation', () => {
        const result = previewLayout(createBlankProject('Guide'), request([room('study', 'study')], { storeys: 1 }));
        const generated = result.rooms[0];
        const quality = assessLayoutQuality({ rooms: [{ ...generated, use: 'bedroom', area: 30, requestedArea: 14, dimensions: { width: 6, depth: 5 } }, { ...generated, key: 'narrow', use: 'bedroom', area: 14, requestedArea: 14, dimensions: { width: 2, depth: 7 } }, { ...generated, key: 'turned', use: 'kitchen', area: 7.2, requestedArea: 7.2, dimensions: { width: 3, depth: 2.4 } }], connections: [] });
        expect(quality.rooms[0].messages.join(' ')).toMatch(/exceeds/);
        expect(quality.rooms[1].fitEnvelope.fits).toBe(false);
        expect(quality.rooms[1].messages.join(' ')).toMatch(/Elongated/);
        expect(quality.rooms[2].fitEnvelope).toMatchObject({ fits: true, rotated: true });
        expect(quality.totalExcessArea).toBe(6);
        expect(quality.scope.join(' ')).toMatch(/door swings.*have not been resolved or validated/);
        expect(quality.scope.join(' ')).toMatch(/not legal, accessibility or Vaastu/);
    });
});
