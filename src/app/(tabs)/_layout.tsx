import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { APP_FONT_FAMILY } from '../../components/AppText';

const GREEN = '#0B786F';
const MUTED = '#71858D';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: GREEN,
        tabBarInactiveTintColor: MUTED,
        tabBarStyle: {
          height: 66,
          marginHorizontal: 12,
          marginBottom: 8,
          paddingHorizontal: 10,
          borderTopWidth: 0,
          borderTopLeftRadius: 23,
          borderTopRightRadius: 23,
          borderWidth: 1,
          borderColor: '#FFFFFF',
          backgroundColor: '#FFFFFF',
          elevation: 12,
          shadowColor: '#10293A',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarLabelStyle: { fontFamily: APP_FONT_FAMILY, fontSize: 9, fontWeight: '600' },
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
          title: 'Driver mode',
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
  );
}
