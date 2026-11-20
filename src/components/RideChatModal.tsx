import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

type RideMessage = {
  id: string;
  is_mine: boolean;
  body: string;
  created_at: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRideMessage(value: unknown): value is RideMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.is_mine === 'boolean'
    && typeof value.body === 'string'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}

function parseMessages(value: unknown): RideMessage[] {
  if (!isRecord(value) || !Array.isArray(value.messages) || !value.messages.every(isRideMessage)) {
    throw new Error('The server returned invalid ride chat data.');
  }
  return value.messages;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function RideChatModal({
  visible,
  onClose,
  requestId,
  participantName,
}: {
  visible: boolean;
  onClose: () => void;
  requestId: string | null;
  participantName: string;
}) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [conversation, setConversation] = useState<{
    requestId: string;
    messages: RideMessage[];
  } | null>(null);
  const [requestError, setRequestError] = useState<{
    requestId: string;
    message: string;
  } | null>(null);
  const listRef = useRef<ScrollViewInstance | null>(null);

  const refreshMessages = useCallback(async (id: string) => {
    return parseMessages(await apiRequest<unknown>(
      `/rides/${encodeURIComponent(id)}/messages`,
    ));
  }, []);

  useEffect(() => {
    if (!visible || !requestId) return undefined;
    let active = true;
    const refresh = () => {
      void refreshMessages(requestId)
        .then((nextMessages) => {
          if (active) {
            setConversation({ requestId, messages: nextMessages });
            setRequestError(null);
          }
        })
        .catch((loadError: unknown) => {
          if (active) {
            setRequestError({
              requestId,
              message: loadError instanceof Error
                ? loadError.message
                : 'Could not load ride chat.',
            });
          }
        });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshMessages, requestId, visible]);

  const activeMessages = requestId && conversation?.requestId === requestId
    ? conversation.messages
    : [];
  const loading = Boolean(visible && requestId
    && conversation?.requestId !== requestId
    && requestError?.requestId !== requestId);
  const error = requestId && requestError?.requestId === requestId
    ? requestError.message
    : '';

  useEffect(() => {
    if (requestId && conversation?.requestId === requestId && conversation.messages.length) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [conversation, requestId]);

  const send = async () => {
    const body = message.trim();
    if (!requestId || !body || sending) return;
    setSending(true);
    setRequestError(null);
    try {
      await apiRequest(`/rides/${encodeURIComponent(requestId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: body }),
      });
      setMessage('');
      setConversation({ requestId, messages: await refreshMessages(requestId) });
    } catch (sendError: unknown) {
      setRequestError({
        requestId,
        message: sendError instanceof Error ? sendError.message : 'Could not send your message.',
      });
    } finally {
      setSending(false);
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
          accessibilityLabel="Close ride chat"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerIcon}>
                <Ionicons name="chatbubbles" size={20} color={COLORS.green} />
              </View>
              <View style={styles.headerCopy}>
                <Text numberOfLines={1} style={styles.title}>
                  Chat with {participantName}
                </Text>
                <Text style={styles.subtitle}>Private chat for this ride</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close ride chat"
                onPress={onClose}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={21} color={COLORS.ink} />
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={COLORS.green} />
                <Text style={styles.loadingText}>Loading ride chat…</Text>
              </View>
            ) : (
              <ScrollView
                ref={listRef}
                contentContainerStyle={styles.messages}
                keyboardShouldPersistTaps="handled"
              >
                {activeMessages.length ? activeMessages.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.messageBubble,
                      item.is_mine ? styles.ownMessage : styles.otherMessage,
                    ]}
                  >
                    <Text style={[
                      styles.messageText,
                      item.is_mine && styles.ownMessageText,
                    ]}>
                      {item.body}
                    </Text>
                    <Text style={[
                      styles.messageTime,
                      item.is_mine && styles.ownMessageTime,
                    ]}>
                      {formatTime(item.created_at)}
                    </Text>
                  </View>
                )) : (
                  <View style={styles.empty}>
                    <Ionicons name="chatbubble-ellipses-outline" size={27} color={COLORS.green} />
                    <Text style={styles.emptyTitle}>Start the conversation</Text>
                    <Text style={styles.emptyCopy}>
                      Send a message to coordinate your pickup.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}

            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Write a ride chat message"
                editable={!sending}
                maxLength={2000}
                multiline
                onChangeText={setMessage}
                onSubmitEditing={() => void send()}
                placeholder="Write a message…"
                placeholderTextColor="#95A2AD"
                returnKeyType="send"
                style={styles.input}
                value={message}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send ride chat message"
                disabled={!message.trim() || sending || !requestId}
                onPress={() => void send()}
                style={[
                  styles.sendButton,
                  (!message.trim() || sending || !requestId) && styles.sendDisabled,
                ]}
              >
                {sending
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : <Ionicons name="send" size={17} color={COLORS.white} />}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(9, 28, 40, 0.48)' },
  sheetWrap: { width: '100%', maxWidth: 620, maxHeight: '94%', alignSelf: 'center' },
  sheet: {
    height: '90%',
    minHeight: 470,
    maxHeight: 760,
    overflow: 'hidden',
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    backgroundColor: COLORS.white,
  },
  handle: { width: 42, height: 4, marginBottom: 5, borderRadius: 2, alignSelf: 'center', backgroundColor: '#CEDBD8' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  headerIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.pale },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  subtitle: { marginTop: 3, color: COLORS.muted, fontSize: 10 },
  closeButton: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.paper },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { color: COLORS.muted, fontSize: 11 },
  messages: { flexGrow: 1, justifyContent: 'flex-end', paddingVertical: 14, gap: 9 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 35 },
  emptyTitle: { marginTop: 10, color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  emptyCopy: { marginTop: 4, color: COLORS.muted, fontSize: 10, textAlign: 'center' },
  messageBubble: { maxWidth: '84%', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 15 },
  ownMessage: { alignSelf: 'flex-end', borderBottomRightRadius: 5, backgroundColor: COLORS.green },
  otherMessage: { alignSelf: 'flex-start', borderBottomLeftRadius: 5, backgroundColor: COLORS.paper },
  messageText: { color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  ownMessageText: { color: COLORS.white },
  messageTime: { marginTop: 4, color: COLORS.muted, fontSize: 8, textAlign: 'right' },
  ownMessageTime: { color: '#D0E8E1' },
  error: { marginBottom: 8, color: COLORS.red, fontSize: 10, lineHeight: 15 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.line },
  input: {
    flex: 1,
    maxHeight: 100,
    minHeight: 42,
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 9,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.ink,
    backgroundColor: COLORS.paper,
    fontSize: 12,
  },
  sendButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.green },
  sendDisabled: { opacity: 0.45 },
});
