import AdminScreen from '../components/AdminScreen';
import { pageMetadata } from '../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata('Admin panel | Sawaari', 'Private Sawaari operations panel.', '/admin', true);
}

export default function AdminRoute() {
  return <AdminScreen />;
}
