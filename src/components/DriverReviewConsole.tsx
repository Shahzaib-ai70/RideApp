import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { adminApi } from '../lib/adminApi';

const COLORS = {
  ink: '#172621',
  muted: '#75817B',
  green: '#0E4E3D',
  lime: '#C8F169',
  paper: '#F6F7F1',
  line: '#E8EBE4',
  white: '#FFFFFF',
  red: '#C34242',
  orange: '#EF9B54',
};

type ReviewDocument = { doc_type: string; path: string; content_type: string };
type ReviewApplication = {
  application_id: string;
  user_id: string;
  full_name: string;
  vehicle_type: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  documents: ReviewDocument[];
  submitted_at: string;
};

const DOCUMENT_LABELS: Record<string, string> = {
  cnic: 'CNIC, front and back',
  driving_license: 'Driving licence, front and back',
  vehicle_registration: 'Vehicle registration',
  vehicle_photo: 'Vehicle photo',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReviewApplication(value: unknown): value is ReviewApplication {
  if (!isRecord(value) || !Array.isArray(value.documents)) return false;
  return typeof value.application_id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.full_name === 'string'
    && typeof value.vehicle_type === 'string'
    && typeof value.vehicle_make === 'string'
    && typeof value.vehicle_model === 'string'
    && typeof value.vehicle_year === 'number'
    && typeof value.submitted_at === 'string'
    && value.documents.every((document: unknown) =>
      isRecord(document)
      && typeof document.doc_type === 'string'
      && typeof document.path === 'string'
      && typeof document.content_type === 'string');
}

export default function DriverReviewConsole({ onClose }: { onClose: () => void }) {
  const [applications, setApplications] = useState<ReviewApplication[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const data = await adminApi<unknown>('/api/admin/review-queue');
      if (!Array.isArray(data) || !data.every(isReviewApplication)) {
        throw new Error('The server returned an invalid application review list.');
      }
      setApplications(data);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load driver applications.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await refresh();
      if (active) setLoading(false);
    };
    void load();
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openDocument = async (path: string) => {
    try {
      const result = await adminApi<{ url: string }>('/api/admin/document-url', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });
      await Linking.openURL(result.url);
    } catch (openError: unknown) {
      setError(openError instanceof Error ? openError.message : 'Could not open this private document.');
    }
  };

  const review = async (applicationId: string, decision: 'approved' | 'needs_changes' | 'rejected') => {
    const note = notes[applicationId]?.trim() ?? '';
    if (decision !== 'approved' && note.length < 5) {
      setError('Add at least five characters of feedback before requesting changes or rejecting.');
      return;
    }
    setBusyId(applicationId);
    setError('');
    try {
      await adminApi('/api/admin/review', {
        method: 'POST',
        body: JSON.stringify({
          applicationId,
          decision,
          note,
        }),
      });
      await refresh();
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not update this review.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
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
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="arrow-back-outline" size={15} color={COLORS.green} />
            <Text style={styles.closeText}>Dashboard</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroLabel}>
            <Ionicons name="document-text-outline" size={15} color={COLORS.lime} />
            <Text style={styles.heroLabelText}>DRIVER VERIFICATION</Text>
          </View>
          <Text style={styles.title}>Application review</Text>
          <Text style={styles.subtitle}>
            Review documents carefully. Drivers can go online only after their application is approved.
          </Text>
          <View style={styles.queueBadge}>
            <Text style={styles.queueNumber}>{loading ? '—' : applications.length}</Text>
            <Text style={styles.queueLabel}>WAITING FOR REVIEW</Text>
          </View>
        </View>

        {error ? (
          <View style={styles.error}>
            <Ionicons name="warning-outline" size={18} color={COLORS.red} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {loading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator color={COLORS.green} />
            <Text style={styles.emptyCopy}>Loading applications…</Text>
          </View>
        ) : null}
        {!loading && applications.length === 0 && !error ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}><Ionicons name="checkmark-done-outline" size={24} color={COLORS.green} /></View>
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.emptyCopy}>New driver submissions will appear here automatically.</Text>
          </View>
        ) : null}
        {applications.map((application) => (
          <View key={application.application_id} style={styles.card}>
            <View style={styles.applicantHeader}>
              <View style={styles.applicantAvatar}><Ionicons name="person-outline" size={19} color={COLORS.green} /></View>
              <View style={styles.applicantCopy}>
                <Text style={styles.applicant}>{application.full_name}</Text>
                <Text style={styles.detail}>
                  {application.vehicle_type} · {application.vehicle_year} {application.vehicle_make} {application.vehicle_model}
                </Text>
              </View>
              <View style={styles.pendingBadge}><View style={styles.pendingDot} /><Text style={styles.pendingText}>PENDING</Text></View>
            </View>
            <View style={styles.submittedRow}>
              <Ionicons name="calendar-outline" size={14} color={COLORS.muted} />
              <Text style={styles.detail}>Submitted {new Date(application.submitted_at).toLocaleString()}</Text>
            </View>

            <View style={styles.divider} />
            <View style={styles.documentsHeading}>
              <View>
                <Text style={styles.sectionTitle}>Submitted documents</Text>
                <Text style={styles.detail}>Open each private file to review</Text>
              </View>
              <Ionicons name="lock-closed-outline" size={15} color={COLORS.muted} />
            </View>
            <View style={styles.documentsList}>
              {application.documents.map((document) => (
                <Pressable
                  key={document.path}
                  accessibilityRole="button"
                  onPress={() => void openDocument(document.path)}
                  style={styles.documentButton}
                >
                  <View style={styles.documentIcon}><Ionicons name="document-text-outline" size={17} color={COLORS.green} /></View>
                  <Text style={styles.documentText}>
                    {DOCUMENT_LABELS[document.doc_type] ?? 'Driver document'}
                  </Text>
                  <Ionicons name="open-outline" size={15} color={COLORS.green} />
                </Pressable>
              ))}
            </View>

            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>Review decision</Text>
            <TextInput
              accessibilityLabel={`Review feedback for ${application.full_name}`}
              value={notes[application.application_id] ?? ''}
              onChangeText={(value) => setNotes((current) => ({
                ...current,
                [application.application_id]: value,
              }))}
              placeholder="Add feedback (required for changes or rejection)"
              multiline
              editable={busyId !== application.application_id}
              style={styles.noteInput}
            />
            {busyId === application.application_id ? (
              <View style={styles.processing}><ActivityIndicator color={COLORS.green} /><Text style={styles.detail}>Saving decision…</Text></View>
            ) : (
              <View style={styles.actionRow}>
                <Pressable accessibilityRole="button" onPress={() => void review(application.application_id, 'approved')} style={styles.approveButton}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={COLORS.white} />
                  <Text style={styles.approveText}>Approve</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void review(application.application_id, 'needs_changes')} style={styles.changeButton}>
                  <Ionicons name="create-outline" size={15} color="#8C551F" />
                  <Text style={styles.changeText}>Request changes</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => void review(application.application_id, 'rejected')} style={styles.rejectButton}>
                  <Ionicons name="close-circle-outline" size={15} color={COLORS.red} />
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
        <View style={styles.disclaimerCard}>
          <Ionicons name="lock-closed-outline" size={15} color={COLORS.muted} />
          <Text style={styles.disclaimer}>
            These files contain sensitive identity information. Do not download or share documents outside the verification process.
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 42, backgroundColor: COLORS.paper, flexGrow: 1 },
  content: { width: '100%', maxWidth: 960, alignSelf: 'center', gap: 16 },
  topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.green },
  brandName: { color: COLORS.ink, fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
  brandCaption: { marginTop: 3, color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  closeButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  closeText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  hero: { padding: 20, borderRadius: 19, backgroundColor: COLORS.green, gap: 10 },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroLabelText: { color: '#D5E6DA', fontSize: 9, fontWeight: '800', letterSpacing: 1.3 },
  title: { color: COLORS.white, fontSize: 27, fontWeight: '900' },
  subtitle: { maxWidth: 620, color: '#D5E6DA', fontSize: 11, lineHeight: 17 },
  queueBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 3, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: '#FFFFFF1A' },
  queueNumber: { color: COLORS.lime, fontSize: 16, fontWeight: '900' },
  queueLabel: { color: COLORS.white, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  card: { padding: 16, borderRadius: 17, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 12 },
  applicantHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  applicantAvatar: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#E8F0E4' },
  applicantCopy: { flex: 1, gap: 4 },
  applicant: { color: COLORS.ink, fontSize: 14, fontWeight: '900' },
  detail: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  pendingBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20, backgroundColor: '#FFF2E5' },
  pendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.orange },
  pendingText: { color: '#8C551F', fontSize: 8, fontWeight: '900' },
  submittedRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  divider: { height: 1, backgroundColor: COLORS.line },
  documentsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '900' },
  documentsList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  documentButton: { minHeight: 50, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, backgroundColor: '#FAFBF8', flexGrow: 1, flexShrink: 1, flexBasis: 220 },
  documentIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#E8F0E4' },
  documentText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '800' },
  noteInput: { minHeight: 76, padding: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, color: COLORS.ink, backgroundColor: '#FAFBF8', textAlignVertical: 'top', fontSize: 11 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  approveButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: COLORS.green },
  approveText: { color: COLORS.white, fontSize: 10, fontWeight: '900' },
  changeButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, borderRadius: 10, backgroundColor: '#FFF2E5' },
  changeText: { color: '#8C551F', fontSize: 10, fontWeight: '900' },
  rejectButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 13, borderRadius: 10, backgroundColor: '#FBE9E8' },
  rejectText: { color: COLORS.red, fontSize: 10, fontWeight: '900' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: '#FBE9E8' },
  errorText: { flex: 1, color: COLORS.red, fontSize: 10, lineHeight: 15 },
  loadingCard: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  processing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 8 },
  empty: { alignItems: 'center', padding: 28, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  emptyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#E8F0E4' },
  emptyTitle: { marginTop: 11, color: COLORS.ink, fontSize: 15, fontWeight: '900' },
  emptyCopy: { marginTop: 5, color: COLORS.muted, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  disclaimerCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#ECEFE9' },
  disclaimer: { flex: 1, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
});
