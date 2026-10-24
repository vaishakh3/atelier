import type { LayoutRoom, LayoutUse } from './types';

/** Detached rectangular packing. It chooses room adjacencies, not structural or code solutions. */
export interface PackingRect { x: number; y: number; width: number; depth: number }
export interface PackedSpace extends PackingRect {
    key: string;
    name: string;
    floor: number;
    program?: LayoutRoom;
}
export interface PackedLink { from: string; to: string; floor: number; kind: 'door' | 'open' }
export interface HubPacking {
    width: number;
    depth: number;
    turned?: boolean;
    spaces: PackedSpace[];
    links: PackedLink[];
    hubKeys: string[];
    entryKey: string;
    opening?: PackingRect;
    lowerLandingKey?: string;
    upperLandingKey?: string;
    upperLandingClearDepth?: number;
}
interface Group { root: LayoutRoom; bath?: LayoutRoom }
interface Recipe {
    social?: Group;
    front?: Group;
    rear?: Group;
    left: Group[];
    right: Group[];
}
interface SizedRecipe { recipe: Recipe; leftWidth: number; rightWidth: number; centerWidth: number; front: number; rear: number; fronts: number[]; rears: number[]; score: number }
const T = .2, C = 1.2, HUB_DEPTH = 2.8, DOOR_FACE = 1.2, EPS = 1e-6;
const uses: Record<LayoutUse, { area: number; width: number; depth: number }> = {
    bedroom: { area: 14, width: 2.7, depth: 2.7 }, bathroom: { area: 4.5, width: 1.5, depth: 1.5 },
    living: { area: 20, width: 3.2, depth: 3.2 }, kitchen: { area: 10, width: 2.4, depth: 2.4 },
    dining: { area: 12, width: 2.7, depth: 2.7 }, theater: { area: 16, width: 3, depth: 3 },
    pool: { area: 24, width: 3.5, depth: 3.5 }, study: { area: 9, width: 2.4, depth: 2.4 },
    utility: { area: 5, width: 1.5, depth: 1.5 }, garage: { area: 18, width: 2.8, depth: 5 },
    other: { area: 10, width: 2.4, depth: 2.4 },
};
const area = (room: LayoutRoom) => room.area ?? uses[room.use].area;
function height(group: Group | undefined, width: number): number {
    if (!group) return 0;
    if (width < uses[group.root.use].width - EPS || group.bath && width < 1.5 - EPS) return Infinity;
    const root = Math.max(uses[group.root.use].depth, area(group.root) / width);
    return root + (group.bath ? T + Math.max(1.5, area(group.bath) / width) : 0);
}
function rearHeight(group: Group | undefined, width: number): number {
    if (!group?.bath) return height(group, width);
    const bedroomWidth = width - T - 1.5;
    if (bedroomWidth < uses[group.root.use].width - EPS) return Infinity;
    return Math.max(uses[group.root.use].depth, area(group.root) / bedroomWidth, 1.5, area(group.bath) / 1.5);
}
function permutations<T>(values: T[]): T[][] {
    if (values.length < 2) return [values];
    return values.flatMap((value, i) => permutations(values.filter((_, j) => j !== i)).map(rest => [value, ...rest]));
}
function recipes(rooms: LayoutRoom[], floor: number, assignment: Map<string, number>, storeys: number): Recipe[] {
    const groups = rooms.filter(r => r.attachedTo === null && assignment.get(r.key) === floor).map(root => ({ root, bath: rooms.find(r => r.attachedTo === root.key) }));
    if (groups.length < 2 || groups.length > 6) return [];
    const social = groups.find(g => g.root.use === 'living') ?? groups.find(g => g.root.use === 'dining');
    // A programme-room wall at the upper stair arrival needs a different landing topology.
    // Retain the validated gallery fallback for this explicit uncommon programme.
    if (floor === 1 && social) return [];
    const remaining = groups.filter(g => g !== social), result: Recipe[] = [];
    // Public living/dining is the actual social hub. Without it a foyer is circulation only.
    const rearChoices = social && storeys === 2 ? [undefined] : [...remaining].sort((a, b) => {
        const priority = (g: Group) => social && g.root.use === 'dining' ? -5 : g.root.use === 'pool' ? -3 : -uses[g.root.use].width;
        return priority(a) - priority(b) || a.root.key.localeCompare(b.root.key);
    }).slice(0, 4);
    for (const rear of rearChoices) {
        const rest = remaining.filter(g => g !== rear);
        const frontChoices = social || storeys === 2 ? [undefined] : rest.length > 4 ? rest : [undefined, ...rest];
        for (const front of frontChoices) {
            const sides = rest.filter(g => g !== front);
            if (sides.length < 2 || sides.length > 4) continue;
            for (const order of permutations(sides)) {
                const left = order.length === 2 ? [order[0]] : [order[0], order[2]], right = order.length === 2 ? [order[1]] : order.length === 3 ? [order[1]] : [order[1], order[3]];
                result.push({ social, front, rear, left, right });
            }
        }
    }
    return result;
}
function sized(recipe: Recipe, width: number, center: number, ratio: number, storeys: number): SizedRecipe | null {
    const sideTotal = width - 2 * T - center - 2 * T;
    const lw = sideTotal * ratio, rw = sideTotal - lw;
    const fronts = [height(recipe.left[0], lw), height(recipe.right[0], rw)], rears = [height(recipe.left[1], lw), height(recipe.right[1], rw)];
    if (recipe.front?.bath) return null;
    const front = storeys === 2 || recipe.social ? 0 : height(recipe.front, center - C - T), rear = rearHeight(recipe.rear, center);
    if (![...fronts, ...rears, front, rear].every(Number.isFinite) || recipe.social && center < uses[recipe.social.root.use].width) return null;
    // Prefer private rear wings and a shared living/dining/kitchen social chain.
    let penalty = 0;
    for (const side of [recipe.left, recipe.right]) {
        if (side.length > 1 && side[0].root.use === 'bedroom' && side[1].root.use !== 'bedroom') penalty += 3;
        if (side.length > 1 && side[0].root.use === 'pool' && side[1].root.use === 'bedroom') penalty += 1;
    }
    if (recipe.social?.root.use === 'living' && recipe.rear?.root.use === 'dining') penalty -= 3;
    return { recipe, leftWidth: lw, rightWidth: rw, centerWidth: center, fronts, rears, front, rear, score: fronts.reduce((a, b) => a + b, 0) + rears.reduce((a, b) => a + b, 0) + front + rear + penalty };
}
function adjacent(a: PackingRect, b: PackingRect): boolean {
    const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
    return (Math.abs(a.x + a.width + T - b.x) < .002 || Math.abs(b.x + b.width + T - a.x) < .002) && overlapY >= DOOR_FACE - EPS ||
        (Math.abs(a.y + a.depth + T - b.y) < .002 || Math.abs(b.y + b.depth + T - a.y) < .002) && overlapX >= DOOR_FACE - EPS;
}
function build(width: number, depth: number, center: number, selections: SizedRecipe[], hubY: number, storeys: number, stairRun: number): HubPacking | null {
    const spaces: PackedSpace[] = [], links: PackedLink[] = [], hubKeys: string[] = [], opening = storeys === 2 ? { x: T + selections[0].leftWidth + T + center - C, y: T + C, width: C, depth: stairRun } : undefined;
    const add = (key: string, name: string, rect: PackingRect, floor: number, program?: LayoutRoom) => { const s = { key, name, ...rect, floor, ...(program ? { program } : {}) }; spaces.push(s); return s; };
    let entryKey = '', lowerLandingKey: string | undefined, upperLandingKey: string | undefined;
    for (let floor = 0; floor < selections.length; floor++) {
        const selected = selections[floor], recipe = selected.recipe, centerX = T + selected.leftWidth + T, socialFront = !!recipe.social && storeys === 1;
        const hubKey = recipe.social?.root.key ?? (floor === 0 ? 'circulation' : '@landing-1');
        const hub = add(hubKey, recipe.social?.root.name ?? (floor === 0 ? 'Shared entrance foyer' : 'Shared upper landing'), {
            x: centerX, y: socialFront ? T : hubY + (recipe.social ? T : 0), width: center,
            depth: recipe.social ? socialFront ? hubY + HUB_DEPTH - T : depth - 2 * T - hubY : HUB_DEPTH,
        }, floor, recipe.social?.root);
        hubKeys.push(hubKey);
        if (recipe.social && (hub.depth < uses[recipe.social.root.use].depth - EPS || hub.width * hub.depth < area(recipe.social.root) - EPS)) return null;
        if (socialFront) { if (floor === 0) entryKey = hubKey; }
        else {
            const foyerWidth = storeys === 2 ? center - C : recipe.front ? C : center;
            const foyer = add(`@foyer-${floor}`, floor === 0 ? 'Entrance branch' : 'Stair-side access branch', { x: centerX, y: T, width: foyerWidth, depth: hubY - T }, floor);
            if (floor === 0) entryKey = foyer.key;
            links.push({ from: foyer.key, to: hub.key, floor, kind: recipe.social ? 'door' : 'open' });
            if (storeys === 2) {
                const landing = add(`@front-landing-${floor}`, floor === 0 ? 'Lower stair landing' : 'Upper front landing', { x: opening!.x, y: T, width: C, depth: C }, floor);
                links.push({ from: foyer.key, to: landing.key, floor, kind: 'open' });
                if (floor === 0) lowerLandingKey = landing.key;
                if (floor === 1) upperLandingKey = hub.key;
            }
        }
        function group(group: Group, box: PackingRect, outer: 'front' | 'rear'): boolean {
            if (height(group, box.width) > box.depth + EPS) return false;
            if (!group.bath) { add(group.root.key, group.root.name, box, floor, group.root); return true; }
            // The bath is at the exterior end; the bedroom meets the shared hub directly.
            const bathDepth = Math.max(1.5, area(group.bath) / box.width), bathY = outer === 'front' ? box.y : box.y + box.depth - bathDepth;
            const bed = add(group.root.key, group.root.name, { ...box, y: outer === 'front' ? box.y + bathDepth + T : box.y, depth: box.depth - bathDepth - T }, floor, group.root);
            add(group.bath.key, group.bath.name, { ...box, y: bathY, depth: bathDepth }, floor, group.bath);
            if (!adjacent(hub, bed)) return false;
            links.push({ from: group.root.key, to: group.bath.key, floor, kind: 'door' });
            return true;
        }
        for (const [i, side] of [recipe.left, recipe.right].entries()) {
            const wingWidth = i === 0 ? selected.leftWidth : selected.rightWidth, x = i === 0 ? T : centerX + center + T;
            if (side.length === 1) {
                if (!group(side[0], { x, y: T, width: wingWidth, depth: depth - 2 * T }, 'front')) return null;
            } else {
                const minimum = Math.max(T + selected.fronts[i] + T / 2, hub.y + DOOR_FACE + T / 2), maximum = Math.min(depth - T - selected.rears[i] - T / 2, hub.y + hub.depth - DOOR_FACE - T / 2);
                if (maximum < minimum - EPS) return null;
                const split = Math.max(minimum, Math.min(maximum, (depth + selected.fronts[i] - selected.rears[i]) / 2));
                if (!group(side[0], { x, y: T, width: wingWidth, depth: split - T / 2 - T }, 'front') || !group(side[1], { x, y: split + T / 2, width: wingWidth, depth: depth - T - split - T / 2 }, 'rear')) return null;
            }
        }
        if (recipe.front && !group(recipe.front, { x: centerX + C + T, y: T, width: center - C - T, depth: hubY - 2 * T }, 'front')) return null;
        if (recipe.rear) {
            const box = { x: centerX, y: hubY + HUB_DEPTH + T, width: center, depth: depth - T - hubY - HUB_DEPTH - T };
            if (recipe.rear.bath) {
                if (rearHeight(recipe.rear, center) > box.depth + EPS) return null;
                add(recipe.rear.root.key, recipe.rear.root.name, { ...box, width: center - T - 1.5 }, floor, recipe.rear.root);
                add(recipe.rear.bath.key, recipe.rear.bath.name, { ...box, x: box.x + center - 1.5, width: 1.5 }, floor, recipe.rear.bath);
                links.push({ from: recipe.rear.root.key, to: recipe.rear.bath.key, floor, kind: 'door' });
            } else if (!group(recipe.rear, box, 'rear')) return null;
        }
        const roomSpaces = spaces.filter(s => s.floor === floor && s.program && s.program.attachedTo === null);
        const dining = roomSpaces.find(s => s.program?.use === 'dining');
        for (const space of roomSpaces) {
            if (space.key === hub.key) continue;
            if (space.program!.use === 'kitchen' && dining && dining.key !== space.key && !adjacent(dining, space)) return null;
            const from = space.program!.use === 'kitchen' && dining && dining.key !== space.key && adjacent(dining, space) ? dining : hub;
            if (!adjacent(from, space)) return null;
            links.push({ from: from.key, to: space.key, floor, kind: 'door' });
        }
    }
    return { width, depth, spaces, links, hubKeys, entryKey, opening, lowerLandingKey, upperLandingKey, upperLandingClearDepth: HUB_DEPTH };
}
/** Finite radial candidates; a feasible hub is preferred independently of the gallery's floor area. */
export function packResidentialHub(rooms: LayoutRoom[], assignment: Map<string, number>, storeys: number, rise: number, fixedWidth: number | null, fixedDepth: number | null): HubPacking | null {
    return searchHub(rooms, assignment, storeys, rise, fixedWidth, fixedDepth, true);
}
function searchHub(rooms: LayoutRoom[], assignment: Map<string, number>, storeys: number, rise: number, fixedWidth: number | null, fixedDepth: number | null, allowTurn: boolean): HubPacking | null {
    const allRecipes = Array.from({ length: storeys }, (_, floor) => recipes(rooms, floor, assignment, storeys));
    if (allRecipes.some(r => !r.length)) return null;
    const stairRun = Math.ceil(rise / .175) * .27;
    let best: HubPacking | null = null, bestScore = Infinity;
    const widths = fixedWidth !== null ? [fixedWidth] : Array.from({ length: 33 }, (_, i) => 8 + i * .5);
    for (const width of widths) for (const center of [2.8, 3.2, 3.6, 3.8, 4.2, 4.6, 5]) for (const ratio of [.5, .44, .56]) {
        const options = allRecipes.map(floor => floor.map(recipe => sized(recipe, width, center, ratio, storeys)).filter((s): s is SizedRecipe => s !== null).sort((a, b) => a.score - b.score).slice(0, 6));
        if (options.some(o => !o.length)) continue;
        const combinations = storeys === 1 ? options[0].map(a => [a]) : options[0].flatMap(a => options[1].map(b => [a, b]));
        for (const selections of combinations) {
            const socialFront = storeys === 1 && !!selections[0].recipe.social;
            const hubY = storeys === 2 ? T + C + stairRun : Math.max(T + C, ...selections.map(s => T + s.front + (s.recipe.front ? T : 0)), ...selections.flatMap(s => s.fronts.map((height, i) => s.rears[i] ? T + height + T + DOOR_FACE - HUB_DEPTH : 0)), socialFront ? T + Math.max(uses[selections[0].recipe.social!.root.use].depth, area(selections[0].recipe.social!.root) / center) - HUB_DEPTH : 0);
            let minimumDepth = hubY + HUB_DEPTH + T;
            for (const selected of selections) {
                if (selected.recipe.rear) minimumDepth = Math.max(minimumDepth, hubY + HUB_DEPTH + T + selected.rear + T);
                if (selected.recipe.social && storeys === 2) minimumDepth = Math.max(minimumDepth, hubY + Math.max(uses[selected.recipe.social.root.use].depth, area(selected.recipe.social.root) / center) + 2 * T);
                for (let i = 0; i < 2; i++) if (selected.rears[i]) minimumDepth = Math.max(minimumDepth, Math.max(T + selected.fronts[i] + T / 2, (socialFront ? T : hubY) + DOOR_FACE + T / 2) + selected.rears[i] + 1.5 * T);
                else minimumDepth = Math.max(minimumDepth, selected.fronts[i] + 2 * T);
            }
            const depth = fixedDepth ?? Math.ceil((minimumDepth - EPS) * 10) / 10;
            if (depth < minimumDepth - EPS || depth > 60) continue;
            const candidate = build(width, depth, center, selections, hubY, storeys, stairRun);
            if (!candidate) continue;
            const aspect = Math.max(width / depth, depth / width), requested = rooms.reduce((n, r) => n + area(r), 0), net = candidate.spaces.filter(s => s.program).reduce((n, s) => n + s.width * s.depth, 0), circulation = candidate.spaces.filter(s => !s.program).reduce((n, s) => n + s.width * s.depth, 0);
            // Excess room area and circulation are visible costs, never a claim of design optimality.
            const score = width * depth * (1 + .1 * (aspect - 1) ** 2) + (net - requested) * .2 + circulation * .5 + selections.reduce((n, s) => n + s.score, 0) * .15;
            if (score < bestScore) { best = candidate; bestScore = score; }
        }
    }
    if (!best && allowTurn && fixedWidth !== null && fixedDepth !== null && fixedWidth !== fixedDepth) {
        const turned = searchHub(rooms, assignment, storeys, rise, fixedDepth, fixedWidth, false);
        if (turned) best = { ...turned, turned: true };
    }
    return best;
}
