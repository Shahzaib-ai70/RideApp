import { SvgXml } from 'react-native-svg';

export type VehicleType = 'Bike' | 'Rickshaw' | 'Car' | 'Premium';

const VEHICLE_COLORS: Record<VehicleType, string> = {
  Bike: '#C77B2A',
  Rickshaw: '#C99724',
  Car: '#E51F2A',
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="72" height="128" viewBox="0 0 72 128">
    <path d="M25 4h22c9 0 14 7 16 17l4 19v51c0 14-7 23-19 28l-8 4H32l-8-4C12 114 5 105 5 91V40l4-19C11 11 16 4 25 4z"
      fill="#10191F" opacity=".3" transform="translate(1 2)"/>
    <g fill="#11191E" stroke="#303A3F" stroke-width="1">
      <rect x="2" y="27" width="13" height="23" rx="5"/>
      <rect x="57" y="27" width="13" height="23" rx="5"/>
      <rect x="2" y="78" width="13" height="23" rx="5"/>
      <rect x="57" y="78" width="13" height="23" rx="5"/>
    </g>
    <g fill="#66747A">
      <rect x="5" y="31" width="7" height="15" rx="3.5"/>
      <rect x="60" y="31" width="7" height="15" rx="3.5"/>
      <rect x="5" y="82" width="7" height="15" rx="3.5"/>
      <rect x="60" y="82" width="7" height="15" rx="3.5"/>
    </g>
    <path d="M25 4h22c9 0 14 7 16 17l4 19v51c0 14-7 23-19 28l-8 4H32l-8-4C12 114 5 105 5 91V40l4-19C11 11 16 4 25 4z"
      fill="${paint}" stroke="#8F111A" stroke-width="2"/>
    <path d="M25 7h22c7 0 11 5 13 14l2 9H10l2-9C14 12 18 7 25 7z"
      fill="#F02B35" stroke="#A5121D" stroke-width="1"/>
    <path d="M17 31h38l-3 12H20z" fill="#202B32" stroke="#AAB3B8" stroke-width="1.5"/>
    <path d="M19 33h14l4 8H21z" fill="#BCC8CE" opacity=".82"/>
    <path d="M39 33h13l-2 8H38z" fill="#101B22" opacity=".9"/>
    <path d="M16 45h40l3 34H13z" fill="#E51F2A" stroke="#A5121D" stroke-width="1"/>
    <path d="M19 48h34l2 13H17z" fill="#253640" stroke="#AAB3B8" stroke-width="1.5"/>
    <path d="M22 50h12l3 9H20z" fill="#BBC8CE" opacity=".78"/>
    <path d="M38 50h12l2 9H38z" fill="#111C23" opacity=".92"/>
    <path d="M17 65h38l-2 11H19z" fill="#202B32" stroke="#AAB3B8" stroke-width="1.5"/>
    <path d="M20 67h12l-2 7H19z" fill="#AEBBC1" opacity=".7"/>
    <path d="M14 43h5m34 0h5M13 81h5m36 0h5" fill="none" stroke="#A5121D" stroke-width="1.5"/>
    <path d="M12 37l5 2-2 6-7-1zM57 39l5-2 2 7-7 1z"
      fill="#FFF2CC" stroke="#BA9A60" stroke-width=".8"/>
    <path d="M10 89l7-1 2 7-5 3zM55 95l2-7 7 1-4 9z"
      fill="#D52A2A" stroke="#81131A" stroke-width=".8"/>
    <path d="M17 101h38l-4 10q-2 5-7 7l-6 3h-4l-6-3q-5-2-7-7z"
      fill="#D71924" stroke="#9D121B" stroke-width="1.5"/>
    <path d="M21 105h30l-4 7H25z" fill="#27353D" stroke="#9AA6AC" stroke-width="1.2"/>
    <path d="M27 8h18M29 119l7 3 7-3" fill="none" stroke="#FF7A7F" stroke-width="1.5" opacity=".85"/>
  </svg>`;
}

export function vehicleMarkerDimensions(
  vehicle: VehicleType,
  accepted: boolean,
): [number, number] {
  if (vehicle === 'Car' || vehicle === 'Premium') return accepted ? [46, 82] : [40, 72];
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
