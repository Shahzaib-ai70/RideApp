import { Stack } from 'expo-router';
import { AuthProvider } from '../lib/AuthContext';
import { InAppNoticeProvider } from '../components/InAppNoticeProvider';

export default function RootLayout() {
  return (
    <InAppNoticeProvider>
      <AuthProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="admin" />
          <Stack.Screen name="auth/confirm" />
        </Stack>
      </AuthProvider>
    </InAppNoticeProvider>
  );
}
