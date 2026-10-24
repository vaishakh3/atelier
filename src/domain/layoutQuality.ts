import type { LayoutPreview } from './layout';
import type { LayoutUse } from './types';

export interface LayoutRoomAssessment {
    key: string;
    name: string;
    use: LayoutUse;
    area: number;
    targetArea: number;
    recommendedMaxArea: number;
    aspectRatio: number;
    fitEnvelope: { width: number; depth: number; rotated: boolean; fits: boolean; description: string };
    status: 'within-guide' | 'review';
    messages: string[];
}
export interface LayoutRelationshipAssessment {
    kind: 'ensuite-access' | 'kitchen-dining' | 'service-access' | 'privacy';
    status: 'supported' | 'review';
    roomKeys: string[];
    message: string;
}
export interface LayoutQualityAssessment {
    rooms: LayoutRoomAssessment[];
    relationships: LayoutRelationshipAssessment[];
    totalExcessArea: number;
    reviewCount: number;
    circulationReview: boolean;
    scope: string[];
}
const guides: Record<LayoutUse, { max: number; width: number; depth: number; description: string }> = {
    bedroom: { max: 24, width: 2.8, depth: 3.4, description: 'Double-bed planning rectangle with assumed side/foot and wardrobe allowance' },
    bathroom: { max: 7, width: 1.5, depth: 2.4, description: 'Compact sanitary-fixture planning rectangle; fixture positions are unresolved' },
    living: { max: 36, width: 3.2, depth: 3.6, description: 'Seating-group planning rectangle with an assumed access allowance' },
    kitchen: { max: 18, width: 2.4, depth: 3, description: 'Two 0.6 m counter bands and a 1.2 m assumed aisle, over 3 m length' },
    dining: { max: 24, width: 2.7, depth: 3.2, description: '0.9 × 1.4 m table rectangle with 0.9 m assumed surrounding allowance' },
    theater: { max: 30, width: 3, depth: 3.5, description: 'Small seating/screen planning rectangle; sightlines and acoustics unresolved' },
    pool: { max: 48, width: 3.5, depth: 4.5, description: 'Reserved pool-zone rectangle only; basin, deck and safety clearance unresolved' },
    study: { max: 16, width: 2.4, depth: 2.4, description: 'Desk/storage planning rectangle with assumed access allowance' },
    utility: { max: 8, width: 1.5, depth: 2.2, description: 'Service-counter/appliance planning rectangle with assumed access allowance' },
    garage: { max: 30, width: 2.8, depth: 5, description: 'Reserved single-vehicle rectangle only; vehicle access and turning unresolved' },
    other: { max: 20, width: 2.4, depth: 2.4, description: 'Generic planning rectangle; a use-specific furniture brief is required' },
};
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Non-regulatory design heuristics over actual generated room rectangles. */
export function assessLayoutQuality(preview: Pick<LayoutPreview, 'rooms' | 'connections' | 'metrics'>): LayoutQualityAssessment {
    const rooms: LayoutRoomAssessment[] = preview.rooms.map(room => {
        const guide = guides[room.use], width = room.dimensions.width, depth = room.dimensions.depth;
        const direct = width + .001 >= guide.width && depth + .001 >= guide.depth, rotated = !direct && width + .001 >= guide.depth && depth + .001 >= guide.width;
        const recommendedMaxArea = Math.max(guide.max, room.requestedArea * 1.25), aspectRatio = Math.max(width / depth, depth / width), messages: string[] = [];
        if (room.area > recommendedMaxArea + .001) messages.push(`Area exceeds the ${round(recommendedMaxArea)} m² planning guide; redistribute this surplus before detailing.`);
        if (aspectRatio > 2.2) messages.push('Elongated room proportions need furniture and circulation review.');
        if (!direct && !rotated) messages.push('The assumed rectangular fit envelope does not fit in either orientation.');
        if (!['bathroom', 'utility', 'garage'].includes(room.use) && room.daylight === 'none') messages.push('No generated exterior window serves this habitable room.');
        return { key: room.key, name: room.name, use: room.use, area: room.area, targetArea: room.requestedArea, recommendedMaxArea: round(recommendedMaxArea), aspectRatio: round(aspectRatio), fitEnvelope: { width: guide.width, depth: guide.depth, rotated, fits: direct || rotated, description: guide.description }, status: messages.length ? 'review' : 'within-guide', messages };
    });
    const relationships: LayoutRelationshipAssessment[] = [];
    for (const room of preview.rooms) {
        if (room.attachedTo) relationships.push({ kind: 'ensuite-access', status: room.accessFrom === room.attachedTo ? 'supported' : 'review', roomKeys: [room.attachedTo, room.key], message: room.accessFrom === room.attachedTo ? 'The ensuite door is reached directly from its own bedroom.' : 'The ensuite is not directly accessed from its specified bedroom.' });
        if (room.use === 'kitchen') {
            const dining = preview.rooms.find(r => r.use === 'dining' && r.levelId === room.levelId);
            if (dining) {
                const adjacent = preview.connections.some(c => c.kind !== 'stair' && (c.from === room.key && c.to === dining.key || c.to === room.key && c.from === dining.key));
                relationships.push({ kind: 'kitchen-dining', status: adjacent ? 'supported' : 'review', roomKeys: [room.key, dining.key], message: adjacent ? 'Kitchen and dining have a generated direct shared-boundary connection.' : 'Kitchen and dining lack a direct generated connection; review the service route.' });
            }
        }
        if (room.use === 'utility') {
            const source = preview.rooms.find(r => r.key === room.accessFrom), privateRoute = source && ['bedroom', 'bathroom', 'pool', 'theater'].includes(source.use);
            relationships.push({ kind: 'service-access', status: privateRoute ? 'review' : 'supported', roomKeys: [room.key, ...(source ? [source.key] : [])], message: privateRoute ? 'Service access passes through a private or specialist programme room.' : source?.use === 'kitchen' ? 'This service room connects directly to the kitchen.' : 'This service room is reached from shared circulation or a public room.' });
        }
        if (['bedroom', 'bathroom', 'pool', 'theater'].includes(room.use)) {
            const through = preview.connections.some(c => {
                const otherKey = c.from === room.key ? c.to : c.to === room.key ? c.from : undefined;
                const other = preview.rooms.find(r => r.key === otherKey);
                return other && other.key !== room.accessFrom && other.attachedTo !== room.key && room.attachedTo !== other.key;
            });
            relationships.push({ kind: 'privacy', status: through ? 'review' : 'supported', roomKeys: [room.key], message: through ? 'A further programme room is reached through this private/specialist room.' : 'This private/specialist room is not a through-route to another programme room.' });
        }
    }
    const circulationReview = (preview.metrics?.circulationRatio ?? 0) > .25;
    return { rooms, relationships, totalExcessArea: round(rooms.reduce((n, r) => n + Math.max(0, r.area - r.recommendedMaxArea), 0)), circulationReview, reviewCount: rooms.filter(r => r.status === 'review').length + relationships.filter(r => r.status === 'review').length + Number(circulationReview), scope: ['Planning guides are design preferences, not legal, accessibility or Vaastu requirements.', 'Fit envelopes are measured rectangles with stated assumed allowances. Furniture, door swings, fixture layouts, obstructions, route clearances and accessibility have not been resolved or validated.', 'Exterior windows are a geometric opening proxy, not a daylight, ventilation or solar analysis.', ...(circulationReview ? ['Dedicated circulation exceeds 25% of measured programme plus circulation area. Service access alcoves are included; review this footprint before detailing.'] : [])] };
}
