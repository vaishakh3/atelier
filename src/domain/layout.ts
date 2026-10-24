import type { BimElement, ElementKind, LayoutRequest, LayoutRoom, LayoutUse, Level, Project } from './types';
import { layoutSpecSchema } from './schema';
import { footprint, localToWorld, validateModelGeometry, worldToLocal } from '../model/geometry';
import type { Point2 } from '../model/geometry';
import { packResidentialHub } from './residentialPacking';
import type { HubPacking } from './residentialPacking';
import { assessLayoutQuality } from './layoutQuality';
import type { LayoutQualityAssessment } from './layoutQuality';
import { reviewedSiteEnvelope } from '../engine/planningChecks';
export type { LayoutQualityAssessment, LayoutRoomAssessment, LayoutRelationshipAssessment } from './layoutQuality';
export interface LayoutRoomResult {
    key: string;
    elementId: string;
    name: string;
    use: LayoutUse;
    requestedArea: number;
    area: number;
    attachedTo: string | null;
    accessFrom: string;
    doorId: string;
    dimensions: {
        width: number;
        depth: number;
    };
    levelId: string;
    windowIds: string[];
    daylight: 'exterior-window' | 'none';
}
export interface LayoutFootprint {
    x: number;
    y: number;
    width: number;
    depth: number;
    rotation: number;
    levelId: string;
}
export interface LayoutCirculation {
    elementId: string;
    entryDoorId: string;
    width: number;
}
export interface LayoutFloorPreview {
    level: Level;
    footprint: LayoutFootprint;
    rooms: LayoutRoomResult[];
    circulation?: LayoutCirculation;
}
export interface LayoutConnection {
    from: string;
    to: string;
    levelId: string;
    kind: 'door' | 'open' | 'stair';
    elementId?: string;
}
export interface LayoutPreview {
    elements: BimElement[];
    issues: string[];
    assumptions: string[];
    footprint: LayoutFootprint;
    rooms: LayoutRoomResult[];
    circulation?: LayoutCirculation;
    levels: Level[];
    removedElements: BimElement[];
    floors: LayoutFloorPreview[];
    strategy: 'compact-hub' | 'zoned-gallery';
    connections: LayoutConnection[];
    quality?: LayoutQualityAssessment;
    metrics?: {
        circulationArea: number;
        programmeArea: number;
        circulationRatio: number;
        daylightRooms: number;
        habitableRooms: number;
        glazingTargetRatio: number;
        hubArea: number;
        longestAccessBranch: number;
    };
}
const T = .2, C = 1.2, EPS = 1e-6, GLAZING = .15;
const defaults: Record<LayoutUse, {
    area: number;
    width: number;
    depth: number;
}> = { bedroom: { area: 14, width: 2.7, depth: 2.7 }, bathroom: { area: 4.5, width: 1.5, depth: 1.5 }, living: { area: 20, width: 3.2, depth: 3.2 }, kitchen: { area: 10, width: 2.4, depth: 2.4 }, dining: { area: 12, width: 2.7, depth: 2.7 }, theater: { area: 16, width: 3, depth: 3 }, pool: { area: 24, width: 3.5, depth: 4.5 }, study: { area: 9, width: 2.4, depth: 2.4 }, utility: { area: 5, width: 1.5, depth: 1.5 }, garage: { area: 18, width: 2.8, depth: 5 }, other: { area: 10, width: 2.4, depth: 2.4 } };
const geometryLocks = ['geometry', 'geometry.*', 'elements', 'elements.*', 'position', 'position.*', 'dimensions', 'dimensions.*', 'x', 'y', 'z', 'width', 'depth', 'height', 'rotation', 'hostId', 'levelId'];
const round = (n: number) => Math.round(n * 1000) / 1000;
const area = (r: LayoutRoom) => r.area ?? defaults[r.use].area;
const habitable = (r: LayoutRoom) => !['bathroom', 'utility', 'garage'].includes(r.use);
const locked = (project: Project, e: BimElement) => !e.editable || project.constraints.lockedElementIds.includes(e.id) || project.constraints.lockedProperties.some(key => key === `${e.id}.*` || geometryLocks.some(field => key === `${e.id}.${field}`));
interface Rect {
    x: number;
    y: number;
    width: number;
    depth: number;
}
interface Space extends Rect {
    key: string;
    name: string;
    program?: LayoutRoom;
    levelId: string;
    floor: number;
    circulation: boolean;
    element?: BimElement;
    accessFrom?: string;
    doorId?: string;
}
interface Group {
    root: LayoutRoom;
    bath?: LayoutRoom;
}
interface Zone {
    groups: Group[];
    widths: number[];
    depth: number;
}
interface FloorPlan {
    front: Zone;
    rear: Zone;
    entryCore: boolean;
}
interface Plan {
    plans: FloorPlan[];
    width: number;
    depth: number;
    frontDepth: number;
    rearDepth: number;
    coreWidth: number;
    stairRun: number;
    steps: number;
    turned?: boolean;
    hub?: HubPacking;
}
interface WallLine {
    axis: 'h' | 'v';
    at: number;
    start: number;
    end: number;
    element?: BimElement;
}
function polygonsOverlap(a: Point2[], b: Point2[]): boolean { for (const polygon of [a, b])
    for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length], axis = { x: -(q.y - p.y), y: q.x - p.x }, length = Math.hypot(axis.x, axis.y);
        if (length < EPS)
            continue;
        const aa = a.map(v => (v.x * axis.x + v.y * axis.y) / length), bb = b.map(v => (v.x * axis.x + v.y * axis.y) / length);
        if (Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) <= EPS)
            return false;
    } return true; }
function contained(e: BimElement, frame: LayoutFootprint) { return footprint(e).every(point => { const p = worldToLocal(frame, point); return p.x >= -EPS && p.y >= -EPS && p.x <= frame.width + EPS && p.y <= frame.depth + EPS; }); }
const socialOrder: Record<LayoutUse, number> = { living: 0, dining: 1, kitchen: 2, study: 3, other: 4, utility: 5, bathroom: 6, theater: 7, pool: 8, garage: 9, bedroom: 10 };
function zone(groups: Group[], available: number): Zone | null {
    if (!groups.length)
        return { groups: [], widths: [], depth: 0 };
    const minimum = groups.map(g => Math.max(defaults[g.root.use].width, g.bath ? C + T + 1.5 : 0)), net = available - (groups.length - 1) * T;
    if (net < minimum.reduce((a, b) => a + b, 0) - EPS)
        return null;
    const depthAt = (g: Group, w: number) => Math.max(g.root.use === 'pool' ? 3.5 : defaults[g.root.use].depth, area(g.root) / w) + (g.bath ? T + Math.max(1.5, area(g.bath) / (w - C - T)) : 0);
    const widthsAt = (d: number) => groups.map((g, i) => { if (!g.bath)
        return d < (g.root.use === 'pool' ? 3.5 : defaults[g.root.use].depth) ? Infinity : Math.max(minimum[i], area(g.root) / d); let lo = minimum[i], hi = 60; if (depthAt(g, hi) > d)
        return Infinity; for (let j = 0; j < 28; j++) {
        const mid = (lo + hi) / 2;
        if (depthAt(g, mid) > d)
            lo = mid;
        else
            hi = mid;
    } return hi; });
    let lo = 0, hi = 60;
    if (widthsAt(hi).reduce((a, b) => a + b, 0) > net + EPS)
        return null;
    for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        if (widthsAt(mid).reduce((a, b) => a + b, 0) > net)
            lo = mid;
        else
            hi = mid;
    }
    const widths = widthsAt(hi + 1e-7), weights = groups.map(g => area(g.root) + (g.bath ? area(g.bath) : 0)), extra = Math.max(0, net - widths.reduce((a, b) => a + b, 0)), total = weights.reduce((a, b) => a + b, 0);
    widths.forEach((_, i) => { widths[i] += extra * weights[i] / total; });
    return { groups, widths, depth: Math.max(...groups.map((g, i) => depthAt(g, widths[i]))) };
}
function grouped(rooms: LayoutRoom[], floor: number, assignment: Map<string, number>): {
    front: Group[];
    rear: Group[];
} {
    const roots = rooms.filter(r => r.attachedTo === null && assignment.get(r.key) === floor), groups = roots.map(root => ({ root, bath: rooms.find(r => r.attachedTo === root.key) }));
    let front = groups.filter(g => g.root.use !== 'bedroom' && g.root.use !== 'bathroom'), rear = groups.filter(g => g.root.use === 'bedroom' || g.root.use === 'bathroom');
    if (!rear.length && front.length > 1) {
        const leisure = front.filter(g => ['pool', 'theater', 'garage', 'utility'].includes(g.root.use));
        if (leisure.length && leisure.length < front.length) {
            rear = leisure;
            front = front.filter(g => !leisure.includes(g));
        }
    }
    if (!front.length && rear.length > 1) {
        const ordered = [...rear].sort((a, b) => (area(b.root) + (b.bath ? area(b.bath) : 0)) - (area(a.root) + (a.bath ? area(a.bath) : 0)) || a.root.key.localeCompare(b.root.key));
        front = [];
        rear = [];
        let fa = 0, ra = 0;
        for (const group of ordered) {
            const weight = area(group.root) + (group.bath ? area(group.bath) : 0);
            if (fa < ra) {
                front.push(group);
                fa += weight;
            }
            else {
                rear.push(group);
                ra += weight;
            }
        }
    }
    return { front: front.sort((a, b) => socialOrder[a.root.use] - socialOrder[b.root.use] || rooms.indexOf(a.root) - rooms.indexOf(b.root)), rear: rear.sort((a, b) => socialOrder[a.root.use] - socialOrder[b.root.use] || rooms.indexOf(a.root) - rooms.indexOf(b.root)) };
}
/** Bounded residential zoning with actual shared-boundary access, exterior glazing and coordinated stairs. */
export function previewLayout(project: Project, request: LayoutRequest): LayoutPreview {
    const result: LayoutPreview = { elements: [], issues: [], assumptions: [], footprint: { x: 0, y: 0, width: 0, depth: 0, rotation: 0, levelId: request?.levelId ?? '' }, rooms: [], levels: [], removedElements: [], floors: [], strategy: 'zoned-gallery', connections: [] };
    const fail = (message: string): LayoutPreview => ({ ...result, elements: [], rooms: [], levels: [], removedElements: [], floors: [], connections: [], circulation: undefined, issues: [message] });
    if (!request || !/^[A-Za-z0-9_-]{1,60}$/.test(request.idPrefix ?? ''))
        return fail('Use a stable 1–60 character layout ID prefix.');
    const parsed = layoutSpecSchema.safeParse({ levelId: request.levelId, footprintId: request.footprintId, width: request.width, depth: request.depth, rooms: request.rooms, storeys: request.storeys, floorHeight: request.floorHeight, replaceConcept: request.replaceConcept, variant: request.variant });
    if (!parsed.success)
        return fail('Provide 1–16 named rooms, supported floors/uses, positive areas, 4–60 m dimensions, and a 3–4 m floor height.');
    const input = parsed.data, storeys = input.storeys ?? 1, replacing = input.replaceConcept === true;
    let rise = input.floorHeight ?? 3.2;
    const globals = project.constraints.lockedProperties;
    if (globals.includes('*') || geometryLocks.some(key => globals.includes(key) || globals.includes(`model.${key}`)))
        return fail('Project geometry or required element dimensions are locked.');
    const selected = input.footprintId ? project.elements.find(e => e.id === input.footprintId) : undefined;
    let baseLevelId = input.levelId;
    if (replacing && !selected) {
        const bases = [...new Set(project.elements.filter(e => e.levelId === input.levelId && e.properties.conceptLayout === true && typeof e.properties.layoutBaseLevelId === 'string').map(e => String(e.properties.layoutBaseLevelId)))];
        if (bases.length > 1)
            return fail('Several concept buildings share this level. Select the base footprint to identify which house to replace.');
        if (bases.length === 1)
            baseLevelId = bases[0];
    }
    if (replacing && selected && typeof selected.properties.layoutBaseLevelId === 'string' && selected.properties.layoutBaseLevelId !== selected.levelId)
        return fail('Select the ground/base footprint for a whole-house replan; an upper slab piece is not a new ground floor.');
    const baseLevel = project.levels.find(l => l.id === baseLevelId);
    if (!baseLevel || !Number.isFinite(baseLevel.elevation))
        return fail('Choose an existing building level with a finite elevation.');
    if (input.footprintId && (!selected || selected.kind !== 'slab' || selected.levelId !== baseLevel.id))
        return fail('Select a floor slab on the base level, or clear the selection.');
    if (selected && locked(project, selected))
        return fail('The selected slab is locked or read-only; choose an editable unlocked footprint.');
    if (selected && project.elements.filter(e => e.id === selected.id).length !== 1)
        return fail('The selected slab identifier is duplicated.');
    if (selected && (![selected.x, selected.y, selected.z, selected.width, selected.depth, selected.height, selected.rotation].every(Number.isFinite) || selected.width < 4 || selected.depth < 4 || selected.width > 60 || selected.depth > 60 || selected.height <= 0 || selected.height > 1000 || Math.abs(selected.rotation) > 36000))
        return fail('The selected slab has unsupported dimensions or coordinates.');
    if (selected && ((input.width != null && Math.abs(input.width - selected.width) > .001) || (input.depth != null && Math.abs(input.depth - selected.depth) > .001)))
        return fail('Requested dimensions differ from the selected slab; its exact footprint cannot be enlarged.');
    const keys = new Set(input.rooms.map(r => r.key));
    if (keys.size !== input.rooms.length)
        return fail('Room program keys must be unique.');
    if (keys.has('circulation') || keys.has('outside'))
        return fail('Room keys circulation and outside are reserved for access.');
    const byKey = new Map(input.rooms.map(r => [r.key, r]));
    for (const room of input.rooms) {
        if (storeys === 1 && room.floor === 1)
            return fail(`${room.name}: floor 1 requires two storeys.`);
        if (room.attachedTo !== null) {
            const parent = byKey.get(room.attachedTo);
            if (room.use !== 'bathroom' || !parent || parent.use !== 'bedroom' || parent.attachedTo !== null)
                return fail(`${room.name}: an attached bathroom must reference a primary bedroom.`);
            if (room.floor != null && parent.floor != null && room.floor !== parent.floor)
                return fail(`${room.name}: an ensuite must share its bedroom's floor.`);
        }
    }
    const roots = input.rooms.filter(r => r.attachedTo === null);
    if (!roots.length)
        return fail('Add a primary room to the program.');
    for (const root of roots)
        if (input.rooms.filter(r => r.attachedTo === root.key).length > 1)
            return fail(`${root.name}: at most one attached bathroom is supported in this concept template.`);
    const assignment = new Map<string, number>();
    const commons = roots.filter(r => r.use === 'bathroom'), unservedUpper = roots.some(r => r.use === 'bedroom' && (r.floor ?? 1) === 1 && !input.rooms.some(b => b.attachedTo === r.key)), unservedGround = roots.some(r => r.use === 'bedroom' && r.floor === 0 && !input.rooms.some(b => b.attachedTo === r.key));
    for (const root of roots) {
        const bath = input.rooms.find(r => r.attachedTo === root.key);
        let fallback = storeys === 2 && root.use === 'bedroom' ? 1 : 0;
        if (storeys === 2 && root.use === 'bathroom' && unservedUpper)
            fallback = commons.length > 1 ? (commons.indexOf(root) === 0 ? 0 : 1) : unservedGround ? 0 : 1;
        const floor = root.floor ?? bath?.floor ?? fallback;
        assignment.set(root.key, floor);
        if (bath)
            assignment.set(bath.key, floor);
    }
    const required: ElementKind[] = ['wall', 'door', 'window', 'room', ...(!selected || storeys === 2 ? ['slab' as const] : []), ...(storeys === 2 ? ['stair' as const] : [])], types = new Map(required.map(kind => [kind, project.types.find(t => t.kind === kind && t.approved)]));
    const missing = required.filter(kind => !types.get(kind));
    if (missing.length)
        return fail(`Approve an existing compatible ${missing.join(', ')} component type first. Types and rates are never invented.`);
    if ([...types.values()].some(type => project.types.filter(t => t.id === type!.id).length !== 1))
        return fail('An approved component type identifier is duplicated.');
    if (selected && (project.types.filter(t => t.id === selected.typeId).length !== 1 || !project.types.some(t => t.id === selected.typeId && t.kind === 'slab' && t.approved)))
        return fail('The selected slab needs one unambiguous approved compatible slab type.');
    let anchor = selected;
    if (!anchor && replacing) {
        const candidates = project.elements.filter(e => e.levelId === baseLevel.id && e.kind === 'slab' && e.properties.conceptLayout === true);
        if (candidates.length > 1)
            return fail('Several concept footprints exist. Select the exact base slab for replacement.');
        anchor = candidates[0];
    }
    if (replacing && !anchor)
        return fail('Select the original base slab before replacing this house; no unambiguous concept footprint is available.');
    const anchorFrame = anchor ? { x: anchor.x, y: anchor.y, width: anchor.width, depth: anchor.depth, rotation: anchor.rotation, levelId: baseLevel.id } : undefined;
    const priorConcepts = replacing && anchorFrame ? project.elements.filter(e => e.id !== selected?.id && e.properties.conceptLayout === true && polygonsOverlap(footprint({ ...e, ...anchorFrame }), footprint(e)) && (e.levelId === baseLevel.id || e.properties.layoutBaseLevelId === baseLevel.id)) : [];
    if (replacing && !priorConcepts.length)
        return fail('No prior concept house was found within this base footprint. Use creation mode for an empty site.');
    const baseZ = anchor ? anchor.z + anchor.height : baseLevel.elevation;
    const priorUpperIds = [...new Set(priorConcepts.filter(e => e.properties.floorIndex === 1).map(e => e.levelId))];
    if (priorUpperIds.length > 1)
        return fail('Several upper concept levels are associated with this footprint. Review the source storeys before replanning.');
    if (priorUpperIds.length) {
        const priorUpper = project.levels.find(l => l.id === priorUpperIds[0]);
        if (!priorUpper)
            return fail('The prior upper floor level is missing.');
        const established = priorUpper.elevation - baseZ;
        if (storeys === 1)
            return fail('This existing concept has two storeys. Replan both storeys so upper geometry is not left detached.');
        if (input.floorHeight != null && Math.abs(input.floorHeight - established) > .001)
            return fail(`Changing the established ${round(established)} m floor-to-floor rise requires a separate coordinated level revision. Preserve the existing rise for this replan.`);
        if (established < 3 - EPS || established > 4 + EPS)
            return fail('The existing storey rise lies outside the supported 3–4 m concept range.');
        rise = established;
    }
    let upper: Level | undefined;
    if (storeys === 2) {
        const matching = project.levels.filter(l => l.id !== baseLevel.id && Math.abs(l.elevation - (baseZ + rise)) < .001);
        if (matching.length > 1)
            return fail('More than one existing level matches the upper storey elevation. Resolve the ambiguity.');
        upper = matching[0] ?? { id: `${request.idPrefix}-level-1`, name: 'Upper floor', elevation: baseZ + rise };
        if (!matching.length) {
            if (project.levels.some(l => l.id === upper!.id) || project.levels.length >= 100)
                return fail('The proposed upper level identifier already exists or exceeds the level limit.');
            if (globals.some(k => ['levels', 'levels.*', 'elevation'].includes(k)))
                return fail('Creating the upper level is locked.');
            result.levels = [upper];
        }
    }
    const levelList = upper ? [baseLevel, upper] : [baseLevel], targetIds = new Set(levelList.map(l => l.id));
    const zones = levelList.map((_, i) => grouped(input.rooms, i, assignment)), steps = Math.ceil(rise / .175), stairRun = steps * .27;
    function plan(width: number, explicitDepth: number | null): Plan | null {
        const interior = width - 2 * T, coreWidth = storeys === 2 ? 2 * C + T : 0, plans: FloorPlan[] = [];
        for (let f = 0; f < storeys; f++) {
            const parts = zones[f], entryCore = storeys === 2;
            const core = storeys === 2 ? coreWidth : 0;
            const front = zone(parts.front, interior - core), rear = zone(parts.rear, interior);
            if (!front || !rear)
                return null;
            plans.push({ front, rear, entryCore });
        }
        const frontMin = Math.max(storeys === 2 ? C + stairRun : 0, ...plans.map(p => p.front.depth || (!p.rear.groups.length ? C : 0))), rearMin = Math.max(...plans.map(p => p.rear.depth));
        const frontDepth = Math.max(frontMin, plans.some(p => p.entryCore) && frontMin === 0 ? C : 0), hasRear = rearMin > 0, minimum = 2 * T + frontDepth + C + (frontDepth ? T : 0) + (hasRear ? T + rearMin : 0), depth = explicitDepth ?? Math.max(4, Math.ceil((minimum - EPS) * 10) / 10);
        if (depth < minimum - EPS || depth > 60)
            return null;
        const spare = depth - minimum, front = frontDepth + spare * (hasRear ? .45 : 1), rear = hasRear ? rearMin + spare * .55 : 0;
        return { plans, width, depth, frontDepth: front, rearDepth: rear, coreWidth, stairRun: storeys === 2 ? stairRun : 0, steps };
    }
    const fixedW = selected?.width ?? input.width, fixedD = selected?.depth ?? input.depth;
    let chosen: Plan | null = null, best = Infinity;
    const packedHub = packResidentialHub(input.rooms, assignment, storeys, rise, fixedW, fixedD, input.variant ?? 'balanced');
    if (packedHub) chosen = { plans: [], width: packedHub.width, depth: packedHub.depth, frontDepth: 0, rearDepth: 0, coreWidth: 0, stairRun, steps, turned: packedHub.turned, hub: packedHub };
    for (const w of chosen ? [] : fixedW !== null ? [fixedW] : Array.from({ length: 113 }, (_, i) => 4 + i * .5)) {
        const candidate = plan(w, fixedD);
        if (!candidate)
            continue;
        const aspect = Math.max(w / candidate.depth, candidate.depth / w), score = w * candidate.depth * (1 + .1 * (aspect - 1) ** 2);
        if (score < best) {
            best = score;
            chosen = candidate;
        }
    }
    if (!chosen && fixedW !== null && fixedD !== null) {
        const turned = plan(fixedD, fixedW);
        if (turned)
            chosen = { ...turned, turned: true };
    }
    if (!chosen)
        return fail(`The complete room program does not fit the requested footprint with the proposed residential zones, access and clear dimensions. Reduce the program or choose a larger slab; the slab is not enlarged.`);
    const p = chosen;
    result.strategy = p.hub ? 'compact-hub' : 'zoned-gallery';
    result.footprint = { x: anchor?.x ?? 0, y: anchor?.y ?? 0, width: p.turned ? p.depth : p.width, depth: p.turned ? p.width : p.depth, rotation: anchor?.rotation ?? 0, levelId: baseLevel.id };
    // Generated walls establish the highest physical point (there is no roof).
    // A blank source model cannot supply this future height to a dated worksheet.
    const surveyGround = project.planning?.groundElevation;
    const anticipatedHeight = surveyGround != null && Number.isFinite(surveyGround) ? baseZ + storeys * rise - T - surveyGround : undefined;
    const site = reviewedSiteEnvelope(project, undefined, anticipatedHeight);
    if (site) {
        const { plot, west, east, south, north } = site;
        const usableWidth = plot.width - west - east, usableDepth = plot.depth - south - north;
        if (usableWidth <= 0 || usableDepth <= 0)
            return fail('The entered reviewed yard limits leave no usable plot rectangle. Review the cited site limits before generating a house.');
        if (selected) {
            const points = footprint(selected).map(point => worldToLocal(plot, point));
            if (points.some(point => point.x < -EPS || point.y < -EPS || point.x > plot.width + EPS || point.y > plot.depth + EPS))
                return fail('The exact selected slab lies outside the entered plot boundary. Atelier will not move or resize it; correct the site/slab survey or select a footprint inside the plot.');
            if (points.some(point => point.x < west - EPS || point.y < south - EPS || point.x > plot.width - east + EPS || point.y > plot.depth - north + EPS))
                return fail('The exact selected slab crosses a team-reviewed entered yard limit. Atelier will not move or resize it; revise the selected footprint or review the applicable cited limit before acceptance.');
        } else {
            if (result.footprint.width > usableWidth + EPS || result.footprint.depth > usableDepth + EPS)
                return fail(`The bounded ${round(result.footprint.width)} × ${round(result.footprint.depth)} m house does not fit the entered ${round(usableWidth)} × ${round(usableDepth)} m usable plot frame${site.sourceReviewed ? ' after any reviewed entered yards' : ''}. Choose a smaller programme or another layout, or review the site inputs; the house is not stretched or placed outside the plot.`);
            const position = localToWorld(plot, west + (usableWidth - result.footprint.width) / 2, south + (usableDepth - result.footprint.depth) / 2);
            result.footprint = { ...result.footprint, ...position, rotation: plot.rotation };
        }
    }
    const designOrigin = p.turned ? localToWorld(result.footprint, result.footprint.width, 0) : result.footprint, designFrame = { x: designOrigin.x, y: designOrigin.y, rotation: result.footprint.rotation + (p.turned ? 90 : 0) };
    const oldFrame = anchor ? { x: anchor.x, y: anchor.y, width: anchor.width, depth: anchor.depth, rotation: anchor.rotation, levelId: anchor.levelId } : undefined;
    const removals: BimElement[] = [];
    for (const element of project.elements) {
        if (!targetIds.has(element.levelId) || element.id === selected?.id)
            continue;
        const intersects = polygonsOverlap(footprint({ ...element, ...result.footprint }), footprint(element));
        const inOldCohort = replacing && !selected && oldFrame && polygonsOverlap(footprint({ ...element, ...oldFrame }), footprint(element));
        if (!intersects && !inOldCohort)
            continue;
        if (replacing && !selected && intersects && !inOldCohort)
            return fail(`${element.name}: the new envelope overlaps geometry outside the original house footprint. It cannot be removed as part of this replan.`);
        if (!replacing)
            return fail(`The proposed footprint is occupied by ${element.name}. Enable explicit concept replacement or choose empty floors.`);
        if (element.properties.conceptLayout !== true || element.kind === 'reference' || element.externalId !== undefined || locked(project, element))
            return fail(`${element.name}: overlapping manual, external, reference, locked or read-only geometry cannot be replaced.`);
        if (selected && !contained(element, result.footprint))
            return fail(`${element.name}: prior concept geometry crosses the selected footprint. It cannot be partially removed.`);
        if (!selected && inOldCohort && oldFrame && !contained(element, oldFrame))
            return fail(`${element.name}: prior concept geometry crosses the original footprint. Select and review its full source boundary before replacement.`);
        removals.push(element);
    }
    if (!selected && !replacing && project.elements.some(e => e.levelId === baseLevel.id))
        return fail('Without a selected slab, start on an empty level.');
    const removedIds = new Set(removals.map(e => e.id));
    if (project.elements.some(e => e.hostId && removedIds.has(e.hostId) && !removedIds.has(e.id)))
        return fail('A retained opening depends on a concept wall proposed for removal. Resolve that hosted geometry first.');
    if (replacing && storeys === 1 && anchor?.properties.layoutStoreys === 2)
        return fail('This existing concept has two storeys. Replan both storeys so upper geometry is not left detached.');
    const existing = project.elements.filter(e => !removedIds.has(e.id)), existingIds = new Set(project.elements.map(e => e.id));
    const elements: BimElement[] = [], spaces: Space[] = [], allConnections: LayoutConnection[] = [];
    const create = (suffix: string, kind: ElementKind, name: string, r: Rect, floor: number, height: number, z: number, rotation = 0, properties: BimElement['properties'] = {}): BimElement => { const type = types.get(kind)!, point = localToWorld(designFrame, r.x, r.y), element: BimElement = { id: `${request.idPrefix}-${suffix}`, kind, name, levelId: levelList[floor].id, typeId: type.id, material: type.material, ...point, z, width: r.width, depth: r.depth, height, rotation: ((designFrame.rotation + rotation) % 360 + 360) % 360, editable: true, properties: { conceptLayout: true, conceptGeneration: request.idPrefix, layoutBaseLevelId: baseLevel.id, layoutStoreys: storeys, floorIndex: floor, ...properties } }; elements.push(element); return element; };
    const addSpace = (key: string, name: string, r: Rect, floor: number, program?: LayoutRoom) => { const s: Space = { ...r, key, name, program, levelId: levelList[floor].id, floor, circulation: !program }; spaces.push(s); s.element = create(`space-${key.replaceAll('@', '').replaceAll(':', '-')}`, 'room', name, r, floor, .02, baseZ + floor * rise, 0, { layoutKey: key, use: program?.use ?? 'circulation', ...(program ? { requestedArea: area(program), ...(program.attachedTo ? { attachedTo: program.attachedTo } : {}), ...(['pool', 'garage'].includes(program.use) ? { reservedZone: true } : {}) } : {}) }); return s; };
    const galleryY = T + p.frontDepth + (p.frontDepth ? T : 0), rearY = galleryY + C + T, stairX = p.width - T - C, entryX = stairX - C, opening: Rect = p.hub?.opening ?? { x: stairX, y: T + C, width: C, depth: p.stairRun };
    for (let f = 0; f < storeys; f++) {
        const level = levelList[f], floor: LayoutFloorPreview = { level: { ...level }, footprint: { ...result.footprint, levelId: level.id }, rooms: [] };
        result.floors.push(floor);
        if (f === 0) {
            if (!selected)
                create('floor-0', 'slab', 'Concept ground floor slab', { x: 0, y: 0, width: p.width, depth: p.depth }, f, T, baseZ - T);
        }
        else {
            const tiles: Rect[] = [{ x: 0, y: 0, width: p.width, depth: opening.y }, { x: 0, y: opening.y, width: opening.x, depth: opening.depth }, { x: opening.x + opening.width, y: opening.y, width: p.width - opening.x - opening.width, depth: opening.depth }, { x: 0, y: opening.y + opening.depth, width: p.width, depth: p.depth - opening.y - opening.depth }];
            tiles.filter(r => r.width > .005 && r.depth > .005).forEach((r, i) => create(`floor-1-tile-${i}`, 'slab', 'Upper slab around stair opening ' + (i + 1), r, f, T, baseZ + rise - T, 0, { stairVoid: true }));
        }
        if (p.hub) {
            for (const space of p.hub.spaces.filter(s => s.floor === f)) addSpace(space.key, space.name, space, f, space.program);
            for (const link of p.hub.links.filter(l => l.floor === f && l.kind === 'open')) allConnections.push({ from: link.from, to: link.to, kind: 'open', levelId: level.id });
            continue;
        }
        const gallery = addSpace(f === 0 ? 'circulation' : '@landing-1', f === 0 ? 'Shared distribution gallery' : 'Upper landing and gallery', { x: T, y: galleryY, width: p.width - 2 * T, depth: C }, f);
        const layout = p.plans[f];
        if (layout.entryCore) {
            const x = storeys === 2 ? entryX : p.width - T - C;
            const foyer = addSpace(`@foyer-${f}`, f === 0 ? 'Entrance foyer' : 'Stair-side landing', { x, y: T, width: C, depth: p.frontDepth + (p.frontDepth ? T : 0) }, f);
            allConnections.push({ from: foyer.key, to: gallery.key, levelId: level.id, kind: 'open' });
            if (storeys === 2) {
                const landing = addSpace(`@front-landing-${f}`, f === 0 ? 'Lower stair landing' : 'Upper front landing', { x: stairX, y: T, width: C, depth: C }, f);
                allConnections.push({ from: foyer.key, to: landing.key, levelId: level.id, kind: 'open' });
                const tail = addSpace(`@rear-landing-${f}`, f === 0 ? 'Stair-core connector' : 'Upper stair arrival strip', { x: stairX, y: opening.y + opening.depth, width: C, depth: galleryY - opening.y - opening.depth }, f);
                if (tail.depth >= C - EPS)
                    allConnections.push({ from: foyer.key, to: tail.key, levelId: level.id, kind: 'open' });
                allConnections.push({ from: tail.key, to: gallery.key, levelId: level.id, kind: 'open' });
            }
        }
        for (const [row, z] of [['front', layout.front], ['rear', layout.rear]] as const) {
            const front = row === 'front', rowY = front ? T : rearY, rowD = front ? p.frontDepth : p.rearDepth;
            let x = T;
            for (let i = 0; i < z.groups.length; i++) {
                const g = z.groups[i], w = z.widths[i];
                if (g.bath) {
                    const bathW = w - C - T, bathD = Math.max(1.5, area(g.bath) / bathW), bedD = rowD - T - bathD, bedY = front ? rowY : rowY + bathD + T, bathY = front ? rowY + bedD + T : rowY;
                    addSpace(g.root.key, g.root.name, { x, y: bedY, width: w, depth: bedD }, f, g.root);
                    addSpace(g.bath.key, g.bath.name, { x: x + C + T, y: bathY, width: bathW, depth: bathD }, f, g.bath);
                    const vest = addSpace(`@vest-${g.root.key}`, g.root.name + ' vestibule', { x, y: bathY, width: C, depth: bathD }, f);
                    allConnections.push({ from: gallery.key, to: vest.key, levelId: level.id, kind: 'open' });
                }
                else
                    addSpace(g.root.key, g.root.name, { x, y: rowY, width: w, depth: rowD }, f, g.root);
                x += w + T;
            }
        }
    }
    // Programme rooms define privacy walls; shared circulation interfaces remain open.
    const wallLines = (floor: number): WallLine[] => {
        const raw: WallLine[] = [{ axis: 'h', at: T / 2, start: 0, end: p.width }, { axis: 'h', at: p.depth - T / 2, start: 0, end: p.width }, { axis: 'v', at: T / 2, start: 0, end: p.depth }, { axis: 'v', at: p.width - T / 2, start: 0, end: p.depth }];
        for (const s of spaces.filter(s => s.floor === floor && s.program)) {
            raw.push({ axis: 'h', at: s.y - T / 2, start: Math.max(0, s.x - T), end: Math.min(p.width, s.x + s.width + T) }, { axis: 'h', at: s.y + s.depth + T / 2, start: Math.max(0, s.x - T), end: Math.min(p.width, s.x + s.width + T) }, { axis: 'v', at: s.x - T / 2, start: s.y - T, end: s.y + s.depth + T }, { axis: 'v', at: s.x + s.width + T / 2, start: s.y - T, end: s.y + s.depth + T });
        }
        const merged: WallLine[] = [];
        for (const axis of ['h', 'v'] as const) {
            const coordinates: number[] = [];
            for (const at of raw.filter(l => l.axis === axis).map(l => l.at).sort((a, b) => a - b))
                if (!coordinates.length || Math.abs(coordinates[coordinates.length - 1] - at) > EPS)
                    coordinates.push(at);
            for (const at of coordinates) {
                const lines = raw.filter(l => l.axis === axis && Math.abs(l.at - at) < EPS).sort((a, b) => a.start - b.start);
                for (const line of lines) {
                    const last = merged[merged.length - 1];
                    if (last?.axis === axis && Math.abs(last.at - at) < EPS && line.start <= last.end + EPS)
                        last.end = Math.max(last.end, line.end);
                    else
                        merged.push({ ...line, at });
                }
            }
        }
        // Offset room wings can bring parallel junction strips closer than their thickness.
        // Keep the first strip and trim duplicate projected intervals from later strips.
        const horizontal: WallLine[] = [];
        for (const line of merged.filter(l => l.axis === 'h')) {
            let intervals = [[line.start, line.end]];
            for (const other of horizontal) if (Math.abs(other.at - line.at) < T - EPS)
                intervals = intervals.flatMap(([a, b]) => { if (other.end <= a + EPS || other.start >= b - EPS) return [[a, b]]; return [[a, Math.min(b, other.start)], [Math.max(a, other.end), b]].filter(([x, y]) => y - x > .005); });
            for (const [start, end] of intervals) horizontal.push({ ...line, start, end });
        }
        const output = [...horizontal];
        for (const v of merged.filter(l => l.axis === 'v')) {
            let intervals = [[Math.max(T, v.start), Math.min(p.depth - T, v.end)]];
            for (const h of horizontal)
                if (h.end > v.at - T / 2 + EPS && h.start < v.at + T / 2 - EPS)
                    intervals = intervals.flatMap(([a, b]) => { const c = h.at - T / 2, d = h.at + T / 2; if (d <= a + EPS || c >= b - EPS)
                        return [[a, b]]; return [[a, Math.min(b, c)], [Math.max(a, d), b]].filter(([x, y]) => y - x > .005); });
            for (const [a, b] of intervals)
                if (b - a > .005)
                    output.push({ ...v, start: a, end: b });
        }
        return output;
    };
    const linesByFloor: WallLine[][] = [];
    for (let f = 0; f < storeys; f++) {
        const lines = wallLines(f);
        linesByFloor.push(lines);
        lines.forEach((l, i) => { l.element = create(`wall-${f}-${i}`, 'wall', `Concept ${l.axis === 'h' ? 'horizontal' : 'vertical'} wall ${i + 1}`, l.axis === 'h' ? { x: l.start, y: l.at - T / 2, width: l.end - l.start, depth: T } : { x: l.at + T / 2, y: l.start, width: l.end - l.start, depth: T }, f, rise - T, baseZ + f * rise, l.axis === 'h' ? 0 : 90, { exterior: l.axis === 'h' ? (Math.abs(l.at - T / 2) < .001 || Math.abs(l.at - (p.depth - T / 2)) < .001) : (Math.abs(l.at - T / 2) < .001 || Math.abs(l.at - (p.width - T / 2)) < .001) }); });
    }
    const openings = new Map<string, {
        start: number;
        end: number;
    }[]>();
    const makeOpening = (suffix: string, kind: 'door' | 'window', line: WallLine, start: number, width: number, height: number, sill: number, floor: number, props: BimElement['properties']) => { const host = line.element!, point = localToWorld(host, start - line.start, 0), type = types.get(kind)!, e: BimElement = { id: `${request.idPrefix}-${suffix}`, kind, name: kind === 'door' ? String(props.accessFrom) + ' to ' + String(props.accessTo) : String(props.roomKey) + ' exterior glazing', levelId: levelList[floor].id, typeId: type.id, material: type.material, ...point, z: baseZ + floor * rise + sill, width, depth: T, height, rotation: host.rotation, hostId: host.id, editable: true, properties: { conceptLayout: true, conceptGeneration: request.idPrefix, layoutBaseLevelId: baseLevel.id, layoutStoreys: storeys, floorIndex: floor, ...props } }; elements.push(e); openings.set(host.id, [...(openings.get(host.id) ?? []), { start, end: start + width }]); return e; };
    let doorNumber = 0;
    const connect = (a: Space, b: Space): BimElement | null => {
        let axis: 'h' | 'v', at: number, lo: number, hi: number;
        if (Math.abs(a.y + a.depth + T - b.y) < .002 || Math.abs(b.y + b.depth + T - a.y) < .002) {
            axis = 'h';
            at = a.y < b.y ? a.y + a.depth + T / 2 : b.y + b.depth + T / 2;
            lo = Math.max(a.x, b.x);
            hi = Math.min(a.x + a.width, b.x + b.width);
        }
        else if (Math.abs(a.x + a.width + T - b.x) < .002 || Math.abs(b.x + b.width + T - a.x) < .002) {
            axis = 'v';
            at = a.x < b.x ? a.x + a.width + T / 2 : b.x + b.width + T / 2;
            lo = Math.max(a.y, b.y);
            hi = Math.min(a.y + a.depth, b.y + b.depth);
        }
        else
            return null;
        const width = b.program?.use === 'bathroom' ? .8 : .9, candidates = linesByFloor[a.floor].filter(l => l.axis === axis && Math.abs(l.at - at) < .002).map(line => ({ line, start: Math.max(lo + .12, line.start + .05), end: Math.min(hi - .12, line.end - .05) })).filter(c => c.end - c.start >= width).sort((a, b) => (b.end - b.start) - (a.end - a.start));
        for (const c of candidates) {
            const start = (c.start + c.end - width) / 2;
            if ((openings.get(c.line.element!.id) ?? []).some(o => Math.min(start + width, o.end) - Math.max(start, o.start) > EPS))
                continue;
            const door = makeOpening(`door-${doorNumber++}`, 'door', c.line, start, width, 2.1, 0, a.floor, { accessFrom: a.key, accessTo: b.key });
            allConnections.push({ from: a.key, to: b.key, levelId: a.levelId, kind: 'door', elementId: door.id });
            return door;
        }
        return null;
    };
    for (const link of p.hub?.links.filter(l => l.kind === 'door') ?? []) {
        const from = spaces.find(s => s.floor === link.floor && s.key === link.from)!, to = spaces.find(s => s.floor === link.floor && s.key === link.to)!;
        const door = connect(from, to);
        if (!door) return fail(`${to.name}: no safe shared-boundary doorway fits the hub concept. Review the programme or footprint.`);
        if (to.program) { to.accessFrom = from.key; to.doorId = door.id; }
    }
    for (const s of p.hub ? [] : spaces.filter(s => s.program)) {
        const room = s.program!, gallery = spaces.find(x => x.floor === s.floor && x.key === (s.floor === 0 ? 'circulation' : '@landing-1'))!;
        let from: Space;
        if (room.attachedTo)
            from = spaces.find(x => x.key === room.attachedTo)!;
        else if (input.rooms.some(r => r.attachedTo === room.key))
            from = spaces.find(x => x.key === `@vest-${room.key}`)!;
        else {
            const group = p.plans[s.floor].front.groups, idx = group.findIndex(g => g.root.key === room.key), previous = idx > 0 ? group[idx - 1].root : undefined;
            from = previous && ['dining', 'kitchen'].includes(room.use) && ['living', 'dining'].includes(previous.use) ? spaces.find(x => x.key === previous.key)! : gallery;
        }
        const door = connect(from, s);
        if (!door)
            return fail(`${s.name}: no safe shared-boundary doorway fits. Review the programme or footprint.`);
        s.accessFrom = from.key;
        s.doorId = door.id;
    }
    // A social entry hub is public circulation, never a route through a bedroom.
    const ground = p.plans[0], entrySpace = p.hub ? spaces.find(s => s.floor === 0 && s.key === p.hub!.entryKey)! : ground.entryCore ? spaces.find(s => s.key === '@foyer-0')! : spaces.find(s => s.floor === 0 && s.program && s.y < T + .002 && ['living', 'dining'].includes(s.program.use)) ?? spaces.find(s => s.key === 'circulation')!;
    const sideEntry = !p.hub && entrySpace.key === 'circulation', entryWidth = .9;
    const frontLine = linesByFloor[0].find(l => sideEntry ? l.axis === 'v' && Math.abs(l.at - T / 2) < .002 && l.start <= entrySpace.y + .15 && l.end >= entrySpace.y + C - .15 : l.axis === 'h' && Math.abs(l.at - T / 2) < .002);
    if (!frontLine)
        return fail('No exterior entrance fits the shared foyer.');
    const entryStart = sideEntry ? entrySpace.y + (C - entryWidth) / 2 : entrySpace.x + (entrySpace.width - entryWidth) / 2, entry = makeOpening('door-entry', 'door', frontLine, entryStart, entryWidth, 2.1, 0, 0, { accessFrom: 'outside', accessTo: entrySpace.key });
    if (p.hub && entrySpace.program) { entrySpace.accessFrom = 'outside'; entrySpace.doorId = entry.id; }
    allConnections.push({ from: 'outside', to: entrySpace.key, levelId: baseLevel.id, kind: 'door', elementId: entry.id });
    for (let f = 0; f < storeys; f++) {
        const gallery = spaces.find(s => s.floor === f && s.key === (p.hub ? p.hub.hubKeys[f] : f === 0 ? 'circulation' : '@landing-1'))!;
        result.floors[f].circulation = { elementId: gallery.element!.id, entryDoorId: f === 0 ? entry.id : '', width: C };
    }
    result.circulation = result.floors[0].circulation;
    if (storeys === 2) {
        const lower = spaces.find(s => s.key === (p.hub?.lowerLandingKey ?? '@front-landing-0'))!, upperLanding = spaces.find(s => s.floor === 1 && s.key === (p.hub?.upperLandingKey ?? '@rear-landing-1'))!;
        const stair = create('stair-0-1', 'stair', 'Coordinated straight stair', opening, 0, rise, baseZ, 0, { fromLevelId: baseLevel.id, toLevelId: upper!.id, floorHeight: rise, steps: p.steps, riser: rise / p.steps, tread: p.stairRun / p.steps, run: p.stairRun, openingX: opening.x, openingY: opening.y, openingWidth: opening.width, openingDepth: opening.depth, openingRotation: designFrame.rotation, lowerLandingId: lower.element!.id, upperLandingId: upperLanding.element!.id, upperLandingClearDepth: p.hub?.upperLandingClearDepth ?? upperLanding.depth + C });
        allConnections.push({ from: lower.key, to: upperLanding.key, levelId: baseLevel.id, kind: 'stair', elementId: stair.id });
    }
    let daylightCount = 0, habitableCount = 0;
    for (const s of spaces.filter(s => s.program)) {
        const room = s.program!, isHabitable = habitable(room), target = s.width * s.depth * (isHabitable ? GLAZING : .04), windowIds: string[] = [];
        let glazing = 0;
        if (isHabitable)
            habitableCount++;
        const faces: {
            axis: 'h' | 'v';
            at: number;
            start: number;
            end: number;
        }[] = [];
        if (s.y < T + .002)
            faces.push({ axis: 'h', at: T / 2, start: s.x, end: s.x + s.width });
        if (s.y + s.depth > p.depth - T - .002)
            faces.push({ axis: 'h', at: p.depth - T / 2, start: s.x, end: s.x + s.width });
        if (s.x < T + .002)
            faces.push({ axis: 'v', at: T / 2, start: s.y, end: s.y + s.depth });
        if (s.x + s.width > p.width - T - .002)
            faces.push({ axis: 'v', at: p.width - T / 2, start: s.y, end: s.y + s.depth });
        const dual = room.use === 'living' && faces.length > 1, desiredFaces = dual ? faces.slice(0, 2) : faces.slice(0, 1);
        for (const face of desiredFaces) {
            const height = room.use === 'bathroom' ? .6 : 1.5, sill = room.use === 'bathroom' ? 1.6 : .8;
            let remaining = target / desiredFaces.length;
            const candidates = linesByFloor[s.floor].filter(l => l.axis === face.axis && Math.abs(l.at - face.at) < .002).flatMap(line => { let free = [[Math.max(face.start + .25, line.start + .05), Math.min(face.end - .25, line.end - .05)]]; for (const occupied of openings.get(line.element!.id) ?? [])
                free = free.flatMap(([a, b]) => [[a, Math.min(b, occupied.start - .15)], [Math.max(a, occupied.end + .15), b]].filter(([x, y]) => y - x > .35)); return free.map(([a, b]) => ({ line, a, b })); }).sort((a, b) => (b.b - b.a) - (a.b - a.a));
            for (const c of candidates) {
                if (remaining <= .01)
                    break;
                const width = Math.min(c.b - c.a, Math.max(.4, remaining / height));
                if (width < .4)
                    continue;
                const start = (c.a + c.b - width) / 2, e = makeOpening(`window-${room.key}-${windowIds.length}`, 'window', c.line, start, width, height, sill, s.floor, { roomKey: room.key, privacy: room.use === 'bathroom', glazingTargetRatio: isHabitable ? GLAZING : .04 });
                windowIds.push(e.id);
                glazing += width * height;
                remaining -= width * height;
            }
        }
        if (isHabitable && windowIds.length)
            daylightCount++;
        if (isHabitable && glazing + EPS < target)
            result.assumptions.push(`${s.name}: concept glazing ${round(glazing)} m² is below the 15% floor-area target ${round(target)} m² because usable exterior wall is limited; review orientation, openings and daylight professionally.`);
        if (!windowIds.length)
            result.assumptions.push(`${s.name}: no direct exterior glazing; ventilation/daylight provision remains unresolved.`);
        s.element!.properties = { ...s.element!.properties, accessFrom: s.accessFrom!, daylight: windowIds.length ? 'exterior-window' : 'none' };
        const metadata: LayoutRoomResult = { key: room.key, elementId: s.element!.id, name: room.name, use: room.use, requestedArea: area(room), area: round(s.width * s.depth), attachedTo: room.attachedTo, accessFrom: s.accessFrom!, doorId: s.doorId!, dimensions: { width: round(s.width), depth: round(s.depth) }, levelId: s.levelId, windowIds, daylight: windowIds.length ? 'exterior-window' : 'none' };
        result.rooms.push(metadata);
        result.floors[s.floor].rooms.push(metadata);
    }
    const ids = new Set<string>();
    if (elements.some(e => existingIds.has(e.id) || ids.has(e.id) ? true : (ids.add(e.id), false)))
        return fail('A generated element identifier already exists. Use a new layout prefix.');
    if (elements.length > 200 || existing.length + elements.length > 10000)
        return fail('Layout exceeds the 200-creation or 10,000-project-element limit.');
    if (elements.some(e => [e.x, e.y, e.z].some(v => !Number.isFinite(v) || Math.abs(v) > 1e7)))
        return fail('Layout exceeds the supported coordinate range.');
    const physical = new Set<ElementKind>(['wall', 'slab', 'stair', 'roof']);
    for (const retained of existing.filter(e => !targetIds.has(e.levelId) && e.kind !== 'room')) {
        for (const proposed of elements.filter(e => physical.has(e.kind))) {
            const zOverlap = Math.min(retained.z + retained.height, proposed.z + proposed.height) - Math.max(retained.z, proposed.z);
            if (zOverlap > EPS && polygonsOverlap(footprint(retained), footprint(proposed)))
                return fail(`${retained.name}: retained geometry on another level physically intersects the proposed house. Resolve the storey/geometry conflict before creating the layout.`);
        }
    }
    const geometry = validateModelGeometry({ ...project, levels: [...project.levels, ...result.levels], elements: [...existing, ...elements] }).filter(issue => issue.severity === 'error' && issue.elementIds.some(id => ids.has(id)));
    if (geometry.length)
        return fail(`Generated geometry requires correction: ${[...new Set(geometry.map(i => i.message))].join(' ')}`);
    result.elements = elements;
    result.removedElements = structuredClone(removals);
    result.connections = allConnections;
    const circulationArea = spaces.filter(s => s.circulation).reduce((n, s) => n + s.width * s.depth, 0), programmeArea = spaces.filter(s => s.program).reduce((n, s) => n + s.width * s.depth, 0);
    const hubs = p.hub ? spaces.filter(s => p.hub!.hubKeys[s.floor] === s.key) : [], branches = spaces.filter(s => s.circulation && !hubs.includes(s));
    result.metrics = { circulationArea: round(circulationArea), programmeArea: round(programmeArea), circulationRatio: round(circulationArea / (circulationArea + programmeArea)), daylightRooms: daylightCount, habitableRooms: habitableCount, glazingTargetRatio: GLAZING, hubArea: round(hubs.reduce((n, s) => n + s.width * s.depth, 0)), longestAccessBranch: round(Math.max(0, ...branches.map(s => Math.max(s.width, s.depth)))) };
    result.quality = assessLayoutQuality(result);
    if (spaces.some(s => s.key.startsWith('@service-access-'))) result.assumptions.push('Small service rooms use bounded rectangular targets. Residual aligned bay area is modelled explicitly as shared service access alcoves and included in circulation; it is not silently added to a WC/laundry or omitted from efficiency measurements. Review any excessive access area before detailing.');
    if (input.variant === 'daylight') result.assumptions.push('The daylight alternative ranks a finite set of exterior-face and room-proportion proxies. It does not evaluate compass orientation, solar access, illuminance, climate, obstructions or legal daylight requirements, and may use a larger footprint.');
    if (site) result.assumptions.push(selected ? 'The selected slab retains its exact surveyed geometry and has been checked against the entered rectangular plot and any team-reviewed cited yard limits. Other legal requirements remain separate preliminary checks.' : 'The bounded concept envelope is centred inside the usable entered rectangular plot frame and aligned to its rotation. House dimensions are retained rather than stretched to fill the plot. Replanning may relocate the reviewed concept cohort; retained/manual geometry is never moved. Plot containment is geometric only; only team-reviewed cited entered yard limits reduce this frame. Road access, true north, Vaastu preferences and all other local requirements still require their separate checks.');
    if (site && !site.sourceReviewed) result.assumptions.push('The rule source or its applicability is unconfirmed, incomplete, stale or unsupported: no yard limits were inferred or applied. Only the entered physical plot boundary constrained placement.');
    if (site && project.planning?.ruleSource.worksheet === 'kerala-a1-2025' && anticipatedHeight === undefined) result.assumptions.push('The dated Kerala worksheet height applicability remains unresolved without an entered survey ground elevation. Its yard values are not applied to generation.');
    if (site && project.planning?.ruleSource.worksheet === 'kerala-a1-2025' && anticipatedHeight !== undefined && anticipatedHeight > 10) result.assumptions.push(`The proposed model-envelope height of ${round(anticipatedHeight)} m exceeds the dated Kerala worksheet's 10 m applicability threshold. Its yard values are not applied; this threshold is not a universal legal height limit.`);
    result.assumptions.unshift(p.hub ? 'Compact hub concept: perimeter room wings meet a shared foyer or requested living/dining hub on multiple sides. Entrance and stair access use separate perpendicular branches, not a full-width gallery. No unrequested programme rooms are added; automatic foyers and landings are circulation only.' : 'Zoned gallery fallback: the bounded compact-hub candidates did not fit this programme/footprint. A full-width distribution gallery remains; this is a corridor-based concept requiring architect review, not a corridor-free or optimized house design.', 'Room areas are minimum net planning targets. Spare footprint area may enlarge rooms; exact dimensions and areas are listed. Walls are 0.20 m and clear shared circulation is 1.20 m as proposed concept dimensions, not code-certified minima.', 'Exterior glazing targets 15% of habitable room floor area; corner living rooms use two aspects where available. This is an opening-area proxy, not solar/daylight simulation. Site orientation, obstructions, privacy, climate and local requirements are unknown.', 'No roof, foundation engineering, detailed MEP, ventilation, permits or specialist construction costs are generated. Approved existing component types/rates are reused without filling unknown costs.');
    result.assumptions.push('Dedicated circulation metrics count automatic foyer, landing and access-branch rooms only. Access paths within requested living/dining rooms remain in programme area; a zero dedicated-circulation share does not mean zero circulation space. Hub area may include a requested social room, and longest branch excludes the primary shared hub. These measurements are not optimality, cost or efficiency guarantees.');
    const kitchenServices = result.rooms.filter(r => r.use === 'utility' && result.rooms.some(k => k.key === r.accessFrom && k.use === 'kitchen'));
    if (kitchenServices.length) result.assumptions.push(`Requested service clustering: ${kitchenServices.map(r => r.name).join(', ')} retains its own room/area and is reached directly from the requested kitchen. It is not a shared through-route; review service access and ventilation professionally.`);
    if (storeys === 2)
        result.assumptions.push(`Two storeys use ${rise} m floor-to-floor rise, ${p.steps} concept risers of ${round(rise / p.steps)} m and ${round(p.stairRun / p.steps)} m treads. Upper slabs are split around the actual stair footprint. Guardrails, headroom, landings, structural support and stair/egress compliance require professional design; none are certified here.`);
    if (input.rooms.some(r => r.use === 'pool'))
        result.assumptions.push('Pool is a reserved room zone only. Basin, excavation, structural, hydraulic, waterproofing, safety and MEP design are excluded; add an explicit unpriced specialist allowance.');
    if (input.rooms.some(r => r.use === 'garage'))
        result.assumptions.push('Garage is a reserved room zone with pedestrian access only; vehicle opening, ramps and turning/access design are excluded.');
    if (selected)
        result.assumptions.push('The selected slab is retained unchanged, including its exact position, rotation and dimensions.');
    if (sideEntry)
        result.assumptions.push('A side entrance is proposed directly into the shared entry gallery; plot access, orientation and entrance privacy need architect review.');
    if (p.turned)
        result.assumptions.push('Internal residential zoning is turned 90 degrees within the unchanged footprint to fit the full programme. The selected slab itself is not rotated or resized.');
    if (Math.abs(baseZ - baseLevel.elevation) > .001)
        result.assumptions.push(`Ground geometry follows the retained slab top at ${round(baseZ)} m; the base level datum is ${round(baseLevel.elevation)} m. Review this elevation offset.`);
    if (replacing)
        result.assumptions.push(`Replacement is explicit: ${removals.length} unlocked editable concept elements are proposed for removal. Manual, external, reference and locked elements are retained and block overlap.`);
    return result;
}
