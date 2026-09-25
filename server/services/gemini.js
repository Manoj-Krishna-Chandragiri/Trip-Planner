// Gemini API service — generates structured itinerary JSON using responseSchema.
//
// INTERVIEW NOTE: Why responseSchema instead of prompting "return JSON"?
// Because responseSchema forces the model to emit valid JSON matching our
// schema — we don't need to parse/extract JSON from prose, and we know
// exactly which fields will exist. The SDK uses SchemaType enums rather
// than raw strings so the schema is type-safe.

const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

// ── Schemas ────────────────────────────────────────────────────────

// Mirrors the brief's required JSON shape exactly.
// All fields are required so the validator and enrichment pipeline
// can assume they exist without defensive optional chaining everywhere.
const ITINERARY_SCHEMA = {
  type: SchemaType.OBJECT,
  required: ['tripTitle', 'region', 'days'],
  properties: {
    tripTitle: {
      type: SchemaType.STRING,
      description: 'A short, catchy title for the trip (e.g. "3 Days in Tokyo")',
    },
    region: {
      type: SchemaType.STRING,
      description: 'General area for geocoding context, e.g. "Mumbai-Pune Highway, India" or "Kyoto, Japan" — appended to each stop name when looking it up on the map, so keep it short and map-searchable.',
    },
    days: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ['dayNumber', 'title', 'stops'],
        properties: {
          dayNumber: { type: SchemaType.INTEGER },
          title: {
            type: SchemaType.STRING,
            description: 'Short day theme, e.g. "Museums & Culture"',
          },
          location: {
            type: SchemaType.STRING,
            description: 'Short area/neighborhood name for this specific day, e.g. "Lonavala" or "South Mumbai" — used as a day-tab label, not the full trip region.',
          },
          stops: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              required: ['id', 'name', 'type', 'description', 'suggestedDurationMinutes', 'reason'],
              properties: {
                id: {
                  type: SchemaType.STRING,
                  description: 'Unique ID in format "day1-stop1", "day1-stop2", etc.',
                },
                name: {
                  type: SchemaType.STRING,
                  description: 'Exact, real place name that can be found on a map',
                },
                type: {
                  type: SchemaType.STRING,
                  description: 'One of: landmark, food, nature, museum, shopping — used for a color-coded category badge in the UI',
                },
                description: {
                  type: SchemaType.STRING,
                  description: 'What to do/see here in 1-2 sentences',
                },
                suggestedDurationMinutes: {
                  type: SchemaType.INTEGER,
                  description: 'Realistic visit duration in minutes (30-180 typically)',
                },
                reason: {
                  type: SchemaType.STRING,
                  description: "One sentence: why this stop fits the user's specific request",
                },
              },
            },
          },
        },
      },
    },
  },
};

// Schema for diff-based refinement — returns only the ops needed,
// not the entire itinerary, so user's manual edits are preserved.
const DIFF_SCHEMA = {
  type: SchemaType.OBJECT,
  required: ['ops'],
  properties: {
    ops: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        required: ['op', 'dayNumber'],
        properties: {
          op: {
            type: SchemaType.STRING,
            description: 'One of: replace, add, remove',
          },
          dayNumber: { type: SchemaType.INTEGER },
          stopId: {
            type: SchemaType.STRING,
            description: 'Required for replace and remove ops',
          },
          afterStopId: {
            type: SchemaType.STRING,
            description: 'For add: insert after this stop ID. Omit to add at end.',
          },
          newStop: {
            type: SchemaType.OBJECT,
            description: 'Required for replace and add ops',
            properties: {
              id: { type: SchemaType.STRING },
              name: { type: SchemaType.STRING },
              description: { type: SchemaType.STRING },
              suggestedDurationMinutes: { type: SchemaType.INTEGER },
              reason: { type: SchemaType.STRING },
            },
          },
        },
      },
    },
  },
};

// ── Constants ──────────────────────────────────────────────────────
const TIMEOUT_MS = 55_000;

// Ordered fallback array of active Gemini models.
// If one encounters a 503 (high demand) or 404, the service will seamlessly attempt the next.
const FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];

// Helper delay to allow small pause between retries
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Helpers ────────────────────────────────────────────────────────

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Wraps a promise with a hard timeout. Throws if the deadline passes.
function withTimeout(promise, ms, label) {
  const deadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  );
  return Promise.race([promise, deadline]);
}

// Attempts generation across models in FALLBACK_MODELS sequentially
async function callGeminiWithFallback(genAI, prompt, schema) {
  let lastError = null;

  for (const modelName of FALLBACK_MODELS) {
    try {
      console.log(`[Gemini API] Executing request with model: ${modelName}`);

      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
        },
      });

      const result = await withTimeout(
        model.generateContent(prompt),
        TIMEOUT_MS,
        `Gemini generateContent (${modelName})`
      );

      return result;
    } catch (err) {
      console.warn(`[Gemini API] Model '${modelName}' failed: ${err.message}. Switching to next fallback model...`);
      lastError = err;
      await delay(800);
    }
  }

  throw lastError || new Error('All Gemini models failed to generate a response.');
}

// ── Public API ─────────────────────────────────────────────────────

async function generateItinerary(description) {
  const genAI = getClient();

  const prompt = `You are an expert travel planner. Create a detailed, realistic day-by-day trip itinerary.

User's trip description: "${description}"

Instructions:
- Include 3-5 stops per day at real, specific, named locations
- Stop IDs must follow format "day1-stop1", "day1-stop2", "day2-stop1", etc.
- suggestedDurationMinutes should be realistic (30 min for a quick café stop, up to 180 min for a major museum)
- The "reason" field must specifically reference things the user mentioned in their description
- Only include real places that can be geocoded — no fictional or vague locations like "a local restaurant"
- Order stops in each day to minimise travel (geographically logical progression)
- CRITICAL — geographic realism: all stops within a single day must be in
  one compact, walkable-or-short-transit area of a single city or town.
  Never mix stops from different cities, states, or countries within the
  same day, regardless of transport mode.
- If the trip spans multiple distant cities, states, or countries,
  dedicate an explicit day (or the first stop of a day) to the transition
  itself — e.g. a day titled "Travel to Delhi" with a stop describing the
  flight/train/journey — rather than silently jumping the itinerary's
  location between days as if no travel time was needed.
- GEOGRAPHIC REALISM: Verify if the requested transport mode is physically possible between origin and destination. If a mode is physically impossible (e.g. walking across seas), explicitly explain the necessary transit connection (e.g. flight/ferry) in the day description or stop reason.`;

  const result = await callGeminiWithFallback(genAI, prompt, ITINERARY_SCHEMA);

  let rawText;
  try {
    rawText = result.response.text();
  } catch (err) {
    const wrapped = new Error(`Gemini response had no usable text: ${err.message}`);
    wrapped.isOutputError = true;
    throw wrapped;
  }

  try {
    return JSON.parse(rawText);
  } catch (err) {
    const wrapped = new Error(`Gemini returned invalid JSON: ${err.message}`);
    wrapped.isOutputError = true;
    throw wrapped;
  }
}

async function generateRefinement(currentItinerary, refinementRequest) {
  const genAI = getClient();

  const prompt = `You are editing an existing trip itinerary. Return ONLY the minimum set of operations needed to satisfy the user's request. Preserve all stops not explicitly changed.

Current itinerary (JSON):
${JSON.stringify(currentItinerary, null, 2)}

User's refinement request: "${refinementRequest}"

Operation types:
- "replace": change an existing stop (requires stopId + newStop)
- "add": insert a new stop (requires newStop; optionally afterStopId to position it)
- "remove": delete a stop (requires stopId)

Return an empty ops array if no changes are needed.`;

  const result = await callGeminiWithFallback(genAI, prompt, DIFF_SCHEMA);

  let rawText;
  try {
    rawText = result.response.text();
  } catch (err) {
    const wrapped = new Error(`Gemini response had no usable text: ${err.message}`);
    wrapped.isOutputError = true;
    throw wrapped;
  }

  try {
    return JSON.parse(rawText);
  } catch (err) {
    const wrapped = new Error(`Gemini returned invalid JSON: ${err.message}`);
    wrapped.isOutputError = true;
    throw wrapped;
  }
}

module.exports = { generateItinerary, generateRefinement };