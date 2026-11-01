import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { AuthProvider } from '../../lib/AuthContext';

const GREEN = '#0E4E3D';
const MUTED = '#75817B';

export default function TabLayout() {
  return (
    <AuthProvider>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          height: 60,
          paddingHorizontal: 12,
          borderTopColor: '#E8EBE4',
          backgroundColor: '#FFFFFF',
        },
        tabBarLabelStyle: { fontSize: 9, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Ride',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="navigate-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="drive"
        options={{
          title: 'Drive',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="car-sport-outline" size={size} color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={String(color)} />
          ),
        }}
      />
    </Tabs>
    </AuthProvider>
  );
}
