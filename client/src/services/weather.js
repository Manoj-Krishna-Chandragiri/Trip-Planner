// Open-Meteo requires no API key and has solid global coverage (including
// India), so this can be called directly from the browser -- unlike the
// Gemini calls, there's no secret to protect here. Weather is never asked
// of the LLM; it would have no real basis for a forecast, only a guess.
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

export async function fetchDailyForecast(lat, lon, numDays) {
  const days = Math.max(1, Math.min(numDays, 16)); // Open-Meteo's forecast horizon caps at 16 days
  const url = `${BASE_URL}?latitude=${lat}&longitude=${lon}&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=${days}`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.daily?.time) return null;

    return data.daily.time.map((date, i) => ({
      date,
      precipitationChance: data.daily.precipitation_probability_max[i],
      weatherCode: data.daily.weathercode[i],
      tempMax: data.daily.temperature_2m_max[i],
      tempMin: data.daily.temperature_2m_min[i],
    }));
  } catch {
    return null; // fail soft -- a missing forecast should never block the itinerary
  }
}

// Minimal WMO weather-code -> icon/label mapping (per Open-Meteo's docs).
export function describeWeatherCode(code) {
  if (code === 0) return { icon: '☀️', label: 'Clear' };
  if (code <= 3) return { icon: '⛅', label: 'Partly cloudy' };
  if (code <= 48) return { icon: '🌫️', label: 'Fog' };
  if (code <= 67) return { icon: '🌧️', label: 'Rain' };
  if (code <= 77) return { icon: '❄️', label: 'Snow' };
  if (code <= 82) return { icon: '🌦️', label: 'Showers' };
  return { icon: '⛈️', label: 'Storms' };
}
