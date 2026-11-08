import { Stack } from 'expo-router';
import { AuthProvider } from '../lib/AuthContext';

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="auth/confirm" />
      </Stack>
    </AuthProvider>
  );
}
