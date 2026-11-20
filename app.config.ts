import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
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
    android: {
      ...config.android,
      package: 'com.sawaari.online',
      versionCode: config.android?.versionCode ?? 1,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-status-bar',
      ['@maplibre/maplibre-react-native', { android: { locationEngine: 'default' } }],
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
