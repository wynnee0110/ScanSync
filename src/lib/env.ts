export const env = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '',
  apiUrl: process.env.EXPO_PUBLIC_API_URL?.trim() ?? '',
} as const;

export const isSupabaseConfigured = Boolean(env.supabaseUrl && env.supabasePublishableKey);
export const isApiConfigured = Boolean(env.apiUrl);
