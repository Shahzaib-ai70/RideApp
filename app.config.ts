import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const androidGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY;
  const iosGoogleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_API_KEY;

  return {
    ...config,
    name: 'Sawaari',
    slug: 'sawaari-pakistan',
    description: 'Book rides in Pakistan and apply to drive with Sawaari.',
    scheme: 'sawaari',
    platforms: ['ios', 'android', 'web'],
    web: {
      ...config.web,
      output: 'static',
      name: 'Sawaari Pakistan',
      shortName: 'Sawaari',
      description: 'Book rides in Pakistan and apply to drive with Sawaari.',
    },
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.sawaari.pakistan',
    },
    android: { ...config.android, package: 'com.sawaari.pakistan' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'react-native-maps',
        {
          ...(androidGoogleMapsApiKey ? { androidGoogleMapsApiKey } : {}),
          ...(iosGoogleMapsApiKey ? { iosGoogleMapsApiKey } : {}),
        },
      ],
      ...(config.plugins ?? []),
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Sawaari uses your location to set pickup and show your trip on the map.',
        },
      ],
    ],
  };
};
