

export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=14`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const addr = data.address || {};
    return addr.city || addr.town || addr.village || addr.suburb || data.display_name || null;
  } catch {
    return null; // fail soft -- falls back to a generic label in the caller
  }
}
