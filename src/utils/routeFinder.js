import busData from '../data/bus_data_geo.json';
import frequencies from '../data/frequencies.json';

// busData: { locations: { "MAHALLE": { lines: ["1", "3"], lat: 39.4, lng: 29.9 }, ... } }

export const getLocations = () => {
    return Object.keys(busData.locations).sort();
};

export const getLocationCoords = (mahalle) => {
    const loc = busData.locations[mahalle];
    if (loc && loc.lat && loc.lng) return [loc.lat, loc.lng];
    return null;
}

// Haversine formula
const haversineDist = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        0.5 - Math.cos(dLat)/2 + 
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        (1 - Math.cos(dLon)) / 2;

    return R * 2 * Math.asin(Math.sqrt(a));
}

export const findClosestLocation = (lat, lng) => {
    let closest = null;
    let minDist = Infinity;

    for (const [mahalle, data] of Object.entries(busData.locations)) {
        if (!data.lat || !data.lng) continue;
        const dist = haversineDist(lat, lng, data.lat, data.lng);
        if (dist < minDist) {
            minDist = dist;
            closest = mahalle;
        }
    }
    return closest;
};

// HELPER: Get frequency bottleneck
const getFrequencyScore = (line1, line2) => {
    const f1 = frequencies[line1] || 0;
    const f2 = frequencies[line2] || 0;
    return Math.min(f1, f2); 
};

export const findRoutes = (source, destination) => {
    if (!source || !destination || source === destination) return null;

    const locs = busData.locations;
    const sourceLines = locs[source]?.lines || [];
    const destLines = locs[destination]?.lines || [];

    // 1. Direct Routes
    let directLines = sourceLines.filter(line => destLines.includes(line));

    if (directLines.length > 0) {
        // Sort direct lines highest freq first
        directLines = directLines.sort((a, b) => (frequencies[b] || 0) - (frequencies[a] || 0));
        return {
            type: 'direct',
            routes: directLines.map(line => ({ line, score: frequencies[line] || 0 }))
        };
    }

    // 2. 1-Transfer Routes
    const lineToMahalles = {};
    for (const [mahalle, data] of Object.entries(locs)) {
        for (const line of (data.lines || [])) {
            if (!lineToMahalles[line]) lineToMahalles[line] = [];
            lineToMahalles[line].push(mahalle);
        }
    }

    const bestCombos = {}; // Map lineComboId -> route object

    for (const line1 of sourceLines) {
        const line1Mahalles = lineToMahalles[line1] || [];
        for (const transferMahalle of line1Mahalles) {
            if (transferMahalle === source || transferMahalle === destination) continue;
            
            const linesAtTransfer = locs[transferMahalle]?.lines || [];
            
            // Calculate distance detour
            const tCoords = locs[transferMahalle];
            const sCoords = locs[source];
            const dCoords = locs[destination];
            let totalDist = 99999;
            
            if (tCoords?.lat && sCoords?.lat && dCoords?.lat) {
               const dist1 = haversineDist(sCoords.lat, sCoords.lng, tCoords.lat, tCoords.lng);
               const dist2 = haversineDist(tCoords.lat, tCoords.lng, dCoords.lat, dCoords.lng);
               totalDist = dist1 + dist2;
            }

            for (const line2 of destLines) {
                if (linesAtTransfer.includes(line2)) {
                    const lineComboId = `${line1}-${line2}`;
                    const freqScore = getFrequencyScore(line1, line2);

                    const newRouteObj = {
                        line1,
                        transferPoint: transferMahalle,
                        line2,
                        freqLimit: freqScore,
                        rawDist: totalDist,
                        dist: totalDist.toFixed(1)
                    };

                    // Her iki hat kombinasyonu için DAİMA ve SADECE en "kısa" kuş uçuşu aktarma noktasını seç
                    if (!bestCombos[lineComboId] || totalDist < bestCombos[lineComboId].rawDist) {
                        bestCombos[lineComboId] = newRouteObj;
                    }
                }
            }
        }
    }

    const transferRoutes = Object.values(bestCombos);

    if (transferRoutes.length > 0) {
        // En düşük "Minimum Uzaklık"a sahip olanı en başa getir (Uzaklıklar çok yakınsa seferi çok olanı üste al)
        transferRoutes.sort((a, b) => {
            if (Math.abs(a.rawDist - b.rawDist) < 0.5) { // Yarım kilometreden daha yakınlarsa sefer sıklığına bak
                return b.freqLimit - a.freqLimit;
            }
            return a.rawDist - b.rawDist; // Mesafe her zaman en küçük olan yukarıda
        });

        return {
            type: 'transfer',
            routes: transferRoutes
        };
    }

    return {
        type: 'none',
        routes: []
    };
};
