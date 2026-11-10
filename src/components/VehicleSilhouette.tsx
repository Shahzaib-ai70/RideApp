import { SvgXml } from 'react-native-svg';

export type VehicleType = 'Bike' | 'Rickshaw' | 'Car' | 'Premium';

const VEHICLE_COLORS: Record<VehicleType, string> = {
  Bike: '#C77B2A',
  Rickshaw: '#C99724',
  Car: '#0B786F',
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

  return `<svg xmlns="http://www.w3.org/2000/svg" width="58" height="88" viewBox="0 0 58 88">
    <g fill="#17232C">
      <path d="M1 22a3 3 0 0 1 3-3h4v18H4a3 3 0 0 1-3-3z"/>
      <path d="M57 22a3 3 0 0 0-3-3h-4v18h4a3 3 0 0 0 3-3z"/>
      <path d="M1 56a3 3 0 0 1 3-3h4v18H4a3 3 0 0 1-3-3z"/>
      <path d="M57 56a3 3 0 0 0-3-3h-4v18h4a3 3 0 0 0 3-3z"/>
    </g>
    <path d="M19 3h20c5 0 8 4 10 10l5 17v38c0 8-5 13-13 15v2H17v-2C9 81 4 76 4 68V30l5-17C11 7 14 3 19 3z"
      fill="${paint}" stroke="#25343D" stroke-width="2"/>
    <path d="M17 9h24c3 0 5 2 6 6l3 11H8l3-11c1-4 3-6 6-6z"
      fill="#AFC9D1" stroke="#26363F" stroke-width="1.5"/>
    <path d="M9 29h40v29H9z" fill="${paint}" stroke="#26363F" stroke-width="1.5"/>
    <path d="M14 32h30v12H14z" fill="#243B4A" stroke="#D8E6E7" stroke-width="1"/>
    <path d="M14 46h30v9H14z" fill="#243B4A" stroke="#D8E6E7" stroke-width="1"/>
    <path d="M10 61h38l-3 10c-1 4-4 6-8 7H21c-4-1-7-3-8-7z"
      fill="#AFC9D1" stroke="#26363F" stroke-width="1.5"/>
    <path d="M8 17h4M46 17h4M8 72h4M46 72h4" stroke="#F5D991" stroke-width="3" stroke-linecap="round"/>
    <path d="M21 5h16M21 82h16" stroke="#EEF3F1" stroke-width="1.5" opacity=".8"/>
  </svg>`;
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
