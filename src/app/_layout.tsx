import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { Stack, router, useRootNavigationState, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AuthProvider, useAuth } from '@/features/auth/auth-context';
import { initializeLocalDatabase } from '@/lib/local-database';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  initialRouteName: '(auth)',
};

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { session, localUser, loading } = useAuth();
  const segments = useSegments();
  const navigationState = useRootNavigationState();

  useEffect(() => {
    if (!navigationState?.key || loading) return;

    const inAuthGroup = segments[0] === '(auth)';
    const isAuthenticated = Boolean(session || localUser);

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [session, localUser, loading, segments, navigationState?.key]);

  return <>{children}</>;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    void initializeLocalDatabase().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unknown database error';
      console.warn(`Local database initialization failed: ${message}`);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AuthProvider>
          <AuthGuard>
            <AnimatedSplashOverlay />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="events" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="events/[id]" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="operators" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="users/[id]" options={{ animation: 'slide_from_right' }} />
            </Stack>
          </AuthGuard>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
