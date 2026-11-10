import { SvgXml } from 'react-native-svg';

export type VehicleType = 'Bike' | 'Rickshaw' | 'Car' | 'Premium';

const VEHICLE_COLORS: Record<VehicleType, string> = {
  Bike: '#C77B2A',
  Rickshaw: '#C99724',
  Car: '#E8EAEC',
  Premium: '#243B50',
};

function vehicleSvgMarkup(vehicle: VehicleType) {
  const paint = VEHICLE_COLORS[vehicle];

  if (vehicle === 'Bike') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="52" viewBox="0 0 72 52">
      <g fill="none" stroke="#1B2B34" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="13" cy="37" r="10" stroke-width="3.5"/><circle cx="59" cy="37" r="10" stroke-width="3.5"/>
        <path d="M13 37h15l10-17 10 17H28l-8-16h10m19 0h8" stroke="${paint}" stroke-width="4"/>
        <path d="M34 16h-7m22 0h7" stroke-width="3"/>
      </g>
      <circle cx="38" cy="20" r="3" fill="#F3F6F5"/>
    </svg>`;
  }

  if (vehicle === 'Rickshaw') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="72" viewBox="0 0 58 72">
      <g fill="#17232C">
        <rect x="7" y="12" width="7" height="19" rx="3"/><rect x="44" y="12" width="7" height="19" rx="3"/>
        <rect x="9" y="47" width="7" height="17" rx="3"/><rect x="42" y="47" width="7" height="17" rx="3"/>
      </g>
      <path d="M18 7h22l7 13v34H11V20z" fill="${paint}" stroke="#27343A" stroke-width="2"/>
      <path d="M20 12h18l5 11H15z" fill="#B8D7D8" stroke="#27343A" stroke-width="1.5"/>
      <path d="M15 27h28v18H15z" fill="#F3F6F5" stroke="#27343A" stroke-width="1.5"/>
      <path d="M19 31h20v10H19z" fill="#87AEB0"/>
      <path d="M8 53h42M19 7V4h20v3" fill="none" stroke="#27343A" stroke-width="2" stroke-linecap="round"/>
    </svg>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="72" viewBox="0 0 128 72">
    <path d="M13 19c4-7 11-10 21-10h52c11 0 19 4 25 12l10 13c4 5 4 11 0 16l-10 9c-6 5-14 7-25 7H33c-10 0-17-3-21-9L5 46c-3-5-3-11 0-16z"
      fill="#0D1920" opacity=".22" transform="translate(0 2)"/>
    <g fill="#10191F" stroke="#303B40" stroke-width="1">
      <rect x="25" y="3" width="16" height="21" rx="6"/>
      <rect x="83" y="3" width="16" height="21" rx="6"/>
      <rect x="25" y="48" width="16" height="21" rx="6"/>
      <rect x="83" y="48" width="16" height="21" rx="6"/>
    </g>
    <g fill="#78868B">
      <rect x="29" y="6" width="8" height="15" rx="4"/>
      <rect x="87" y="6" width="8" height="15" rx="4"/>
      <rect x="29" y="51" width="8" height="15" rx="4"/>
      <rect x="87" y="51" width="8" height="15" rx="4"/>
    </g>
    <path d="M13 20c4-7 11-10 21-10h52c11 0 19 4 25 12l10 13c4 5 4 11 0 16l-10 9c-6 5-14 7-25 7H33c-10 0-17-3-21-9L5 46c-3-5-3-11 0-16z"
      fill="${paint}" stroke="#59646A" stroke-width="2"/>
    <path d="M12 30l8-10q3-4 9-4v11l-4 8H8zM116 30l-8-10q-3-4-9-4v11l4 8h17z"
      fill="#F6F7F7" stroke="#AAB2B6" stroke-width="1"/>
    <path d="M8 27l9 2-4 9-9-2zM120 27l-9 2 4 9 9-2z"
      fill="#F4F6F6" stroke="#AAB2B6" stroke-width="1"/>
    <path d="M28 17h12v38H28q-6 0-9-5l-5-9 5-18q3-6 9-6z"
      fill="#243643" stroke="#C1C9CC" stroke-width="1.5"/>
    <path d="M42 16h42q5 0 7 5l4 12H39zM39 39h56l-4 13q-2 5-7 5H42z"
      fill="#243643" stroke="#C1C9CC" stroke-width="1.5"/>
    <path d="M96 21q6 2 10 8l6 9-6 9q-4 6-10 8l-5-11v-13z"
      fill="#243643" stroke="#C1C9CC" stroke-width="1.5"/>
    <path d="M40 35h57" fill="none" stroke="#9DAAAF" stroke-width="1.2"/>
    <path d="M17 38h9M102 38h9" fill="none" stroke="#53636A" stroke-width="1.2"/>
    <path d="M8 25l5 2-3 7-6-2zM8 47l5-2 3 7-5 2z"
      fill="#C64F47" stroke="#873A35" stroke-width=".8"/>
    <path d="M115 25l6 2 3 7-6 2zM115 47l6-2 3 2-3 7-6 2z"
      fill="#F5D99A" stroke="#A38B5A" stroke-width=".8"/>
    <path d="M17 13l8-4m78 4-8-4M17 59l8 4m78-4-8 4"
      fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity=".85"/>
  </svg>`;
}

export function vehicleMarkerDimensions(
  vehicle: VehicleType,
  accepted: boolean,
): [number, number] {
  if (vehicle === 'Car' || vehicle === 'Premium') return accepted ? [72, 42] : [60, 36];
  if (vehicle === 'Rickshaw') return accepted ? [48, 60] : [40, 50];
  return accepted ? [58, 42] : [48, 35];
}

export function vehicleSvgDataUri(vehicle: VehicleType) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(vehicleSvgMarkup(vehicle))}`;
}

export default function VehicleSilhouette({
  vehicle,
  width = 28,
  height = 40,
}: {
  vehicle: VehicleType;
  width?: number;
  height?: number;
}) {
  return <SvgXml xml={vehicleSvgMarkup(vehicle)} width={width} height={height} />;
}
