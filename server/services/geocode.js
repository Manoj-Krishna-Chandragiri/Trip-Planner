// Nominatim geocoding service with a strict 1-req/sec rate limiter.
//
// OSM Usage Policy requires:
//   1. A descriptive User-Agent header (generic headers return 403)
//   2. No more than 1 request per second
//
// INTERVIEW NOTE: Why a serial queue instead of a simple delay?
// A delay like `setTimeout(resolve, 1000)` still allows concurrent calls —
// two promises started 1ms apart would both wait 1s and fire simultaneously.
// A serial queue guarantees only one request is in-flight at a time, with
// 1s enforced BETWEEN completions.
//
// INTERVIEW NOTE: Nominatim lat/lon fields are STRINGS — always parseFloat().

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'TripPlannerApp/1.0 (flamapp-internship-assignment; contact=dev@example.com)';
const RATE_LIMIT_MS = 1100; // Slightly over 1s to be safe

// ── Serial rate-limit queue ────────────────────────────────────────
// Processes one item at a time, enforcing RATE_LIMIT_MS between completions.
class SerialQueue {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.queue = [];
    this.running = false;
  }

  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      if (!this.running) this._drain();
    });
  }

  async _drain() {
    this.running = true;
    while (this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
      // Wait between requests, even if the queue still has items
      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
    }
    this.running = false;
  }
}

const geocodeQueue = new SerialQueue(RATE_LIMIT_MS);

// ── Core geocode function (un-rate-limited) ────────────────────────
async function geocodeOnce(query) {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },
    // AbortSignal.timeout is built into Node 18+
    signal: AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Nominatim HTTP ${resp.status} for: "${query}"`);
  }

  const data = await resp.json();

  if (!Array.isArray(data) || data.length === 0) {
    return null; // Place not found — caller should mark stop as unverified
  }

  const { lat, lon, display_name: displayName } = data[0];

  return {
    // CRITICAL: Nominatim returns lat/lon as strings — parseFloat() is mandatory
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    displayName,
  };
}

// ── Public: rate-limited geocode ───────────────────────────────────
function geocodePlace(query) {
  return geocodeQueue.enqueue(() => geocodeOnce(query));
}

module.exports = { geocodePlace };
