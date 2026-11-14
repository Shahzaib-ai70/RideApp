export type MapPoint = {
  latitude: number;
  longitude: number;
};

export type MapType = 'standard' | 'satellite' | 'hybrid' | 'terrain';
export type RouteTravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING';
export type RideRouteOption = {
  distanceMeters: number;
  durationMillis: number;
  path: MapPoint[];
};

export type NearbyMapDriver = MapPoint & {
  driver_id: string;
  vehicle: string;
};

export type RideMapProps = {
  region: MapPoint & { latitudeDelta: number; longitudeDelta: number };
  pickup: MapPoint | null;
  destination: MapPoint | null;
  locationGranted: boolean;
  onRegionChange: (region: MapPoint & { latitudeDelta: number; longitudeDelta: number }) => void;
  onRouteDistanceChange?: (distanceKm: number | null, error?: string) => void;
  onRouteOptionsChange?: (routes: RideRouteOption[], error?: string) => void;
  routeOptions?: RideRouteOption[];
  selectedRouteIndex?: number;
  onSelectRoute?: (index: number) => void;
  travelMode?: RouteTravelMode;
  mapType?: MapType;
  previewPoint?: MapPoint | null;
  previewPointKind?: 'pickup' | 'destination';
  onMapPress?: (point: MapPoint) => void;
  onMarkerDragEnd?: (field: 'pickup' | 'destination', point: MapPoint) => void;
  nearbyDrivers?: NearbyMapDriver[];
  acceptedDriverLocation?: MapPoint | null;
  acceptedDriverVehicle?: string | null;
  acceptedDriverTitle?: string;
  acceptedDriverDescription?: string;
  followAcceptedDriver?: boolean;
};
