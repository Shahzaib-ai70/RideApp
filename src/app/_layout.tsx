import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { AuthProvider } from '../lib/AuthContext';
import { InAppNoticeProvider } from '../components/InAppNoticeProvider';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_700Bold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <InAppNoticeProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="driver" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="auth/confirm" />
        </Stack>
      </AuthProvider>
    </InAppNoticeProvider>
  );
}
