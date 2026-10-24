import { describe, expect, it } from 'vitest';
import { previewLayout } from '../src/domain/layout';
import { emptyPlanningContext } from '../src/domain/planning';
import { keralaResidentialWorksheet } from '../src/domain/keralaRules';
import { createBlankProject } from '../src/domain/seed';
import type { LayoutRequest, LayoutRoom, Project } from '../src/domain/types';
import { assessPlanning, reviewedSiteEnvelope } from '../src/engine/planningChecks';
import { footprint, localToWorld, worldToLocal } from '../src/model/geometry';

const today = new Date().toISOString().slice(0, 10);
const room = (key: string, use: LayoutRoom['use'], attachedTo: string | null = null): LayoutRoom => ({ key, name: key, use, area: null, attachedTo });
const rooms = [room('living', 'living'), room('dining', 'dining'), room('kitchen', 'kitchen'), room('bed', 'bedroom'), room('bath', 'bathroom', 'bed')];
const request = (patch: Partial<LayoutRequest> = {}): LayoutRequest => ({ idPrefix: 'site', levelId: 'level-0', footprintId: null, width: null, depth: null, rooms, ...patch });
function site(): Project {
    const project = createBlankProject('Independent synthetic site'), planning = emptyPlanningContext();
    Object.assign(planning, { country: 'Test country', region: 'Test region', authority: 'Test authority', authorityType: 'municipality', plot: { x: 100, y: -25, width: 30, depth: 40, rotation: 37 }, frontBoundary: 'east', groundElevation: 0 });
    planning.ruleSource = { title: 'SYNTHETIC TEST LIMITS — not actual law', url: 'https://example.gov.test/fixture', version: 'fixture-v1', country: planning.country, region: planning.region, authority: planning.authority, authorityType: 'municipality', effectiveFrom: today, reviewedOn: today, applicability: 'Synthetic test only', confirmedBy: 'QA reviewer', amendmentsChecked:true };
    planning.rules = [{ id: 'front', metric: 'front-setback', limit: 3, clause: 'TEST FRONT' }, { id: 'rear', metric: 'rear-setback', limit: 1, clause: 'TEST REAR' }, { id: 'left', metric: 'left-setback', limit: 2, clause: 'TEST LEFT' }, { id: 'right', metric: 'right-setback', limit: 4, clause: 'TEST RIGHT' }];
    return { ...project, planning };
}
function addSlab(project: Project, localX: number, localY: number) {
    const type = project.types.find(t => t.kind === 'slab')!, plot = project.planning!.plot!, position = localToWorld(plot, localX, localY);
    project.elements = [{ id: 'surveyed-slab', name: 'Existing surveyed slab', kind: 'slab', levelId: 'level-0', typeId: type.id, material: type.material, ...position, z: -.2, width: 14, depth: 18, height: .2, rotation: plot.rotation, editable: true, properties: {} }];
    return project.elements[0];
}

describe('site-aware concept placement without invented rules', () => {
    it('centres the bounded house within a rotated plot and only the reviewed cited yard frame', () => {
        const project = site(), before = structuredClone(project), baselineProject = structuredClone(project);
        delete baselineProject.planning;
        const specification = request({ storeys: 2 }), baseline = previewLayout(baselineProject, specification), preview = previewLayout(project, specification), envelope = reviewedSiteEnvelope(project)!;
        expect(preview.issues).toEqual([]);
        expect(preview.footprint.width).toBe(baseline.footprint.width);
        expect(preview.footprint.depth).toBe(baseline.footprint.depth);
        expect(preview.footprint.rotation).toBe(37);
        const local = worldToLocal(envelope.plot, preview.footprint);
        expect(local.x).toBeCloseTo(envelope.west + (envelope.plot.width - envelope.west - envelope.east - preview.footprint.width) / 2);
        expect(local.y).toBeCloseTo(envelope.south + (envelope.plot.depth - envelope.south - envelope.north - preview.footprint.depth) / 2);
        for (const element of preview.elements) for (const point of footprint(element)) {
            const p = worldToLocal(envelope.plot, point);
            expect(p.x).toBeGreaterThanOrEqual(envelope.west - .001);
            expect(p.y).toBeGreaterThanOrEqual(envelope.south - .001);
            expect(p.x).toBeLessThanOrEqual(envelope.plot.width - envelope.east + .001);
            expect(p.y).toBeLessThanOrEqual(envelope.plot.depth - envelope.north + .001);
        }
        const stair = preview.elements.find(e => e.kind === 'stair')!, upperLanding = preview.elements.find(e => e.id === stair.properties.upperLandingId)!;
        const arrival = worldToLocal(upperLanding, localToWorld(stair, stair.width / 2, stair.depth + .03));
        expect(arrival.x).toBeGreaterThan(0);
        expect(arrival.y).toBeGreaterThan(0);
        expect(arrival.x).toBeLessThan(upperLanding.width);
        expect(arrival.y).toBeLessThan(upperLanding.depth);
        const assessment = assessPlanning({ ...project, levels: [...project.levels, ...preview.levels], elements: preview.elements });
        expect(assessment.sourceIssues).toEqual([]);
        expect(assessment.checks.filter(c => c.id.endsWith('setback')).every(c => c.status === 'within-entered-limit')).toBe(true);
        expect(previewLayout(project, specification)).toEqual(preview);
        expect(project).toEqual(before);
    });

    it('refuses too-small usable plots atomically rather than stretching or placing geometry outside them', () => {
        const project = site();
        project.planning!.plot = { x: 12, y: -3, width: 12, depth: 8, rotation: 51 };
        const before = structuredClone(project), preview = previewLayout(project, request({ storeys: 2 }));
        expect(preview.issues.join(' ')).toMatch(/does not fit.*usable plot frame/);
        expect(preview.elements).toEqual([]);
        expect(preview.rooms).toEqual([]);
        expect(preview.levels).toEqual([]);
        expect(preview.removedElements).toEqual([]);
        expect(project).toEqual(before);
        project.planning!.plot.depth = 5;
        expect(previewLayout(project, request()).issues.join(' ')).toMatch(/leave no usable plot rectangle/);
    });

    it('uses physical plot bounds but applies no yard values from an unconfirmed source', () => {
        const project = site();
        project.planning!.ruleSource.confirmedBy = '';
        project.planning!.rules.forEach(rule => { rule.limit = 100; });
        const preview = previewLayout(project, request()), plot = project.planning!.plot!;
        expect(preview.issues).toEqual([]);
        const local = worldToLocal(plot, preview.footprint);
        expect(local.x).toBeCloseTo((plot.width - preview.footprint.width) / 2);
        expect(local.y).toBeCloseTo((plot.depth - preview.footprint.depth) / 2);
        expect(preview.assumptions.join(' ')).toMatch(/no yard limits were inferred or applied/);
    });

    it('retains exact selected slab geometry inside the site and blocks boundary/known-yard conflicts clearly', () => {
        const project = site(), slab = addSlab(project, 5, 6), before = structuredClone(project);
        const preview = previewLayout(project, request({ footprintId: slab.id }));
        expect(preview.issues).toEqual([]);
        expect(preview.footprint).toMatchObject({ x: slab.x, y: slab.y, width: slab.width, depth: slab.depth, rotation: slab.rotation });
        expect(preview.elements.some(e => e.id === slab.id)).toBe(false);
        expect(project).toEqual(before);

        const outside = site(), outsideSlab = addSlab(outside, -.5, 6);
        expect(previewLayout(outside, request({ footprintId: outsideSlab.id })).issues.join(' ')).toMatch(/selected slab lies outside the entered plot/);
        const yard = site(), yardSlab = addSlab(yard, .5, 6);
        expect(previewLayout(yard, request({ footprintId: yardSlab.id })).issues.join(' ')).toMatch(/selected slab crosses a team-reviewed entered yard limit/);
        yard.planning!.ruleSource.confirmedBy = '';
        expect(previewLayout(yard, request({ footprintId: yardSlab.id })).issues).toEqual([]);
    });

    it('can relocate only the original reviewed concept cohort and refuses retained geometry at the new position', () => {
        const project = createBlankProject('Relocate concept'), initial = previewLayout(project, request({ idPrefix: 'original' }));
        expect(initial.issues).toEqual([]);
        project.elements = structuredClone(initial.elements);
        project.planning = site().planning;
        const before = structuredClone(project), replacement = previewLayout(project, request({ idPrefix: 'relocated', replaceConcept: true }));
        expect(replacement.issues).toEqual([]);
        expect(replacement.removedElements.map(e => e.id).sort()).toEqual(initial.elements.map(e => e.id).sort());
        expect(replacement.footprint.x).not.toBe(initial.footprint.x);
        expect(project).toEqual(before);
        const type = project.types.find(t => t.kind === 'wall')!;
        project.elements.push({ id: 'retained-manual', name: 'Retained manual wall', kind: 'wall', levelId: 'level-0', typeId: type.id, material: type.material, x: replacement.footprint.x, y: replacement.footprint.y, z: 0, width: 1, depth: .2, height: 3, rotation: replacement.footprint.rotation, editable: true, properties: {} });
        const blocked = previewLayout(project, request({ idPrefix: 'blocked', replaceConcept: true }));
        expect(blocked.issues.join(' ')).toMatch(/overlaps geometry outside the original house footprint/);
        expect(blocked.elements).toEqual([]);
        expect(blocked.removedElements).toEqual([]);
    });

    it('leaves generation unchanged when there is no entered plot', () => {
        const project = createBlankProject('No site'), withUnconfiguredPlanning = { ...structuredClone(project), planning: emptyPlanningContext() };
        expect(previewLayout(withUnconfiguredPlanning, request())).toEqual(previewLayout(project, request()));
    });

    it('applies a reviewed Kerala worksheet to the anticipated height of a blank model', () => {
        const project = site();
        Object.assign(project.planning!, { country: 'India', region: 'Kerala', authority: 'QA synthetic municipality', authorityType: 'municipality', frontBoundary: 'south' });
        project.planning = keralaResidentialWorksheet(project.planning!);
        Object.assign(project.planning.ruleSource, { confirmedBy: 'QA reviewer', reviewedOn: today, amendmentsChecked: true });
        expect(reviewedSiteEnvelope(project)!.sourceReviewed).toBe(false);
        const preview = previewLayout(project, request({ storeys: 2 })), plot = project.planning.plot!;
        expect(preview.issues).toEqual([]);
        const local = worldToLocal(plot, preview.footprint);
        expect(local.y).toBeCloseTo(3 + (plot.depth - 3 - 1.5 - preview.footprint.depth) / 2);
        const actualTop = Math.max(...preview.elements.filter(e => !['room', 'reference', 'door', 'window'].includes(e.kind)).map(e => e.z + e.height));
        expect(actualTop - project.planning.groundElevation!).toBeCloseTo(6.2);
        expect(preview.assumptions.join(' ')).not.toMatch(/no yard limits were inferred or applied/);
        const proposed = { ...project, levels: [...project.levels, ...preview.levels], elements: preview.elements };
        expect(assessPlanning(proposed).sourceIssues).toEqual([]);
        project.planning.plot = { ...plot, width: preview.footprint.width + 1, depth: preview.footprint.depth + 1 };
        expect(previewLayout(project, request({ storeys: 2 })).issues.join(' ')).toMatch(/does not fit.*usable plot frame/);
    });

    it('does not claim Kerala worksheet applicability above 10 m or without a survey ground datum', () => {
        const project = site();
        Object.assign(project.planning!, { country: 'India', region: 'Kerala', authority: 'QA synthetic municipality', frontBoundary: 'south' });
        project.planning = keralaResidentialWorksheet(project.planning!);
        Object.assign(project.planning.ruleSource, { confirmedBy: 'QA reviewer', reviewedOn: today, amendmentsChecked: true });
        project.levels[0].elevation = 8;
        const high = previewLayout(project, request()), plot = project.planning.plot!;
        expect(high.issues).toEqual([]);
        expect(worldToLocal(plot, high.footprint).y).toBeCloseTo((plot.depth - high.footprint.depth) / 2);
        expect(high.assumptions.join(' ')).toMatch(/exceeds.*10 m applicability threshold/);
        expect(high.assumptions.join(' ')).toMatch(/not a universal legal height limit/);
        project.levels[0].elevation = 0;
        project.planning.groundElevation = null;
        const missingDatum = previewLayout(project, request());
        expect(missingDatum.issues).toEqual([]);
        expect(worldToLocal(plot, missingDatum.footprint).y).toBeCloseTo((plot.depth - missingDatum.footprint.depth) / 2);
        expect(missingDatum.assumptions.join(' ')).toMatch(/height applicability remains unresolved/);
    });
});
