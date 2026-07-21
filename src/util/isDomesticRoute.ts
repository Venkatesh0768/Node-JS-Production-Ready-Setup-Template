/**
 * Set of all known Indian airport IATA codes.
 * Used to determine whether a route is domestic (India-to-India) or international.
 */
const INDIAN_IATA_CODES = new Set<string>([
    // Major metros
    'DEL', 'BOM', 'BLR', 'HYD', 'MAA', 'CCU', 'AMD', 'PNQ', 'JAI', 'GOI',
    // South India
    'COK', 'TRV', 'IXM', 'IXE', 'CCJ', 'IXZ', 'VTZ', 'CDP',
    // North India
    'LKO', 'ATQ', 'IXC', 'SXR', 'LUH', 'KUU', 'DHM',
    // East India
    'IXR', 'PAT', 'IXB', 'GAU', 'IXA', 'TEZ', 'DIB', 'JRH', 'MZU', 'SHL',
    // West India
    'RAJ', 'STV', 'BDQ', 'UDR', 'JDH', 'JGA', 'DIU',
    // Central India
    'IDR', 'BHO', 'NAG', 'JLR', 'RPR', 'GWL',
    // Andhra / Telangana
    'VGA', 'TIR', 'VNS',
    // Odisha
    'BBI',
    // North East
    'IXS', 'IXU',
    // Misc
    'PUT', 'OMC', 'KQH', 'HBX', 'BEK',
]);

/**
 * Returns "Yes" if both origin and destination are Indian airports, "No" otherwise.
 * Pure function — no side effects.
 */
export function isDomesticRoute(from: string, to: string): 'Yes' | 'No' {
    return INDIAN_IATA_CODES.has(from.toUpperCase()) && INDIAN_IATA_CODES.has(to.toUpperCase())
        ? 'Yes'
        : 'No';
}
