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
// 25s was too tight for generateRefinement specifically -- it sends the
// entire current itinerary back to Gemini as prompt context (see below),
// a much bigger prompt than the initial plan generation, and took longer
// than 25s from Vercel's network path to Google's API in practice even
// though it was comfortably under that locally. Raised for both calls
// rather than just refinement, for headroom on a slow Gemini day generally.
// Paired with a matching `maxDuration` in vercel.json -- raising this
// alone does nothing if the platform kills the function first.
const TIMEOUT_MS = 55_000;
// Using the -latest alias rather than a pinned version on purpose: Gemini
// model IDs have been retired mid-project twice already tonight
// (gemini-2.0-flash-lite, then gemini-2.5-flash itself 404'd on July 24).
// An alias absorbs Google's future migrations instead of breaking again.
const MODEL_NAME = 'gemini-flash-latest';

// ── Helpers ────────────────────────────────────────────────────────

function getClient() {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

// Wraps a promise with a hard timeout. Throws if the deadline passes.
// We use Promise.race because the Gemini SDK doesn't expose an AbortSignal.
function withTimeout(promise, ms, label) {
  const deadline = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  );
  return Promise.race([promise, deadline]);
}

// ── Public API ─────────────────────────────────────────────────────

async function generateItinerary(description) {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: ITINERARY_SCHEMA,
    },
  });

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
  location between days as if no travel time was needed.`;

  const result = await withTimeout(
    model.generateContent(prompt),
    TIMEOUT_MS,
    'Gemini generateContent'
  );

  // BUGFIX: this used to be a bare JSON.parse. If Gemini ever returns
  // text that isn't valid JSON (safety-filtered response, truncated
  // output, etc.), JSON.parse throws a plain SyntaxError with no
  // isOutputError flag — routes/plan.js would then treat it as "Gemini
  // unavailable" and trigger the Overpass fallback, even though the
  // brief calls for a 422 (bad output, no fallback) in this case.
  // Tagging it here makes the error reach plan.js already classified.
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
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: DIFF_SCHEMA,
    },
  });

  const prompt = `You are editing an existing trip itinerary. Return ONLY the minimum set of operations needed to satisfy the user's request. Preserve all stops not explicitly changed.

Current itinerary (JSON):
${JSON.stringify(currentItinerary, null, 2)}

User's refinement request: "${refinementRequest}"

Operation types:
- "replace": change an existing stop (requires stopId + newStop)
- "add": insert a new stop (requires newStop; optionally afterStopId to position it)
- "remove": delete a stop (requires stopId)

Return an empty ops array if no changes are needed.`;

  const result = await withTimeout(
    model.generateContent(prompt),
    TIMEOUT_MS,
    'Gemini generateRefinement'
  );

  return JSON.parse(result.response.text());
}

module.exports = { generateItinerary, generateRefinement };
