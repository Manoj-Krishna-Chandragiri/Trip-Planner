// Nominatim's reverse-geocoding endpoint, called client-side. This is a
// single request triggered explicitly by a user click (not a loop), so
// it doesn't need the same serial rate-limit queue the server-side
// geocode.js uses for bulk stop lookups.
export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    // Prefer a city/town-level name over the full street address --
    // short and readable for display next to the input field.
    const addr = data.address || {};
    return addr.city || addr.town || addr.village || addr.suburb || data.display_name || null;
  } catch {
    return null; // fail soft -- falls back to a generic label in the caller
  }
}
