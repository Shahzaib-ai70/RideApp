export type MapPoint = {
  latitude: number;
  longitude: number;
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
  nearbyDrivers?: NearbyMapDriver[];
  acceptedDriverLocation?: MapPoint | null;
  acceptedDriverVehicle?: string | null;
};
