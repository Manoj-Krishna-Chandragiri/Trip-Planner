

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'TripPlannerApp/1.0 (flamapp-internship-assignment; contact=dev@example.com)';
const RATE_LIMIT_MS = 1100; // Slightly over 1s to be safe

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

      if (this.queue.length > 0) {
        await new Promise(r => setTimeout(r, this.delayMs));
      }
    }
    this.running = false;
  }
}

const geocodeQueue = new SerialQueue(RATE_LIMIT_MS);

async function geocodeOnce(query) {
  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT },

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

    lat: parseFloat(lat),
    lon: parseFloat(lon),
    displayName,
  };
}

function geocodePlace(query) {
  return geocodeQueue.enqueue(() => geocodeOnce(query));
}

module.exports = { geocodePlace };
