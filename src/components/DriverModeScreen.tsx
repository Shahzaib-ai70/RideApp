import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

const COLORS = {
  ink: '#F7FAFC',
  muted: '#AAB8C4',
  green: '#245B8F',
  lime: '#DCEAF5',
  dark: '#162331',
  card: '#213244',
  line: '#34495C',
  white: '#FFFFFF',
};

export default function DriverModeScreen() {
  const router = useRouter();

  const openDriverProcess = () => router.push('/driver');

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.screen}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to passenger mode"
            onPress={() => router.replace('/(tabs)')}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color={COLORS.ink} />
          </Pressable>
          <Text style={styles.modeLabel}>DRIVER MODE</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="car-sport" size={25} color={COLORS.green} />
          </View>
          <Text style={styles.heroTitle}>Earn with Sawaari</Text>
          <Text style={styles.heroSubtitle}>
            Choose when to drive, see ride requests nearby, and keep track of your cash fares.
          </Text>
          <View style={styles.benefit}>
            <Ionicons name="time-outline" size={19} color={COLORS.white} />
            <Text style={styles.benefitText}>Flexible driving hours</Text>
          </View>
          <View style={styles.benefit}>
            <Ionicons name="cash-outline" size={19} color={COLORS.white} />
            <Text style={styles.benefitText}>Agree the fare and collect cash directly</Text>
          </View>
          <View style={styles.benefit}>
            <Ionicons name="shield-checkmark-outline" size={19} color={COLORS.white} />
            <Text style={styles.benefitText}>Driver documents reviewed before going online</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Choose how you want to work</Text>

        <Pressable
          accessibilityRole="button"
          onPress={openDriverProcess}
          style={({ pressed }) => [styles.choiceCard, pressed && styles.pressed]}
        >
          <View style={styles.choiceIcon}>
            <Ionicons name="car-sport" size={30} color={COLORS.lime} />
          </View>
          <View style={styles.choiceCopy}>
            <Text style={styles.choiceTitle}>Driver</Text>
            <Text style={styles.choiceDetail}>Apply, verify your vehicle, and find rides</Text>
          </View>
          <Ionicons name="chevron-forward" size={21} color={COLORS.muted} />
        </Pressable>

        <View style={[styles.choiceCard, styles.disabledCard]}>
          <View style={[styles.choiceIcon, styles.disabledChoiceIcon]}>
            <Ionicons name="cube-outline" size={29} color={COLORS.muted} />
          </View>
          <View style={styles.choiceCopy}>
            <Text style={[styles.choiceTitle, styles.disabledText]}>Courier</Text>
            <Text style={styles.choiceDetail}>Courier deliveries are not available yet</Text>
          </View>
          <Text style={styles.comingSoon}>SOON</Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.accountHint}>
            Already use Sawaari? Continue with your existing email and password.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={openDriverProcess}
            style={({ pressed }) => [styles.accountButton, pressed && styles.accountPressed]}
          >
            <Text style={styles.accountButtonText}>I already have an account</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/(tabs)')}
            style={styles.passengerButton}
          >
            <Ionicons name="navigate-outline" size={17} color={COLORS.muted} />
            <Text style={styles.passengerButtonText}>Go to passenger mode</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.dark },
  screen: {
    flexGrow: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 22,
    backgroundColor: COLORS.dark,
  },
  topBar: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  modeLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  topBarSpacer: { width: 40 },
  hero: {
    marginTop: 18,
    padding: 21,
    borderRadius: 24,
    backgroundColor: COLORS.green,
  },
  heroIcon: {
    width: 46,
    height: 46,
    marginBottom: 18,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.lime,
  },
  heroTitle: { color: COLORS.white, fontSize: 27, fontWeight: '900', letterSpacing: -0.5 },
  heroSubtitle: { marginTop: 8, marginBottom: 18, color: '#D8E5EF', fontSize: 13, lineHeight: 19 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 11 },
  benefitText: { flex: 1, color: COLORS.white, fontSize: 13, fontWeight: '600' },
  sectionTitle: {
    marginTop: 27,
    marginBottom: 12,
    color: COLORS.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  choiceCard: {
    minHeight: 87,
    marginBottom: 10,
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: COLORS.card,
  },
  pressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  choiceIcon: {
    width: 51,
    height: 51,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#304A62',
  },
  choiceCopy: { flex: 1 },
  choiceTitle: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  choiceDetail: { marginTop: 4, color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  disabledCard: { opacity: 0.65 },
  disabledChoiceIcon: { backgroundColor: '#2B3D4D' },
  disabledText: { color: '#C0C4C1' },
  comingSoon: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
    color: COLORS.muted,
    backgroundColor: '#344656',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  footer: { marginTop: 'auto', paddingTop: 25 },
  accountHint: {
    marginBottom: 10,
    color: COLORS.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  accountButton: {
    minHeight: 54,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.white,
  },
  accountPressed: { opacity: 0.85 },
  accountButtonText: { color: COLORS.dark, fontSize: 14, fontWeight: '800' },
  passengerButton: {
    minHeight: 52,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  passengerButtonText: { color: COLORS.muted, fontSize: 13, fontWeight: '700' },
});
