import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';

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
const BUCKET = 'sawaari-driver-documents';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export type DriverApplicationStatus = 'pending' | 'approved' | 'needs_changes' | 'rejected';
export type DriverApplicationSummary = {
  application_id: string;
  full_name: string;
  vehicle_type: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
  documents: unknown;
  status: DriverApplicationStatus;
  review_note: string;
};

type DocumentKind = 'cnic' | 'driving_license' | 'vehicle_registration' | 'vehicle_photo';
type SelectedDocument = {
  name: string;
  mimeType: string;
  size: number;
  file: ExpoFile;
  webFile?: File;
};

const DOCUMENTS: { kind: DocumentKind; label: string; detail: string }[] = [
  { kind: 'cnic', label: 'CNIC, front and back', detail: 'One PDF or clear image showing both sides.' },
  { kind: 'driving_license', label: 'Driving licence, front and back', detail: 'One PDF or clear image showing both sides.' },
  { kind: 'vehicle_registration', label: 'Vehicle registration', detail: 'Registration card or book.' },
  { kind: 'vehicle_photo', label: 'Vehicle photo', detail: 'A clear current photo of the vehicle.' },
];

const VEHICLES = ['Bike', 'Rickshaw', 'Car', 'Premium'] as const;

function getExtension(name: string) {
  return name.toLowerCase().split('.').pop() ?? '';
}

function mimeFromExtension(extension: string) {
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return '';
}

function storedDocumentPaths(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((document: unknown) => {
    if (typeof document !== 'object' || document === null) return [];
    const path = (document as Record<string, unknown>).path;
    return typeof path === 'string' ? [path] : [];
  });
}

export default function DriverVerification({
  application,
  onSubmitted,
}: {
  application: DriverApplicationSummary | null;
  onSubmitted: () => void;
}) {
  const [fullName, setFullName] = useState(application?.full_name ?? '');
  const [vehicleType, setVehicleType] = useState<(typeof VEHICLES)[number]>(
    VEHICLES.includes(application?.vehicle_type as (typeof VEHICLES)[number])
      ? application?.vehicle_type as (typeof VEHICLES)[number]
      : 'Car',
  );
  const [vehicleMake, setVehicleMake] = useState(application?.vehicle_make ?? '');
  const [vehicleModel, setVehicleModel] = useState(application?.vehicle_model ?? '');
  const [vehicleYear, setVehicleYear] = useState(application?.vehicle_year
    ? String(application.vehicle_year)
    : '');
  const [documents, setDocuments] = useState<Record<DocumentKind, SelectedDocument | null>>({
    cnic: null,
    driving_license: null,
    vehicle_registration: null,
    vehicle_photo: null,
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [cleanupWarning, setCleanupWarning] = useState('');

  const pickDocument = async (kind: DocumentKind) => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...MIME_TYPES],
        copyToCacheDirectory: true,
        multiple: false,
        base64: false,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const extension = getExtension(asset.name);
      const mimeType = asset.mimeType || mimeFromExtension(extension);
      if (!MIME_TYPES.includes(mimeType as (typeof MIME_TYPES)[number])
        || !['pdf', 'jpg', 'jpeg', 'png'].includes(extension)) {
        throw new Error('Choose a PDF, JPG, JPEG, or PNG file.');
      }

      const file = new ExpoFile(asset.uri);
      const size = asset.size ?? asset.file?.size ?? 0;
      if (size <= 0 || size > MAX_FILE_BYTES) {
        throw new Error('The file size could not be checked or it exceeds 10 MB. Choose a smaller file.');
      }
      setDocuments((current) => ({
        ...current,
        [kind]: {
          name: asset.name,
          mimeType,
          size,
          file,
          ...(asset.file ? { webFile: asset.file } : {}),
        },
      }));
    } catch (pickError: unknown) {
      setError(pickError instanceof Error ? pickError.message : 'Could not open the document picker.');
    }
  };

  const submit = async () => {
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }
    if (fullName.trim().length < 2 || vehicleMake.trim().length < 1
      || vehicleModel.trim().length < 1 || !/^\d{4}$/.test(vehicleYear)
      || Number(vehicleYear) < 1980 || Number(vehicleYear) > new Date().getFullYear() + 1) {
      setError('Enter your legal name and valid vehicle make, model, and year.');
      return;
    }
    const missing = DOCUMENTS.find(({ kind }) => !documents[kind]);
    if (missing) {
      setError(`Please add: ${missing.label}.`);
      return;
    }

    setBusy(true);
    setError('');
    setCleanupWarning('');
    const uploadedPaths: string[] = [];
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) throw new Error('Sign in again before submitting your application.');

      const documentRows: {
        doc_type: DocumentKind;
        path: string;
        content_type: string;
        size: number;
      }[] = [];

      for (const [index, document] of DOCUMENTS.entries()) {
        const selected = documents[document.kind];
        if (!selected) throw new Error(`Please add: ${document.label}.`);
        setProgress(`Uploading document ${index + 1} of ${DOCUMENTS.length}...`);
        const extension = getExtension(selected.name);
        const uniqueFolder = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
        const path = `${userId}/${uniqueFolder}/${document.kind}.${extension}`;
        const { error: uploadError } = await supabase.storage.from(BUCKET).upload(
          path,
          selected.webFile
            ? await selected.webFile.arrayBuffer()
            : await selected.file.arrayBuffer(),
          { contentType: selected.mimeType, upsert: false },
        );
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        documentRows.push({
          doc_type: document.kind,
          path,
          content_type: selected.mimeType,
          size: selected.size,
        });
      }

      setProgress('Submitting for review...');
      const { data, error: submitError } = await supabase.rpc('submit_driver_application', {
        p_full_name: fullName.trim(),
        p_vehicle_type: vehicleType,
        p_vehicle_make: vehicleMake.trim(),
        p_vehicle_model: vehicleModel.trim(),
        p_vehicle_year: Number(vehicleYear),
        p_documents: documentRows,
      });
      if (submitError) throw submitError;
      if (!Array.isArray(data) || data.length !== 1 || data[0].status !== 'pending') {
        throw new Error('The server did not confirm that your application entered review.');
      }

      const previousPaths = storedDocumentPaths(application?.documents);
      if (previousPaths.length > 0) {
        try {
          const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(previousPaths);
          if (cleanupError) throw cleanupError;
        } catch {
          setCleanupWarning(
            'Your new application is submitted. Older private document files could not be removed automatically; remove them from Supabase Storage when convenient.',
          );
        }
      }
      setDocuments({ cnic: null, driving_license: null, vehicle_registration: null, vehicle_photo: null });
      setProgress('');
      onSubmitted();
    } catch (submitError: unknown) {
      const detail = submitError instanceof Error ? submitError.message : 'Please try again.';
      if (uploadedPaths.length > 0 && supabase) {
        const { error: cleanupError } = await supabase.storage.from(BUCKET).remove(uploadedPaths);
        setError(cleanupError
          ? `${detail} Some uploaded files remain private in your account and may be removed from Supabase Storage.`
          : detail);
      } else {
        setError(detail);
      }
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  if (application && application.status !== 'needs_changes' && application.status !== 'rejected') {
    const approved = application.status === 'approved';
    return (
      <View style={styles.statusCard}>
        <View style={[styles.statusIcon, approved && styles.approvedIcon]}>
          <Ionicons
            name={approved ? 'checkmark-circle-outline' : 'time-outline'}
            size={24}
            color={approved ? COLORS.green : COLORS.orange}
          />
        </View>
        <Text style={styles.statusTitle}>{approved ? 'Driver documents approved' : 'Application under review'}</Text>
        <Text style={styles.copy}>
          {approved
            ? 'Your driver verification is approved. You can now set your driver profile and go online.'
            : 'Your documents were submitted for review. Driver requests and going online stay locked until approval.'}
        </Text>
        {application.review_note ? <Text style={styles.reviewNote}>{application.review_note}</Text> : null}
      </View>
    );
  }

  const isResubmission = Boolean(application);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{isResubmission ? 'Update your documents' : 'Driver verification'}</Text>
      <Text style={styles.copy}>
        Submit your information and four documents for manual review. Only you and an authorized Sawaari reviewer can access your files.
      </Text>
      {application?.review_note ? (
        <View style={styles.reviewNoteBox}>
          <Text style={styles.reviewNoteHeading}>Reviewer feedback</Text>
          <Text style={styles.reviewNote}>{application.review_note}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Full legal name</Text>
      <TextInput
        accessibilityLabel="Full legal name"
        value={fullName}
        onChangeText={setFullName}
        autoCapitalize="words"
        placeholder="Name as shown on your CNIC"
        editable={!busy}
        style={styles.input}
      />
      <Text style={styles.label}>Vehicle category</Text>
      <View style={styles.vehicleRow}>
        {VEHICLES.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="radio"
            accessibilityState={{ selected: vehicleType === item }}
            disabled={busy}
            onPress={() => setVehicleType(item)}
            style={[styles.vehicleButton, vehicleType === item && styles.vehicleSelected]}
          >
            <Text style={[styles.vehicleText, vehicleType === item && styles.vehicleTextSelected]}>{item}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.label}>Vehicle make</Text>
      <TextInput
        accessibilityLabel="Vehicle make"
        value={vehicleMake}
        onChangeText={setVehicleMake}
        placeholder="e.g. Honda"
        editable={!busy}
        style={styles.input}
      />
      <Text style={styles.label}>Vehicle model</Text>
      <TextInput
        accessibilityLabel="Vehicle model"
        value={vehicleModel}
        onChangeText={setVehicleModel}
        placeholder="e.g. City"
        editable={!busy}
        style={styles.input}
      />
      <Text style={styles.label}>Vehicle year</Text>
      <TextInput
        accessibilityLabel="Vehicle year"
        value={vehicleYear}
        onChangeText={(value) => setVehicleYear(value.replace(/\D/g, '').slice(0, 4))}
        placeholder="e.g. 2022"
        keyboardType="number-pad"
        editable={!busy}
        style={styles.input}
      />

      <Text style={styles.label}>Required documents</Text>
      {DOCUMENTS.map(({ kind, label, detail }) => (
        <View key={kind} style={styles.documentRow}>
          <View style={styles.documentCopy}>
            <Text style={styles.documentTitle}>{label}</Text>
            <Text style={styles.documentDetail}>{documents[kind]?.name ?? detail}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Choose ${label}`}
            disabled={busy}
            onPress={() => void pickDocument(kind)}
            style={styles.chooseButton}
          >
            <Text style={styles.chooseText}>{documents[kind] ? 'Replace' : 'Choose'}</Text>
          </Pressable>
        </View>
      ))}
      <Text style={styles.privacy}>
        PDF, JPG, or PNG · up to 10 MB each. Do not upload documents belonging to anyone else. Documents are private and are not displayed to riders.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {cleanupWarning ? <Text style={styles.privacy}>{cleanupWarning}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void submit()}
        style={[styles.submitButton, busy && styles.disabledButton]}
      >
        {busy
          ? <ActivityIndicator color={COLORS.green} />
          : <Text style={styles.submitText}>{isResubmission ? 'Resubmit for review' : 'Submit for review'}</Text>}
      </Pressable>
      {progress ? <Text style={styles.progress}>{progress}</Text> : null}
      <Text style={styles.disclaimer}>
        This app collects documents for manual review only. It does not verify identities against NADRA or government databases. Do not use this MVP for real passenger trips.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 15, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 10 },
  cardTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  copy: { color: COLORS.muted, fontSize: 11, lineHeight: 17 },
  label: { marginTop: 4, color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  input: { minHeight: 44, paddingHorizontal: 11, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, color: COLORS.ink, backgroundColor: COLORS.white },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  vehicleButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.paper },
  vehicleSelected: { backgroundColor: '#E5F0DC', borderWidth: 1, borderColor: COLORS.green },
  vehicleText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  vehicleTextSelected: { color: COLORS.green },
  documentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  documentCopy: { flex: 1, gap: 3 },
  documentTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  documentDetail: { color: COLORS.muted, fontSize: 9, lineHeight: 13 },
  chooseButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#E7F3E2' },
  chooseText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  privacy: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  error: { padding: 10, borderRadius: 10, color: COLORS.red, backgroundColor: '#FBE9E8', fontSize: 10, lineHeight: 15 },
  submitButton: { minHeight: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: COLORS.lime },
  disabledButton: { opacity: 0.7 },
  submitText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  progress: { color: COLORS.green, fontSize: 10, textAlign: 'center' },
  disclaimer: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  statusCard: { padding: 16, alignItems: 'center', borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, backgroundColor: COLORS.white, gap: 9 },
  statusIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#FFF2E5' },
  approvedIcon: { backgroundColor: '#E7F3E2' },
  statusTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  reviewNoteBox: { padding: 11, borderRadius: 10, backgroundColor: '#FFF2E5', gap: 4 },
  reviewNoteHeading: { color: COLORS.ink, fontSize: 10, fontWeight: '800' },
  reviewNote: { color: COLORS.ink, fontSize: 10, lineHeight: 15 },
});
