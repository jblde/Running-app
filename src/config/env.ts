/**
 * Secure Environment Configuration Loader
 * Reads exclusively from environment variables (never hardcoded secrets).
 * Supports both EXPO_PUBLIC_* (Expo mobile) and VITE_* (Web bundler) prefixes.
 */

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function readEnv(key: string): string {
  return (metaEnv[key] ?? '').trim();
}

export const ENV = {
  // Supabase Backend
  SUPABASE_URL: readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('VITE_SUPABASE_URL'),
  SUPABASE_ANON_KEY: readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || readEnv('VITE_SUPABASE_ANON_KEY'),

  // Maps & Routing
  MAPBOX_ACCESS_TOKEN: readEnv('EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN') || readEnv('VITE_MAPBOX_ACCESS_TOKEN'),
  GOOGLE_MAPS_API_KEY: readEnv('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') || readEnv('VITE_GOOGLE_MAPS_API_KEY'),

  // Weather APIs
  GOOGLE_WEATHER_API_KEY: readEnv('EXPO_PUBLIC_GOOGLE_WEATHER_API_KEY') || readEnv('VITE_GOOGLE_WEATHER_API_KEY'),
  OPENWEATHER_API_KEY: readEnv('EXPO_PUBLIC_OPENWEATHER_API_KEY') || readEnv('VITE_OPENWEATHER_API_KEY'),

  // Google Calendar OAuth 2.0 (Read-Only Scope)
  GOOGLE_OAUTH_CLIENT_ID_WEB:
    readEnv('EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_WEB') || readEnv('VITE_GOOGLE_OAUTH_CLIENT_ID_WEB'),
  GOOGLE_OAUTH_CLIENT_ID_IOS: readEnv('EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_IOS'),
  GOOGLE_OAUTH_CLIENT_ID_ANDROID: readEnv('EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID_ANDROID'),
};

export const ENV_STATUS = {
  hasSupabase: Boolean(ENV.SUPABASE_URL && ENV.SUPABASE_ANON_KEY),
  hasMapbox: Boolean(ENV.MAPBOX_ACCESS_TOKEN),
  hasGoogleMaps: Boolean(ENV.GOOGLE_MAPS_API_KEY),
  hasGoogleWeather: Boolean(ENV.GOOGLE_WEATHER_API_KEY),
  hasOpenWeather: Boolean(ENV.OPENWEATHER_API_KEY),
  hasGoogleOAuth: Boolean(
    ENV.GOOGLE_OAUTH_CLIENT_ID_WEB || ENV.GOOGLE_OAUTH_CLIENT_ID_IOS || ENV.GOOGLE_OAUTH_CLIENT_ID_ANDROID
  ),
};
