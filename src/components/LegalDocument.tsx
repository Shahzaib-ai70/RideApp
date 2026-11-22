import { Link } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from './AppText';

type LegalDocumentKind = 'privacy' | 'terms';

type LegalSection = {
  title: string;
  paragraphs: string[];
};

const documents: Record<LegalDocumentKind, { title: string; sections: LegalSection[] }> = {
  privacy: {
    title: 'Privacy Policy',
    sections: [
      {
        title: 'Information Sawaari handles',
        paragraphs: [
          'Account information includes your email address, display name, password hash, email-verification state, and session records.',
          'Sawaari also uses your email address for verification and account-deletion email requests and to rate limit those requests. One-time deletion tokens expire after 24 hours; request-rate records are removed after 30 days.',
          'Ride information can include pickup and destination addresses and coordinates, vehicle choice, fare offers, ride status, ratings, safety reports, and messages between ride participants.',
          'If you apply to drive, Sawaari handles your legal name, vehicle details, CNIC, driving licence, vehicle registration, driver photo, application status, and documents you submit. Driver documents are stored outside the public website and are available to authorized reviewers.',
          'Location is used for ride pickup selection and, when a driver is online or completing an active ride, to show the driver’s location. Driver location sharing runs while the app is open; the app does not use background location.',
          'Support messages sent through Sawaari are stored so the support team can respond.',
        ],
      },
      {
        title: 'How information is used',
        paragraphs: [
          'Sawaari uses this information to create and secure accounts, confirm email addresses, find and coordinate rides, show relevant trip details to riders and drivers, review driver applications, respond to support requests, handle safety reports, and operate and protect the service.',
          'The app does not process electronic payments. Riders and drivers exchange any agreed fare directly in cash.',
        ],
      },
      {
        title: 'Service providers and sharing',
        paragraphs: [
          'Trip details needed to arrange a ride are shown to the relevant rider and driver. Authorized Sawaari reviewers can access driver application information and documents for application review.',
          'When you use maps, routes, or address search, relevant search text or location coordinates may be sent to Mapbox, TomTom, or OpenStreetMap/Photon to provide those features. Email is sent through Sawaari’s email delivery provider. Sawaari also uses server and database infrastructure to operate the service.',
          'Sawaari does not sell personal information. Information may also be disclosed when required by law or to protect users and the service, subject to applicable law.',
        ],
      },
      {
        title: 'Storage, security, and retention',
        paragraphs: [
          'Account, ride, driver-application, and support records are stored on Sawaari’s server and database. Driver documents are kept in private server storage and are not intended to be publicly accessible.',
          'Sawaari uses safeguards such as password hashing, access controls for private documents, and HTTPS in production. No online service can guarantee absolute security.',
          'Sawaari keeps information while it is needed to provide and protect the service. When an account is deleted, account-linked records are removed from active systems. Ride records created by other users may remain; deleted driver accounts are unlinked and their stored driver-location fields are cleared.',
          'Sawaari does not currently configure automated backups for the production database or private driver-document storage. We have not verified whether the hosting provider creates infrastructure-level snapshots or how long any such copies are retained. Account deletion removes data from active application systems; provider-managed copies, if any, may be subject to the provider’s retention practices.',
        ],
      },
      {
        title: 'Your choices and account deletion',
        paragraphs: [
          'You can choose whether to grant location permission. Without it, you can still select locations manually, but location-based features may be limited.',
          'You can delete your account in the app from Profile by choosing Delete account and confirming with your current password. You can also request deletion on the web and confirm it using a link sent to your account email. The email link expires after 24 hours. Deletion removes the account and associated active records; some ride records involving other users may remain without the deleted driver’s account details.',
        ],
      },
      {
        title: 'Contact',
        paragraphs: [
          'For privacy questions, email support@sawaari.online or use Help & support in the Sawaari app’s Profile screen. Sawaari Pakistan operates from Lahore, Pakistan.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    sections: [
      {
        title: 'About Sawaari',
        paragraphs: [
          'Sawaari is a platform that helps riders request trips and helps drivers discover and respond to those requests. Sawaari does not itself provide the vehicle or transport service and cannot guarantee that a ride or driver will be available.',
        ],
      },
      {
        title: 'Accounts and accurate information',
        paragraphs: [
          'Keep your account credentials secure and provide accurate information when creating an account or using Sawaari. You are responsible for activity carried out through your account, subject to applicable law.',
        ],
      },
      {
        title: 'Ride requests and fares',
        paragraphs: [
          'A rider may submit pickup and destination details, choose a vehicle type, and offer a fare. A driver may accept or respond with an offer. The rider and driver are responsible for confirming the final trip and fare with each other.',
          'Sawaari does not collect, hold, transfer, or electronically process fares. Any cash fare is exchanged directly between rider and driver. Sawaari does not currently provide electronic payments or payouts.',
          'Riders and drivers can cancel requests in the app. The current service does not provide an automated emergency-response or SOS service.',
        ],
      },
      {
        title: 'Driver applications',
        paragraphs: [
          'Drivers must submit accurate vehicle and application information and are responsible for holding any licence, registration, insurance, and other authorization required by applicable law.',
          'Sawaari reviews submitted applications before enabling driver mode. This review is not a government identity check, a guarantee of a driver’s conduct, or a guarantee that a document is authentic.',
        ],
      },
      {
        title: 'Location and safety',
        paragraphs: [
          'Location permission is optional but needed for some map and pickup features. Driver location is shared while the driver app is open and the driver is online or on an active ride. Sawaari does not currently provide background location tracking, SOS, or emergency-response support.',
          'Use Sawaari lawfully and treat other users respectfully. If there is an immediate emergency, contact local emergency services.',
        ],
      },
      {
        title: 'Service availability and contact',
        paragraphs: [
          'Maps, address search, ride availability, and other features may be unavailable or inaccurate. Sawaari may update or limit features to maintain or protect the service, subject to applicable law.',
          'For help, email support@sawaari.online or use Help & support in the Sawaari app’s Profile screen. Sawaari Pakistan operates from Lahore, Pakistan. See the Privacy Policy for information about personal data.',
        ],
      },
    ],
  },
};

export default function LegalDocument({ kind }: { kind: LegalDocumentKind }) {
  const document = documents[kind];

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Link href="/profile" style={styles.backLink}>Back to Sawaari</Link>
      <Text style={styles.brand}>SAWAARI PAKISTAN</Text>
      <Text accessibilityRole="header" style={styles.title}>{document.title}</Text>
      <Text style={styles.subtitle}>Lahore, Pakistan</Text>
      {document.sections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{section.title}</Text>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={styles.paragraph}>{paragraph}</Text>
          ))}
          {kind === 'privacy' && section.title === 'Your choices and account deletion' ? (
            <Link href="/delete-account" style={styles.backLink}>Open the account deletion page</Link>
          ) : null}
        </View>
      ))}
      <Link href={kind === 'terms' ? '/privacy' : '/terms'} style={styles.backLink}>
        {kind === 'terms' ? 'Read the Privacy Policy' : 'Read the Terms & Conditions'}
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#F6FAF8' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 22, paddingBottom: 48, gap: 16 },
  backLink: { color: '#0B786F', fontSize: 14, fontWeight: '700' },
  brand: { color: '#0B786F', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  title: { color: '#12273A', fontSize: 28, fontWeight: '800' },
  subtitle: { color: '#63798A', fontSize: 14 },
  section: { gap: 8 },
  sectionTitle: { color: '#12273A', fontSize: 17, fontWeight: '800' },
  paragraph: { color: '#435A6B', fontSize: 14, lineHeight: 22 },
});
