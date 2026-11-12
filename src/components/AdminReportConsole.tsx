import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Pressable, Text, TextInput } from './AppText';
import { adminApi } from '../lib/adminApi';

const COLORS = {
  ink: '#12273A',
  muted: '#63798A',
  green: '#0B786F',
  lime: '#D9F5EA',
  paper: '#F1F6F5',
  line: '#DCE8E5',
  white: '#FFFFFF',
  red: '#C34242',
};

const PAGE_SIZE = 50;
const FILTERS = ['open', 'reviewing', 'resolved', 'dismissed', 'all'] as const;
type ReportStatus = typeof FILTERS[number];
type ReportActionStatus = Exclude<ReportStatus, 'all' | 'open'>;

type RideReport = {
  report_id: string;
  request_id: string;
  reporter_id: string;
  reporter_name: string;
  reporter_email: string;
  reported_user_id: string;
  reported_name: string;
  reported_email: string;
  category: 'safety' | 'behavior' | 'vehicle' | 'fare' | 'other';
  details: string;
  status: Exclude<ReportStatus, 'all'>;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string;
  pickup_address: string;
  destination_address: string;
  vehicle: string;
  offered_fare: number;
  ride_created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRideReport(value: unknown): value is RideReport {
  return isRecord(value)
    && typeof value.report_id === 'string'
    && typeof value.request_id === 'string'
    && typeof value.reporter_id === 'string'
    && typeof value.reporter_name === 'string'
    && typeof value.reporter_email === 'string'
    && typeof value.reported_user_id === 'string'
    && typeof value.reported_name === 'string'
    && typeof value.reported_email === 'string'
    && ['safety', 'behavior', 'vehicle', 'fare', 'other'].includes(String(value.category))
    && typeof value.details === 'string'
    && ['open', 'reviewing', 'resolved', 'dismissed'].includes(String(value.status))
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at))
    && (value.reviewed_at === null
      || (typeof value.reviewed_at === 'string' && Number.isFinite(Date.parse(value.reviewed_at))))
    && (value.reviewed_by === null || typeof value.reviewed_by === 'string')
    && typeof value.review_note === 'string'
    && typeof value.pickup_address === 'string'
    && typeof value.destination_address === 'string'
    && typeof value.vehicle === 'string'
    && typeof value.offered_fare === 'number'
    && Number.isFinite(value.offered_fare)
    && typeof value.ride_created_at === 'string'
    && Number.isFinite(Date.parse(value.ride_created_at));
}

function formatStatus(status: string) {
  if (status === 'all') return 'All reports';
  if (status === 'open') return 'Open';
  if (status === 'reviewing') return 'Reviewing';
  if (status === 'resolved') return 'Resolved';
  return 'Dismissed';
}

export default function AdminReportConsole({
  onClose,
  onOpenUser,
}: {
  onClose: () => void;
  onOpenUser: (email: string) => void;
}) {
  const [filter, setFilter] = useState<ReportStatus>('open');
  const [reports, setReports] = useState<RideReport[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyReportId, setBusyReportId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        status: filter,
      });
      const result = await adminApi<unknown>(`/api/admin/reports?${params.toString()}`);
      if (!isRecord(result)
        || !Array.isArray(result.reports)
        || !result.reports.every(isRideReport)
        || typeof result.total !== 'number'
        || !Number.isSafeInteger(result.total)
        || result.total < 0) {
        throw new Error('The server returned invalid safety report data.');
      }
      setReports(result.reports);
      setTotal(result.total);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load rider reports.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, offset]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const changeFilter = (status: ReportStatus) => {
    setOffset(0);
    setFilter(status);
  };

  const updateReport = async (report: RideReport, status: ReportActionStatus) => {
    setBusyReportId(report.report_id);
    setError('');
    try {
      const result = await adminApi<{ success: boolean; status: string }>(
        `/api/admin/reports/${encodeURIComponent(report.report_id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status,
            note: (notes[report.report_id] ?? report.review_note).trim(),
          }),
        },
      );
      if (!result.success || result.status !== status) {
        throw new Error('The server did not confirm the report update.');
      }
      await refresh();
    } catch (updateError: unknown) {
      setError(updateError instanceof Error ? updateError.message : 'Could not update this report.');
    } finally {
      setBusyReportId(null);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing && !loading}
          onRefresh={() => void refresh()}
          tintColor={COLORS.green}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Ionicons name="shield-checkmark" size={19} color={COLORS.lime} />
            </View>
            <View>
              <Text style={styles.brandName}>SAWAARI</Text>
              <Text style={styles.brandCaption}>OPERATIONS CENTER</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-back-outline" size={15} color={COLORS.green} />
            <Text style={styles.backText}>Dashboard</Text>
          </Pressable>
        </View>
        <View style={styles.hero}>
          <Text style={styles.heroLabel}>RIDER SAFETY</Text>
          <Text style={styles.title}>Safety reports</Text>
          <Text style={styles.subtitle}>Review rider reports, follow up with the reported driver, and record a resolution.</Text>
          <Text style={styles.total}>{loading ? 'Loading reports…' : `${total} ${filter === 'all' ? '' : `${filter} `}report${total === 1 ? '' : 's'}`}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {FILTERS.map((status) => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: filter === status }}
              key={status}
              onPress={() => changeFilter(status)}
              style={[styles.filterButton, filter === status && styles.filterButtonActive]}
            >
              <Text style={[styles.filterText, filter === status && styles.filterTextActive]}>
                {formatStatus(status)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={17} color={COLORS.red} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void refresh()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}
        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={COLORS.green} />
            <Text style={styles.emptyText}>Loading reports…</Text>
          </View>
        ) : null}
        {!loading && reports.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={21} color={COLORS.green} />
            <Text style={styles.emptyText}>No {filter === 'all' ? '' : `${filter} `}reports found.</Text>
          </View>
        ) : null}
        <View style={styles.reportList}>
          {reports.map((report) => {
            const busy = busyReportId === report.report_id;
            return (
              <View key={report.report_id} style={styles.reportCard}>
                <View style={styles.cardHeading}>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryText}>{report.category.toUpperCase()}</Text>
                  </View>
                  <View style={[styles.statusBadge, report.status === 'open' && styles.openBadge]}>
                    <Text style={styles.statusText}>{formatStatus(report.status)}</Text>
                  </View>
                </View>
                <Text style={styles.details}>{report.details || 'No additional details were provided.'}</Text>
                <Text style={styles.meta}>
                  Reported by {report.reporter_name || report.reporter_email} · {new Date(report.created_at).toLocaleString()}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onOpenUser(report.reported_email)}
                  style={styles.driverButton}
                >
                  <Ionicons name="person-outline" size={15} color={COLORS.green} />
                  <Text style={styles.driverButtonText}>
                    {report.reported_name || report.reported_email} · Open driver profile
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={COLORS.green} />
                </Pressable>
                <View style={styles.rideBox}>
                  <Text style={styles.rideTitle}>REPORTED RIDE</Text>
                  <Text style={styles.rideText}>Pickup · {report.pickup_address}</Text>
                  <Text style={styles.rideText}>Destination · {report.destination_address}</Text>
                  <Text style={styles.meta}>
                    {report.vehicle} · PKR {report.offered_fare.toLocaleString()} · {new Date(report.ride_created_at).toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.label}>Review note</Text>
                <TextInput
                  accessibilityLabel={`Review note for report by ${report.reporter_name}`}
                  editable={!busy}
                  maxLength={500}
                  multiline
                  onChangeText={(text) => setNotes((current) => ({ ...current, [report.report_id]: text }))}
                  placeholder="Add an internal review note (optional)"
                  style={styles.noteInput}
                  value={notes[report.report_id] ?? report.review_note}
                />
                {report.reviewed_by ? (
                  <Text style={styles.meta}>
                    Last reviewed by {report.reviewed_by}
                    {report.reviewed_at ? ` · ${new Date(report.reviewed_at).toLocaleString()}` : ''}
                  </Text>
                ) : null}
                <View style={styles.actions}>
                  {report.status !== 'reviewing' ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void updateReport(report, 'reviewing')}
                      style={[styles.secondaryAction, busy && styles.disabled]}
                    >
                      <Text style={styles.secondaryActionText}>Mark reviewing</Text>
                    </Pressable>
                  ) : null}
                  {report.status !== 'resolved' ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void updateReport(report, 'resolved')}
                      style={[styles.primaryAction, busy && styles.disabled]}
                    >
                      <Text style={styles.primaryActionText}>Resolve</Text>
                    </Pressable>
                  ) : null}
                  {report.status !== 'dismissed' ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={busy}
                      onPress={() => void updateReport(report, 'dismissed')}
                      style={[styles.dismissAction, busy && styles.disabled]}
                    >
                      <Text style={styles.dismissActionText}>Dismiss</Text>
                    </Pressable>
                  ) : null}
                  {busy ? <ActivityIndicator size="small" color={COLORS.green} /> : null}
                </View>
              </View>
            );
          })}
        </View>
        {!loading && total > PAGE_SIZE ? (
          <View style={styles.pagination}>
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0}
              onPress={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              style={[styles.pageButton, offset === 0 && styles.disabled]}
            >
              <Text style={styles.secondaryActionText}>Previous</Text>
            </Pressable>
            <Text style={styles.meta}>{offset + 1}–{Math.min(offset + reports.length, total)} of {total}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={offset + PAGE_SIZE >= total}
              onPress={() => setOffset((current) => current + PAGE_SIZE)}
              style={[styles.pageButton, offset + PAGE_SIZE >= total && styles.disabled]}
            >
              <Text style={styles.secondaryActionText}>Next</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 18, paddingBottom: 42, backgroundColor: COLORS.paper },
  content: { width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 14 },
  topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.green },
  brandName: { color: COLORS.ink, fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
  brandCaption: { marginTop: 3, color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  backButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, backgroundColor: COLORS.white },
  backText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  hero: { gap: 8, padding: 22, borderRadius: 20, backgroundColor: COLORS.green },
  heroLabel: { color: COLORS.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  title: { color: COLORS.white, fontSize: 26, fontWeight: '900' },
  subtitle: { color: '#D5E6DA', fontSize: 11, lineHeight: 17 },
  total: { color: COLORS.lime, fontSize: 11, fontWeight: '800' },
  filters: { gap: 7, paddingVertical: 2 },
  filterButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 13, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, backgroundColor: COLORS.white },
  filterButtonActive: { borderColor: COLORS.green, backgroundColor: COLORS.green },
  filterText: { color: COLORS.muted, fontSize: 10, fontWeight: '800' },
  filterTextActive: { color: COLORS.white },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: '#FBE9E8' },
  errorText: { flex: 1, color: COLORS.red, fontSize: 10 },
  retryText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  emptyCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 15, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, backgroundColor: COLORS.white },
  emptyText: { color: COLORS.muted, fontSize: 11 },
  reportList: { gap: 10 },
  reportCard: { gap: 10, padding: 13, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, backgroundColor: COLORS.white },
  cardHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  categoryBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 15, backgroundColor: '#F3EFE2' },
  categoryText: { color: COLORS.ink, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 15, backgroundColor: '#E8F0E4' },
  openBadge: { backgroundColor: '#FBE9E8' },
  statusText: { color: COLORS.ink, fontSize: 9, fontWeight: '800' },
  details: { color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  meta: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  driverButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#EFF7F3' },
  driverButtonText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '900' },
  rideBox: { gap: 5, padding: 10, borderRadius: 9, backgroundColor: '#F6F8F7' },
  rideTitle: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  rideText: { color: COLORS.ink, fontSize: 10, lineHeight: 15 },
  label: { color: COLORS.ink, fontSize: 10, fontWeight: '800' },
  noteInput: { minHeight: 62, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, color: COLORS.ink, fontSize: 10, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 },
  secondaryAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, backgroundColor: COLORS.white },
  secondaryActionText: { color: COLORS.green, fontSize: 9, fontWeight: '900' },
  primaryAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: COLORS.green },
  primaryActionText: { color: COLORS.white, fontSize: 9, fontWeight: '900' },
  dismissAction: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: '#FBE9E8' },
  dismissActionText: { color: COLORS.red, fontSize: 9, fontWeight: '900' },
  disabled: { opacity: 0.5 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageButton: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, backgroundColor: COLORS.white },
});
