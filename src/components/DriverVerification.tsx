import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { Pressable, Text, TextInput } from './AppText';
import { apiRequest } from '../lib/api';
import VehicleArt from './VehicleArt';

const COLORS = {
  ink: '#12273A',
  muted: '#63798A',
  green: '#0B786F',
  lime: '#D9F5EA',
  paper: '#F1F6F5',
  line: '#DCE8E5',
  white: '#FFFFFF',
  red: '#C34242',
  orange: '#E79A54',
};
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
  vehicle_color?: string;
  vehicle_registration_number?: string;
  driver_photo_url?: string | null;
  documents: unknown;
  status: DriverApplicationStatus;
  review_note: string;
};

type DocumentKind = 'cnic' | 'driving_license' | 'vehicle_registration' | 'vehicle_photo' | 'driver_photo';
type SelectedDocument = {
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  file?: ExpoFile;
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
  const [vehicleColor, setVehicleColor] = useState(application?.vehicle_color ?? '');
  const [registrationNumber, setRegistrationNumber] = useState(
    application?.vehicle_registration_number ?? '',
  );
  const [driverPhoto, setDriverPhoto] = useState<SelectedDocument | null>(null);
  const [documents, setDocuments] = useState<Record<DocumentKind, SelectedDocument | null>>({
    cnic: null,
    driving_license: null,
    vehicle_registration: null,
    vehicle_photo: null,
    driver_photo: null,
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

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
        || !['pdf', 'jpg', 'jpeg', 'png'].includes(extension)
        || (kind === 'driver_photo' && mimeType === 'application/pdf')) {
        throw new Error('Choose a PDF, JPG, JPEG, or PNG file.');
      }

      const webFile = Platform.OS === 'web' ? asset.file : undefined;
      const file = Platform.OS === 'web' ? undefined : new ExpoFile(asset.uri);
      const size = asset.size ?? webFile?.size ?? 0;
      if (size <= 0 || size > MAX_FILE_BYTES) {
        throw new Error('The file size could not be checked or it exceeds 10 MB. Choose a smaller file.');
      }
      const selected: SelectedDocument = {
        name: asset.name,
        mimeType,
        size,
        uri: asset.uri,
        ...(file ? { file } : {}),
        ...(webFile ? { webFile } : {}),
      };
      if (kind === 'driver_photo') setDriverPhoto(selected);
      else setDocuments((current) => ({ ...current, [kind]: selected }));
    } catch (pickError: unknown) {
      setError(pickError instanceof Error ? pickError.message : 'Could not open the document picker.');
    }
  };

  const submit = async () => {
    if (fullName.trim().length < 2 || vehicleMake.trim().length < 1
      || vehicleModel.trim().length < 1 || !/^\d{4}$/.test(vehicleYear)
      || Number(vehicleYear) < 1980 || Number(vehicleYear) > new Date().getFullYear() + 1
      || vehicleColor.trim().length < 2 || registrationNumber.trim().length < 2) {
      setError('Enter your legal name and valid vehicle make, model, year, color, and registration number.');
      return;
    }
    const missing = DOCUMENTS.find(({ kind }) => !documents[kind]);
    if (missing) {
      setError(`Please add: ${missing.label}.`);
      return;
    }
    if (!driverPhoto) {
      setError('Please add a clear driver profile photo. Riders see it after you accept their request.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('full_name', fullName.trim());
      formData.append('vehicle_type', vehicleType);
      formData.append('vehicle_make', vehicleMake.trim());
      formData.append('vehicle_model', vehicleModel.trim());
      formData.append('vehicle_year', String(Number(vehicleYear)));
      formData.append('vehicle_color', vehicleColor.trim());
      formData.append('vehicle_registration_number', registrationNumber.trim().toUpperCase());
      for (const [index, document] of DOCUMENTS.entries()) {
        const selected = documents[document.kind];
        if (!selected) throw new Error(`Please add: ${document.label}.`);
        const file = selected.webFile ?? selected.file;
        if (!file) throw new Error(`Could not read the selected ${document.label.toLowerCase()} file. Please choose it again.`);
        setProgress(`Preparing document ${index + 1} of ${DOCUMENTS.length}...`);
        const content = await file.arrayBuffer();
        formData.append(document.kind, new Blob([content], { type: selected.mimeType }), selected.name);
      }
      const photoFile = driverPhoto.webFile ?? driverPhoto.file;
      if (!photoFile) throw new Error('Could not read the selected driver photo. Please choose it again.');
      setProgress('Preparing driver photo...');
      const photoContent = await photoFile.arrayBuffer();
      formData.append(
        'driver_photo',
        new Blob([photoContent], { type: driverPhoto.mimeType }),
        driverPhoto.name,
      );

      setProgress('Uploading documents securely and submitting for review...');
      const result = await apiRequest<{ status: string }>('/driver/application', {
        method: 'POST',
        body: formData,
      });
      if (result.status !== 'pending') {
        throw new Error('The server did not confirm that your application entered review.');
      }

      setDocuments({
        cnic: null,
        driving_license: null,
        vehicle_registration: null,
        vehicle_photo: null,
        driver_photo: null,
      });
      setDriverPhoto(null);
      setProgress('');
      onSubmitted();
    } catch (submitError: unknown) {
      const detail = submitError instanceof Error ? submitError.message : 'Please try again.';
      setError(detail);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const savePublicProfile = async () => {
    if (vehicleColor.trim().length < 2 || registrationNumber.trim().length < 2) {
      setError('Enter your vehicle color and registration number so the rider can identify it.');
      return;
    }
    if (!driverPhoto && !application?.driver_photo_url) {
      setError('Add a clear driver photo so your rider can identify you.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('vehicle_color', vehicleColor.trim());
      formData.append('vehicle_registration_number', registrationNumber.trim().toUpperCase());
      if (driverPhoto) {
        const file = driverPhoto.webFile ?? driverPhoto.file;
        if (!file) throw new Error('Could not read the selected driver photo. Please choose it again.');
        const content = await file.arrayBuffer();
        formData.append(
          'driver_photo',
          new Blob([content], { type: driverPhoto.mimeType }),
          driverPhoto.name,
        );
      }
      const result = await apiRequest<{ success: boolean }>('/driver/profile', {
        method: 'POST',
        body: formData,
      });
      if (!result.success) throw new Error('The server did not confirm the profile update.');
      setDriverPhoto(null);
      setProgress('');
      onSubmitted();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save your driver profile.');
    } finally {
      setBusy(false);
    }
  };

  if (application && application.status !== 'needs_changes' && application.status !== 'rejected') {
    const approved = application.status === 'approved';
    const savedPhoto = driverPhoto?.uri ?? application.driver_photo_url;
    if (approved) {
      return (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your rider-facing driver profile</Text>
          <Text style={styles.copy}>
            Riders see these driver and vehicle details only after you accept their ride.
          </Text>
          {savedPhoto ? (
            <Image source={{ uri: savedPhoto }} style={styles.profilePhoto} />
          ) : (
            <View style={styles.profilePhotoPlaceholder}>
              <Ionicons name="person" size={28} color={COLORS.green} />
            </View>
          )}
          <Text style={styles.label}>Vehicle color</Text>
          <TextInput
            accessibilityLabel="Vehicle color shown to riders"
            value={vehicleColor}
            onChangeText={setVehicleColor}
            autoCapitalize="words"
            placeholder="e.g. White"
            editable={!busy}
            style={styles.input}
          />
          <Text style={styles.label}>Vehicle registration number</Text>
          <TextInput
            accessibilityLabel="Vehicle registration number shown to riders"
            value={registrationNumber}
            onChangeText={(value) => setRegistrationNumber(value.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="e.g. ABC-123"
            editable={!busy}
            maxLength={20}
            style={styles.input}
          />
          <View style={styles.documentRow}>
            <View style={styles.documentCopy}>
              <Text style={styles.documentTitle}>Driver photo</Text>
              <Text style={styles.documentDetail}>
                {driverPhoto?.name ?? 'A clear face photo helps your rider identify you.'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose driver profile photo"
              disabled={busy}
              onPress={() => void pickDocument('driver_photo')}
              style={styles.chooseButton}
            >
              <Text style={styles.chooseText}>{driverPhoto || application.driver_photo_url ? 'Replace' : 'Choose'}</Text>
            </Pressable>
          </View>
          <Text style={styles.privacy}>
            Your photo, vehicle color, and registration number are shared with the rider assigned to your accepted trip.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void savePublicProfile()}
            style={[styles.submitButton, busy && styles.disabledButton]}
          >
            {busy
              ? <ActivityIndicator color={COLORS.green} />
              : <Text style={styles.submitText}>Save rider-facing profile</Text>}
          </Pressable>
          {progress ? <Text style={styles.progress}>{progress}</Text> : null}
        </View>
      );
    }
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
        Submit your information and four private documents for manual review, plus a driver photo and vehicle details riders can use to identify you.
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
            <VehicleArt vehicle={item} selected={vehicleType === item} size={36} />
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
      <Text style={styles.label}>Vehicle color</Text>
      <TextInput
        accessibilityLabel="Vehicle color"
        value={vehicleColor}
        onChangeText={setVehicleColor}
        autoCapitalize="words"
        placeholder="e.g. White"
        editable={!busy}
        style={styles.input}
      />
      <Text style={styles.label}>Vehicle registration number</Text>
      <TextInput
        accessibilityLabel="Vehicle registration number"
        value={registrationNumber}
        onChangeText={(value) => setRegistrationNumber(value.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="e.g. ABC-123"
        editable={!busy}
        maxLength={20}
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
      <View style={styles.documentRow}>
        <View style={styles.documentCopy}>
          <Text style={styles.documentTitle}>Driver profile photo</Text>
          <Text style={styles.documentDetail}>
            {driverPhoto?.name ?? 'A clear face photo. Shared with your accepted rider.'}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose driver profile photo"
          disabled={busy}
          onPress={() => void pickDocument('driver_photo')}
          style={styles.chooseButton}
        >
          <Text style={styles.chooseText}>{driverPhoto ? 'Replace' : 'Choose'}</Text>
        </Pressable>
      </View>
      <Text style={styles.privacy}>
        Documents are private and only available to you and authorized reviewers. Your driver photo and vehicle details are shown only to the rider on your accepted ride.
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  vehicleButton: { minWidth: 74, alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  vehicleSelected: { backgroundColor: '#EAF1F7', borderColor: COLORS.green },
  vehicleText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  vehicleTextSelected: { color: COLORS.green },
  documentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  documentCopy: { flex: 1, gap: 3 },
  documentTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  documentDetail: { color: COLORS.muted, fontSize: 9, lineHeight: 13 },
  chooseButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAF1F7' },
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
  approvedIcon: { backgroundColor: '#EAF1F7' },
  profilePhoto: { width: 84, height: 84, alignSelf: 'center', borderRadius: 42, backgroundColor: COLORS.paper },
  profilePhotoPlaceholder: { width: 84, height: 84, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderRadius: 42, backgroundColor: COLORS.lime },
  statusTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  reviewNoteBox: { padding: 11, borderRadius: 10, backgroundColor: '#FFF2E5', gap: 4 },
  reviewNoteHeading: { color: COLORS.ink, fontSize: 10, fontWeight: '800' },
  reviewNote: { color: COLORS.ink, fontSize: 10, lineHeight: 15 },
});
