import { ENV, ENV_STATUS } from '../config/env';
import {
  GeoPoint,
  HourlyWeather,
  WeatherFlag,
  WeatherThresholds,
} from '../types/models';

export interface WeatherForecastResponse {
  hours: HourlyWeather[];
  providerName: string;
  isFallbackCache: boolean;
  errorBanner?: string;
  fetchedAt: string;
}

function decodeWmoWeatherCode(code: number, precipProb: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1 || code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Foggy';
  if (code >= 51 && code <= 57) return 'Light drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Rain showers';
  if (code >= 95) return 'Thunderstorm';
  return precipProb > 45 ? 'Showers likely' : 'Dry & mild';
}

/**
 * Evaluates a single hour's meteorological & air-quality metrics against the user's
 * configurable thresholds, returning safety flags and a 0-100 running comfort score.
 */
export function evaluateHourlyWeatherSafety(
  raw: Omit<HourlyWeather, 'safetyScore' | 'flags' | 'isSafe'>,
  thresholds: WeatherThresholds
): HourlyWeather {
  const flags: WeatherFlag[] = [];
  let penalty = 0;

  // 1. Temperature & Feels-Like check
  if (raw.tempC < thresholds.minTempC || raw.feelsLikeC < thresholds.minFeelsLikeC) {
    const isExtreme = raw.feelsLikeC < thresholds.minFeelsLikeC - 4;
    flags.push({
      type: 'too_cold',
      severity: isExtreme ? 'unsafe' : 'warning',
      label: 'Too Cold',
      detail: `${raw.tempC.toFixed(0)}°C (feels ${raw.feelsLikeC.toFixed(0)}°C) below min threshold`,
    });
    penalty += isExtreme ? 48 : 28;
  } else if (raw.tempC > thresholds.maxTempC || raw.feelsLikeC > thresholds.maxFeelsLikeC) {
    const isExtreme = raw.feelsLikeC > thresholds.maxFeelsLikeC + 3;
    flags.push({
      type: 'too_hot',
      severity: isExtreme ? 'unsafe' : 'warning',
      label: 'Heat Stress',
      detail: `${raw.tempC.toFixed(0)}°C (feels ${raw.feelsLikeC.toFixed(0)}°C) exceeds max threshold`,
    });
    penalty += isExtreme ? 52 : 30;
  } else {
    // Ideal running temperature is around 11°C - 15°C (52°F - 59°F)
    const distFromIdeal = Math.abs(raw.feelsLikeC - 13);
    penalty += Math.min(18, Math.round(distFromIdeal * 1.1));
  }

  // 2. Precipitation check
  if (raw.precipProbPct > thresholds.maxRainProbPct || raw.precipMm > 1.2) {
    const isHeavy = raw.precipProbPct >= 70 || raw.precipMm > 2.5;
    flags.push({
      type: 'rain_risk',
      severity: isHeavy ? 'unsafe' : 'warning',
      label: isHeavy ? 'Heavy Rain' : 'Rain Risk',
      detail: `${raw.precipProbPct}% rain chance (${raw.precipMm.toFixed(1)} mm/h)`,
    });
    penalty += isHeavy ? 42 : 24;
  } else {
    penalty += Math.round(raw.precipProbPct * 0.25);
  }

  // 3. Wind speed check
  if (raw.windSpeedKph > thresholds.maxWindKph) {
    const isGale = raw.windSpeedKph > thresholds.maxWindKph + 12;
    flags.push({
      type: 'high_wind',
      severity: isGale ? 'unsafe' : 'warning',
      label: 'High Wind',
      detail: `Wind ${raw.windSpeedKph.toFixed(0)} km/h (gusts ${raw.windGustKph.toFixed(0)} km/h)`,
    });
    penalty += isGale ? 40 : 22;
  } else if (raw.windSpeedKph > 18) {
    penalty += Math.round((raw.windSpeedKph - 18) * 0.7);
  }

  // 4. Air Quality Index (AQI) check
  if (raw.aqi > thresholds.maxAqi) {
    const isHazardous = raw.aqi > thresholds.maxAqi + 40;
    flags.push({
      type: 'poor_aqi',
      severity: isHazardous ? 'unsafe' : 'warning',
      label: 'Poor Air Quality',
      detail: `AQI ${raw.aqi} (PM2.5 ${raw.pm25.toFixed(1)} µg/m³) exceeds ${thresholds.maxAqi}`,
    });
    penalty += isHazardous ? 55 : 32;
  } else if (raw.aqi > 50) {
    penalty += Math.round((raw.aqi - 50) * 0.25);
  }

  const safetyScore = Math.max(5, Math.min(100, 100 - penalty));
  const hasUnsafeFlag = flags.some((f) => f.severity === 'unsafe');
  const isSafe = !hasUnsafeFlag && flags.length === 0;

  return {
    ...raw,
    safetyScore,
    flags,
    isSafe,
  };
}

/**
 * Generates deterministic 72-hour fallback forecast data when offline or when weather APIs are down.
 * Includes varied conditions (crisp dry afternoon, rainy morning, windy evening) so all
 * threshold flags and smart recommendation edge cases can be inspected.
 */
export function buildSyntheticForecastHours(
  thresholds: WeatherThresholds
): HourlyWeather[] {
  const baseDate = new Date();
  baseDate.setMinutes(0, 0, 0);
  const hours: HourlyWeather[] = [];

  for (let h = 0; h < 72; h++) {
    const slot = new Date(baseDate.getTime() + h * 3600_000);
    const hourOfDay = slot.getHours();

    // Realistic diurnal temperature cycle peaking around 15:00-16:00
    const diurnal = Math.sin(((hourOfDay - 6) / 24) * Math.PI * 2);
    const tempC = Number((9.5 + diurnal * 4.5 + (h % 3) * 0.3).toFixed(1));

    // Create a rainy morning window around 08:00-10:00 and crisp dry window around 15:00-18:00
    const isRainyWindow = hourOfDay >= 8 && hourOfDay <= 10 && h < 36;
    const isWindySlot = hourOfDay === 19 || hourOfDay === 20;
    const isColdNight = hourOfDay >= 0 && hourOfDay <= 5;
    const isIdealAfternoon = hourOfDay >= 15 && hourOfDay <= 17;

    const precipProbPct = isRainyWindow ? 68 : isIdealAfternoon ? 5 : 15;
    const precipMm = isRainyWindow ? 1.8 : 0;
    const windSpeedKph = isWindySlot ? 38 : isIdealAfternoon ? 11 : 17;
    const windGustKph = Math.round(windSpeedKph * 1.35);
    const feelsLikeC = isColdNight
      ? Number((tempC - 3.2).toFixed(1))
      : isIdealAfternoon
        ? 11
        : Number((tempC - 0.8).toFixed(1));
    const aqi = hourOfDay === 18 && h > 24 ? 112 : 28 + (hourOfDay % 14);
    const pm25 = Number((aqi * 0.24).toFixed(1));
    const weatherCode = isRainyWindow ? 61 : isIdealAfternoon ? 1 : 2;

    hours.push(
      evaluateHourlyWeatherSafety(
        {
          isoTime: slot.toISOString(),
          tempC: isIdealAfternoon ? 11 : tempC,
          feelsLikeC,
          precipProbPct,
          precipMm,
          windSpeedKph,
          windGustKph,
          humidityPct: isRainyWindow ? 86 : 62,
          uvIndex: hourOfDay >= 10 && hourOfDay <= 16 ? 3 : 0,
          aqi,
          pm25,
          conditionLabel: isIdealAfternoon
            ? 'Dry & crisp'
            : decodeWmoWeatherCode(weatherCode, precipProbPct),
          weatherCode,
        },
        thresholds
      )
    );
  }
  return hours;
}

/**
 * Fetches 72-hour weather + air quality forecast.
 * Priority:
 *   1. Google Maps Platform Weather API (if EXPO_PUBLIC_GOOGLE_WEATHER_API_KEY is configured)
 *   2. Open-Meteo Forecast API + Open-Meteo Air Quality API (free, no key needed)
 *   3. Local cached/synthetic fallback if offline or API is down
 */
export async function fetchRunningForecast(
  location: GeoPoint,
  thresholds: WeatherThresholds,
  options?: { simulateApiDown?: boolean; simulateOffline?: boolean }
): Promise<WeatherForecastResponse> {
  if (options?.simulateOffline) {
    return {
      hours: buildSyntheticForecastHours(thresholds),
      providerName: 'Offline Forecast Cache',
      isFallbackCache: true,
      errorBanner: 'No internet connection detected. Using cached local forecast.',
      fetchedAt: new Date().toISOString(),
    };
  }

  if (options?.simulateApiDown) {
    return {
      hours: buildSyntheticForecastHours(thresholds),
      providerName: 'Resilient Fallback Engine',
      isFallbackCache: true,
      errorBanner: 'Primary Weather API returned 503 Unavailable. Switched to fallback model.',
      fetchedAt: new Date().toISOString(),
    };
  }

  // 1. Try Google Maps Platform Weather API if key is set in .env
  if (ENV_STATUS.hasGoogleWeather) {
    try {
      const googleUrl = `https://weather.googleapis.com/v1/forecast/hours:lookup?key=${ENV.GOOGLE_WEATHER_API_KEY}&location.latitude=${location.lat}&location.longitude=${location.lng}&hours=72`;
      const gRes = await fetch(googleUrl);
      if (gRes.ok) {
        const gData = (await gRes.json()) as {
          forecastHours?: Array<{
            interval?: { startTime?: string };
            temperature?: { degrees?: number };
            feelsLikeTemperature?: { degrees?: number };
            precipitation?: {
              probability?: { percent?: number };
              qpf?: { quantity?: number };
            };
            wind?: {
              speed?: { value?: number };
              gust?: { value?: number };
            };
            relativeHumidity?: number;
            uvIndex?: number;
            weatherCondition?: { description?: { text?: string } };
          }>;
        };
        if (gData.forecastHours && gData.forecastHours.length > 0) {
          const parsed = gData.forecastHours.map((item) =>
            evaluateHourlyWeatherSafety(
              {
                isoTime: item.interval?.startTime ?? new Date().toISOString(),
                tempC: item.temperature?.degrees ?? 12,
                feelsLikeC: item.feelsLikeTemperature?.degrees ?? 11,
                precipProbPct: item.precipitation?.probability?.percent ?? 10,
                precipMm: item.precipitation?.qpf?.quantity ?? 0,
                windSpeedKph: item.wind?.speed?.value ?? 12,
                windGustKph: item.wind?.gust?.value ?? 18,
                humidityPct: item.relativeHumidity ?? 65,
                uvIndex: item.uvIndex ?? 2,
                aqi: 32,
                pm25: 7.5,
                conditionLabel: item.weatherCondition?.description?.text ?? 'Clear',
                weatherCode: 1,
              },
              thresholds
            )
          );
          return {
            hours: parsed,
            providerName: 'Google Maps Platform Weather API',
            isFallbackCache: false,
            fetchedAt: new Date().toISOString(),
          };
        }
      }
    } catch {
      // Automatically fall back to Open-Meteo below
    }
  }

  // 2. Open-Meteo Forecast + Air Quality APIs (Free, real-time meteorological & AQI data)
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.lat.toFixed(4)}&longitude=${location.lng.toFixed(4)}&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,uv_index,weather_code&forecast_days=3&timezone=auto`;
    const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${location.lat.toFixed(4)}&longitude=${location.lng.toFixed(4)}&hourly=us_aqi,pm2_5&forecast_days=3&timezone=auto`;

    const [weatherRes, aqiRes] = await Promise.all([
      fetch(weatherUrl),
      fetch(aqiUrl).catch(() => null),
    ]);

    if (weatherRes.ok) {
      const wJson = (await weatherRes.json()) as {
        hourly?: {
          time: string[];
          temperature_2m: number[];
          apparent_temperature: number[];
          precipitation_probability: number[];
          precipitation: number[];
          wind_speed_10m: number[];
          wind_gusts_10m: number[];
          relative_humidity_2m: number[];
          uv_index: number[];
          weather_code: number[];
        };
      };

      let aqiJson: {
        hourly?: {
          us_aqi?: Array<number | null>;
          pm2_5?: Array<number | null>;
        };
      } | null = null;

      if (aqiRes && aqiRes.ok) {
        aqiJson = await aqiRes.json();
      }

      if (wJson.hourly && wJson.hourly.time.length > 0) {
        const hours: HourlyWeather[] = wJson.hourly.time.map((timeStr, idx) => {
          const tempC = Number((wJson.hourly!.temperature_2m[idx] ?? 12).toFixed(1));
          const feelsLikeC = Number((wJson.hourly!.apparent_temperature[idx] ?? tempC).toFixed(1));
          const precipProbPct = Math.round(wJson.hourly!.precipitation_probability[idx] ?? 0);
          const precipMm = Number((wJson.hourly!.precipitation[idx] ?? 0).toFixed(1));
          const windSpeedKph = Number((wJson.hourly!.wind_speed_10m[idx] ?? 10).toFixed(1));
          const windGustKph = Number((wJson.hourly!.wind_gusts_10m[idx] ?? windSpeedKph * 1.3).toFixed(1));
          const humidityPct = Math.round(wJson.hourly!.relative_humidity_2m[idx] ?? 65);
          const uvIndex = Number((wJson.hourly!.uv_index[idx] ?? 1).toFixed(1));
          const weatherCode = wJson.hourly!.weather_code[idx] ?? 1;
          const aqi = Math.round(aqiJson?.hourly?.us_aqi?.[idx] ?? 32);
          const pm25 = Number((aqiJson?.hourly?.pm2_5?.[idx] ?? 7.2).toFixed(1));

          return evaluateHourlyWeatherSafety(
            {
              isoTime: new Date(timeStr).toISOString(),
              tempC,
              feelsLikeC,
              precipProbPct,
              precipMm,
              windSpeedKph,
              windGustKph,
              humidityPct,
              uvIndex,
              aqi,
              pm25,
              conditionLabel: decodeWmoWeatherCode(weatherCode, precipProbPct),
              weatherCode,
            },
            thresholds
          );
        });

        return {
          hours,
          providerName: 'Open-Meteo Weather + Air Quality API',
          isFallbackCache: false,
          fetchedAt: new Date().toISOString(),
        };
      }
    }
  } catch {
    // Fall through to resilient synthetic forecast
  }

  return {
    hours: buildSyntheticForecastHours(thresholds),
    providerName: 'Local Forecast Engine (Fallback)',
    isFallbackCache: true,
    errorBanner: 'Live weather endpoint unreachable. Displaying local forecast model.',
    fetchedAt: new Date().toISOString(),
  };
}
