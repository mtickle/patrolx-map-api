const EMD_CODES = {
    // Protocol 29: Traffic / Transportation Incidents
    '29D2M': 'Traffic Incident - High Mechanism: Vehicle vs. Pedestrian',
    '29D2N': 'Traffic Incident - High Mechanism: Vehicle Ejection',
    '29D2P': 'Traffic Incident - High Mechanism: Rollover',
    '29D2Q': 'Traffic Incident - High Mechanism: Vehicle vs. Bicycle/Motorcycle',
    '29D2R': 'Traffic Incident - High Mechanism: Possible Entrapment',
    '29D1': 'Traffic Incident - Major Accident / Multiple Vehicles',
    '29B1': 'Traffic Incident - Injuries Reported',
    '29B2': 'Traffic Incident - Serious Hemorrhage',
    '29A1': 'Traffic Incident - Minor / No Injuries Reported',
    '29O1': 'Traffic Incident - Property Damage Only / No Injuries',

    // Common Fire / Medical / Police Determinants
    '10D1': 'Chest Pain - Not Alert / Severe',
    '69D': 'Structure Fire - Commercial / High Life Hazard',
    '69C': 'Structure Fire - Residential Single Family',
    '52B': 'Alarms - Commercial / Residential Fire Alarm',
    '131B': 'Traffic Violation / Motorist Assist'
};

function decodeNature(rawString) {
    if (!rawString) return null;
    const normalized = rawString.replace(/[-\s]/g, '').toUpperCase();
    for (const [code, description] of Object.entries(EMD_CODES)) {
        if (normalized.includes(code)) {
            return `${description} (${code})`;
        }
    }
    return null;
}

module.exports = { EMD_CODES, decodeNature };