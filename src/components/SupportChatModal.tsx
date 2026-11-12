import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { apiRequest } from '../lib/api';
import { Pressable, Text, TextInput } from './AppText';

const COLORS = {
  ink: '#12273A',
  muted: '#63798A',
  green: '#0B786F',
  pale: '#E8F7F1',
  paper: '#F1F6F5',
  line: '#DCE8E5',
  white: '#FFFFFF',
  red: '#C34242',
};

type SupportMessage = {
  id: string;
  sender_role: 'customer' | 'admin';
  body: string;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMessage(value: unknown): value is SupportMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.sender_role === 'customer' || value.sender_role === 'admin')
    && typeof value.body === 'string'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}

function parseMessages(value: unknown): { status: 'open' | 'closed'; messages: SupportMessage[] } {
  if (!isRecord(value) || !Array.isArray(value.messages) || !value.messages.every(isMessage)
    || (value.status !== 'open' && value.status !== 'closed')) {
    throw new Error('The server returned invalid support chat data.');
  }
  return { status: value.status, messages: value.messages };
}

export default function SupportChatModal({
  visible,
  onClose,
  customerEmail,
  whatsappNumber,
  onSignIn,
}: {
  visible: boolean;
  onClose: () => void;
  customerEmail?: string;
  whatsappNumber: string;
  onSignIn: () => void;
}) {
  const [conversationId, setConversationId] = useState('');
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<ScrollViewInstance | null>(null);

  const refreshMessages = useCallback(async (id: string) => {
    const result = parseMessages(await apiRequest<unknown>(
      `/support/conversations/${encodeURIComponent(id)}/messages`,
    ));
    setStatus(result.status);
    setMessages(result.messages);
    setError('');
  }, []);

  useEffect(() => {
    if (!visible || !customerEmail) return undefined;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setConversationId('');
      setMessages([]);
      setLoading(true);
      setError('');
      try {
        const result: unknown = await apiRequest('/support/conversations', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        if (!isRecord(result) || typeof result.conversation_id !== 'string'
          || (result.status !== 'open' && result.status !== 'closed')) {
          throw new Error('The server could not start a support conversation.');
        }
        if (active) {
          setConversationId(result.conversation_id);
          setStatus(result.status);
        }
        await refreshMessages(result.conversation_id);
      } catch (loadError: unknown) {
        if (active) setError(loadError instanceof Error
          ? loadError.message
          : 'Could not load live support chat.');
      } finally {
        if (active) setLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [customerEmail, refreshMessages, visible]);

  useEffect(() => {
    if (!visible || !conversationId || !customerEmail) return undefined;
    const timer = setInterval(() => {
      void refreshMessages(conversationId).catch((loadError: unknown) => {
        setError(loadError instanceof Error
          ? loadError.message
          : 'Could not refresh the support conversation.');
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [conversationId, customerEmail, refreshMessages, visible]);

  useEffect(() => {
    if (messages.length) listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  const send = async () => {
    const body = message.trim();
    if (!conversationId || !body || sending || status !== 'open') return;
    setSending(true);
    setError('');
    try {
      await apiRequest(`/support/conversations/${encodeURIComponent(conversationId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: body }),
      });
      setMessage('');
      await refreshMessages(conversationId);
    } catch (sendError: unknown) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send your message.');
    } finally {
      setSending(false);
    }
  };

  const contactWhatsApp = async () => {
    if (!/^\d{8,15}$/.test(whatsappNumber)) {
      setError('WhatsApp contact is not configured yet. Use live chat to reach the support team.');
      return;
    }
    try {
      await Linking.openURL(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(
        'Hello Sawaari support, I need help with my ride and account.',
      )}`);
    } catch (linkError: unknown) {
      setError(linkError instanceof Error ? linkError.message : 'Could not open WhatsApp.');
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close support chat"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons name="headset" size={20} color={COLORS.green} />
              </View>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>Sawaari support</Text>
                <View style={styles.statusRow}>
                  <View style={[styles.statusDot, status === 'open' && styles.statusDotOnline]} />
                  <Text style={styles.statusText}>
                    {customerEmail ? status === 'open' ? 'Chat with our support team' : 'Conversation closed' : 'Sign in to start live chat'}
                  </Text>
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close support"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={21} color={COLORS.ink} />
              </Pressable>
            </View>
            <View style={styles.contactRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void contactWhatsApp()}
                style={styles.whatsappButton}
              >
                <Ionicons name="logo-whatsapp" size={16} color={COLORS.green} />
                <Text style={styles.whatsappText}>
                  {whatsappNumber ? 'Contact on WhatsApp' : 'WhatsApp not configured'}
                </Text>
              </Pressable>
            </View>
            {!customerEmail ? (
              <View style={styles.signInPanel}>
                <Ionicons name="lock-closed-outline" size={24} color={COLORS.green} />
                <Text style={styles.signInTitle}>Sign in to start a private chat</Text>
                <Text style={styles.signInCopy}>Our team can help with rides, fares, your account, or a report.</Text>
                <Pressable accessibilityRole="button" onPress={onSignIn} style={styles.primaryButton}>
                  <Text style={styles.primaryButtonText}>Go to sign in</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <ScrollView
                  ref={listRef}
                  contentContainerStyle={styles.messages}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                >
                  {loading ? (
                    <ActivityIndicator color={COLORS.green} style={styles.loading} />
                  ) : messages.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="chatbubbles-outline" size={25} color={COLORS.green} />
                      <Text style={styles.emptyTitle}>How can we help?</Text>
                      <Text style={styles.emptyCopy}>Send a message and a Sawaari support agent will reply here.</Text>
                    </View>
                  ) : messages.map((item) => {
                    const fromCustomer = item.sender_role === 'customer';
                    return (
                      <View
                        key={item.id}
                        style={[styles.messageRow, fromCustomer && styles.customerMessageRow]}
                      >
                        <View style={[styles.messageBubble, fromCustomer && styles.customerBubble]}>
                          {!fromCustomer ? <Text style={styles.agentLabel}>SAWAARI SUPPORT</Text> : null}
                          <Text style={[styles.messageBody, fromCustomer && styles.customerMessageBody]}>
                            {item.body}
                          </Text>
                          <Text style={[styles.messageTime, fromCustomer && styles.customerMessageTime]}>
                            {new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                {status === 'open' ? (
                  <View style={styles.composer}>
                    <TextInput
                      accessibilityLabel="Write a message to Sawaari support"
                      editable={!sending}
                      maxLength={2000}
                      multiline
                      onChangeText={setMessage}
                      onSubmitEditing={() => void send()}
                      placeholder="Write your message..."
                      returnKeyType="send"
                      style={styles.input}
                      value={message}
                    />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Send support message"
                      disabled={sending || !message.trim()}
                      onPress={() => void send()}
                      style={[styles.sendButton, (!message.trim() || sending) && styles.disabled]}
                    >
                      {sending
                        ? <ActivityIndicator size="small" color={COLORS.white} />
                        : <Ionicons name="arrow-up" size={19} color={COLORS.white} />}
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.closedNotice}>
                    <Text style={styles.closedText}>This conversation is closed. Contact support if you still need help.</Text>
                  </View>
                )}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0B1E2A88' },
  sheetWrap: { width: '100%', maxWidth: 700, maxHeight: '94%', alignSelf: 'center' },
  sheet: {
    height: '90%',
    minHeight: 470,
    maxHeight: 760,
    overflow: 'hidden',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: COLORS.white,
    paddingHorizontal: 17,
    paddingTop: 10,
    paddingBottom: 14,
    shadowColor: '#07151E',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -5 },
    elevation: 18,
  },
  handle: { width: 42, height: 4, alignSelf: 'center', borderRadius: 3, backgroundColor: '#CCD8D6' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  headerIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A8B5BA' },
  statusDotOnline: { backgroundColor: '#22A67A' },
  statusText: { color: COLORS.muted, fontSize: 10 },
  closeButton: { width: 36, height: 36, borderRadius: 13, backgroundColor: COLORS.paper, alignItems: 'center', justifyContent: 'center' },
  contactRow: { paddingVertical: 10 },
  whatsappButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, borderWidth: 1, borderColor: '#CBE9DC', backgroundColor: '#F3FBF7' },
  whatsappText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  messages: { flexGrow: 1, justifyContent: 'flex-end', paddingVertical: 12, gap: 10 },
  loading: { marginVertical: 35 },
  emptyState: { alignItems: 'center', gap: 8, paddingVertical: 35 },
  emptyTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  emptyCopy: { maxWidth: 260, color: COLORS.muted, textAlign: 'center', fontSize: 11, lineHeight: 17 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  customerMessageRow: { justifyContent: 'flex-end' },
  messageBubble: { maxWidth: '84%', padding: 11, borderRadius: 16, borderBottomLeftRadius: 5, backgroundColor: '#F1F6F5' },
  customerBubble: { borderBottomLeftRadius: 16, borderBottomRightRadius: 5, backgroundColor: COLORS.green },
  agentLabel: { marginBottom: 4, color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  messageBody: { color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  customerMessageBody: { color: COLORS.white },
  messageTime: { marginTop: 5, color: COLORS.muted, textAlign: 'right', fontSize: 8 },
  customerMessageTime: { color: '#D4EEE6' },
  error: { marginBottom: 8, color: COLORS.red, fontSize: 10, lineHeight: 15 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: COLORS.line },
  input: { flex: 1, maxHeight: 105, minHeight: 44, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 12 },
  sendButton: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.green, elevation: 5, shadowColor: COLORS.green, shadowOpacity: 0.28, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
  disabled: { opacity: 0.45 },
  closedNotice: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: COLORS.line },
  closedText: { color: COLORS.muted, textAlign: 'center', fontSize: 10 },
  signInPanel: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 20 },
  signInTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  signInCopy: { maxWidth: 270, color: COLORS.muted, fontSize: 11, lineHeight: 17, textAlign: 'center' },
  primaryButton: { minHeight: 43, marginTop: 6, paddingHorizontal: 24, borderRadius: 13, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: COLORS.green, shadowOpacity: 0.24, shadowRadius: 6, shadowOffset: { width: 0, height: 4 } },
  primaryButtonText: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
});
