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
import { supabase } from '../lib/supabase';

const BUCKET = 'sawaari-driver-documents';
const COLORS = {
  ink: '#172621',
  muted: '#75817B',
  green: '#0E4E3D',
  lime: '#C8F169',
  paper: '#F6F7F1',
  line: '#E8EBE4',
  white: '#FFFFFF',
  red: '#C34242',
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
    if (!supabase) return;
    setError('');
    const { data, error: loadError } = await supabase.rpc('get_driver_review_queue');
    if (loadError) {
      setError(loadError.message);
      return;
    }
    if (!Array.isArray(data) || !data.every(isReviewApplication)) {
      setError('The server returned an invalid application review list.');
      return;
    }
    setApplications(data);
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
    if (!supabase) return;
    try {
      const { data, error: linkError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 120);
      if (linkError) throw linkError;
      await Linking.openURL(data.signedUrl);
    } catch (openError: unknown) {
      setError(openError instanceof Error ? openError.message : 'Could not open this private document.');
    }
  };

  const review = async (applicationId: string, decision: 'approved' | 'needs_changes' | 'rejected') => {
    if (!supabase) return;
    const note = notes[applicationId]?.trim() ?? '';
    if (decision !== 'approved' && note.length < 5) {
      setError('Add at least five characters of feedback before requesting changes or rejecting.');
      return;
    }
    setBusyId(applicationId);
    setError('');
    try {
      const { error: reviewError } = await supabase.rpc('review_driver_application', {
        p_application_id: applicationId,
        p_decision: decision,
        p_review_note: note,
      });
      if (reviewError) throw reviewError;
      await refresh();
    } catch (reviewError: unknown) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not update this review.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>AUTHORIZED REVIEWER</Text>
          <Text style={styles.title}>Driver applications</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        Review each private file carefully. A driver can go online only after you approve their application.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <ActivityIndicator color={COLORS.green} /> : null}
      {!loading && applications.length === 0 && !error ? (
        <View style={styles.empty}>
          <Ionicons name="checkmark-done-outline" size={25} color={COLORS.green} />
          <Text style={styles.emptyTitle}>No applications waiting</Text>
          <Text style={styles.emptyCopy}>Pending driver submissions will appear here.</Text>
        </View>
      ) : null}
      {applications.map((application) => (
        <View key={application.application_id} style={styles.card}>
          <Text style={styles.applicant}>{application.full_name}</Text>
          <Text style={styles.detail}>
            {application.vehicle_type} · {application.vehicle_year} {application.vehicle_make} {application.vehicle_model}
          </Text>
          <Text style={styles.detail}>
            Submitted {new Date(application.submitted_at).toLocaleString()}
          </Text>
          <Text style={styles.sectionTitle}>Private documents</Text>
          {application.documents.map((document) => (
            <Pressable
              key={document.path}
              accessibilityRole="button"
              onPress={() => void openDocument(document.path)}
              style={styles.documentButton}
            >
              <Ionicons name="document-text-outline" size={17} color={COLORS.green} />
              <Text style={styles.documentText}>
                Open {DOCUMENT_LABELS[document.doc_type] ?? 'document'}
              </Text>
              <Ionicons name="open-outline" size={15} color={COLORS.muted} />
            </Pressable>
          ))}
          <TextInput
            accessibilityLabel={`Review feedback for ${application.full_name}`}
            value={notes[application.application_id] ?? ''}
            onChangeText={(value) => setNotes((current) => ({
              ...current,
              [application.application_id]: value,
            }))}
            placeholder="Feedback (required for changes or rejection)"
            multiline
            editable={busyId !== application.application_id}
            style={styles.noteInput}
          />
          {busyId === application.application_id ? (
            <ActivityIndicator color={COLORS.green} />
          ) : (
            <View style={styles.actionRow}>
              <Pressable onPress={() => void review(application.application_id, 'approved')} style={styles.approveButton}>
                <Text style={styles.approveText}>Approve</Text>
              </Pressable>
              <Pressable onPress={() => void review(application.application_id, 'needs_changes')} style={styles.changeButton}>
                <Text style={styles.changeText}>Request changes</Text>
              </Pressable>
              <Pressable onPress={() => void review(application.application_id, 'rejected')} style={styles.rejectButton}>
                <Text style={styles.rejectText}>Reject</Text>
              </Pressable>
            </View>
          )}
        </View>
      ))}
      <Text style={styles.disclaimer}>
        Only use this reviewer access for verification tasks. These files contain sensitive identity information; do not download or share them unnecessarily.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 36, gap: 12, backgroundColor: COLORS.paper, flexGrow: 1 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingCopy: { flex: 1 },
  eyebrow: { marginTop: 6, color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { marginTop: 4, color: COLORS.ink, fontSize: 25, fontWeight: '800' },
  subtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  closeButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#E7F3E2' },
  closeText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  card: { padding: 14, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 9 },
  applicant: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  detail: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  sectionTitle: { marginTop: 4, color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  documentButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#F6F8F2' },
  documentText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '700' },
  noteInput: { minHeight: 58, padding: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, color: COLORS.ink, backgroundColor: COLORS.white, textAlignVertical: 'top', fontSize: 11 },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  approveButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: COLORS.lime },
  approveText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  changeButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#FFF2E5' },
  changeText: { color: '#8C551F', fontSize: 10, fontWeight: '800' },
  rejectButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#FBE9E8' },
  rejectText: { color: COLORS.red, fontSize: 10, fontWeight: '800' },
  error: { padding: 10, borderRadius: 10, color: COLORS.red, backgroundColor: '#FBE9E8', fontSize: 10, lineHeight: 15 },
  empty: { alignItems: 'center', padding: 20, borderRadius: 15, backgroundColor: COLORS.white },
  emptyTitle: { marginTop: 7, color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  emptyCopy: { marginTop: 4, color: COLORS.muted, fontSize: 10, textAlign: 'center' },
  disclaimer: { marginTop: 4, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
});
