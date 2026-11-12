import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewInstance,
} from 'react-native';
import { Pressable, Text, TextInput } from './AppText';
import { adminApi } from '../lib/adminApi';

const COLORS = {
  ink: '#12273A',
  muted: '#63798A',
  green: '#0B786F',
  pale: '#D9F5EA',
  paper: '#F1F6F5',
  line: '#DCE8E5',
  white: '#FFFFFF',
  red: '#C34242',
};

type ConversationStatus = 'open' | 'closed';
type Filter = ConversationStatus | 'all';
type Conversation = {
  conversation_id: string;
  user_id: string;
  customer_name: string;
  customer_email: string;
  status: ConversationStatus;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_sender_role: 'customer' | 'admin' | null;
  last_message_at: string | null;
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

function isConversation(value: unknown): value is Conversation {
  return isRecord(value)
    && typeof value.conversation_id === 'string'
    && typeof value.user_id === 'string'
    && typeof value.customer_name === 'string'
    && typeof value.customer_email === 'string'
    && (value.status === 'open' || value.status === 'closed')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && (typeof value.last_message === 'string' || value.last_message === null)
    && (value.last_sender_role === 'customer' || value.last_sender_role === 'admin'
      || value.last_sender_role === null)
    && (typeof value.last_message_at === 'string' || value.last_message_at === null);
}

function isMessage(value: unknown): value is SupportMessage {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.sender_role === 'customer' || value.sender_role === 'admin')
    && typeof value.body === 'string'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at));
}

function formatTime(value: string) {
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function AdminSupportConsole({ onClose }: { onClose: () => void }) {
  const [filter, setFilter] = useState<Filter>('open');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<ScrollViewInstance | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const params = new URLSearchParams({ status: filter, limit: '100', offset: '0' });
      const result: unknown = await adminApi(`/api/admin/support/conversations?${params}`);
      if (!isRecord(result) || !Array.isArray(result.conversations)
        || !result.conversations.every(isConversation)) {
        throw new Error('The server returned invalid support inbox data.');
      }
      setConversations(result.conversations);
      setError('');
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load support conversations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
    const timer = setInterval(() => void refresh(), 10000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      return undefined;
    }
    let active = true;
    const poll = async () => {
      try {
        const result: unknown = await adminApi(
          `/api/admin/support/conversations/${encodeURIComponent(selected.conversation_id)}/messages`,
        );
        if (!isRecord(result) || !Array.isArray(result.messages) || !result.messages.every(isMessage)) {
          throw new Error('The server returned invalid support messages.');
        }
        if (active) setMessages(result.messages);
      } catch (pollError: unknown) {
        if (active) setError(pollError instanceof Error
          ? pollError.message
          : 'Could not refresh this conversation.');
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [selected]);

  useEffect(() => {
    if (selected) listRef.current?.scrollToEnd({ animated: true });
  }, [messages, selected]);

  const sendReply = async () => {
    if (!selected || !reply.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await adminApi(`/api/admin/support/conversations/${encodeURIComponent(selected.conversation_id)}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message: reply.trim() }),
      });
      setReply('');
      await refresh();
    } catch (sendError: unknown) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send this reply.');
    } finally {
      setSending(false);
    }
  };

  const toggleStatus = async (conversation: Conversation) => {
    setError('');
    try {
      const nextStatus: ConversationStatus = conversation.status === 'open' ? 'closed' : 'open';
      await adminApi(`/api/admin/support/conversations/${encodeURIComponent(conversation.conversation_id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      if (selected?.conversation_id === conversation.conversation_id) {
        setSelected({ ...conversation, status: nextStatus });
      }
      await refresh();
    } catch (statusError: unknown) {
      setError(statusError instanceof Error ? statusError.message : 'Could not update conversation status.');
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <View style={styles.brandIcon}>
          <Ionicons name="chatbubbles" size={19} color={COLORS.pale} />
        </View>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>SAWAARI OPERATIONS</Text>
          <Text style={styles.title}>Live support inbox</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.backButton}>
          <Ionicons name="arrow-back-outline" size={16} color={COLORS.green} />
          <Text style={styles.backText}>Dashboard</Text>
        </Pressable>
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {selected ? (
        <View style={styles.conversationPanel}>
          <View style={styles.conversationHeader}>
            <Pressable accessibilityRole="button" onPress={() => setSelected(null)} style={styles.iconButton}>
              <Ionicons name="arrow-back" size={18} color={COLORS.green} />
            </Pressable>
            <View style={styles.customerDetails}>
              <Text style={styles.customerName}>{selected.customer_name || 'Sawaari customer'}</Text>
              <Text style={styles.customerEmail}>{selected.customer_email}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void toggleStatus(selected)}
              style={[styles.statusButton, selected.status === 'open' && styles.closeChatButton]}
            >
              <Text style={[styles.statusButtonText, selected.status === 'open' && styles.closeChatText]}>
                {selected.status === 'open' ? 'Close chat' : 'Reopen chat'}
              </Text>
            </Pressable>
          </View>
          <ScrollView
            ref={listRef}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <Text style={styles.emptyMessages}>No messages yet.</Text>
            ) : messages.map((message) => (
              <View
                key={message.id}
                style={[styles.messageRow, message.sender_role === 'admin' && styles.adminMessageRow]}
              >
                <View style={[styles.messageBubble, message.sender_role === 'admin' && styles.adminBubble]}>
                  <Text style={[styles.messageRole, message.sender_role === 'admin' && styles.adminRole]}>
                    {message.sender_role === 'admin' ? 'SUPPORT AGENT' : 'CUSTOMER'}
                  </Text>
                  <Text style={[styles.messageBody, message.sender_role === 'admin' && styles.adminMessageBody]}>
                    {message.body}
                  </Text>
                  <Text style={[styles.messageTime, message.sender_role === 'admin' && styles.adminMessageTime]}>
                    {formatTime(message.created_at)}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
          {selected.status === 'open' ? (
            <View style={styles.composer}>
              <TextInput
                accessibilityLabel="Write a support reply"
                maxLength={2000}
                multiline
                onChangeText={setReply}
                placeholder="Reply to customer..."
                style={styles.replyInput}
                value={reply}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!reply.trim() || sending}
                onPress={() => void sendReply()}
                style={[styles.sendButton, (!reply.trim() || sending) && styles.disabled]}
              >
                {sending ? <ActivityIndicator color={COLORS.white} /> : <Ionicons name="send" size={16} color={COLORS.white} />}
              </Pressable>
            </View>
          ) : <Text style={styles.closedCopy}>This chat is closed. Reopen it to reply.</Text>}
        </View>
      ) : (
        <>
          <View style={styles.filters}>
            {(['open', 'closed', 'all'] as const).map((status) => (
              <Pressable
                key={status}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === status }}
                onPress={() => setFilter(status)}
                style={[styles.filterButton, filter === status && styles.filterButtonSelected]}
              >
                <Text style={[styles.filterText, filter === status && styles.filterTextSelected]}>
                  {status === 'all' ? 'All chats' : status === 'open' ? 'Open chats' : 'Closed'}
                </Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.refreshButton}>
              {refreshing ? <ActivityIndicator size="small" color={COLORS.green} /> : <Ionicons name="refresh" size={16} color={COLORS.green} />}
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.conversationList}>
            {loading ? <ActivityIndicator color={COLORS.green} style={styles.loading} /> : conversations.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="chatbubble-ellipses-outline" size={30} color={COLORS.green} />
                <Text style={styles.emptyTitle}>No {filter === 'all' ? '' : `${filter} `}support chats</Text>
                <Text style={styles.emptyCopy}>New customer messages will appear here.</Text>
              </View>
            ) : conversations.map((conversation) => (
              <Pressable
                accessibilityRole="button"
                key={conversation.conversation_id}
                onPress={() => {
                  setSelected(conversation);
                }}
                style={styles.conversationCard}
              >
                <View style={styles.avatar}>
                  <Ionicons name="person" size={17} color={COLORS.green} />
                </View>
                <View style={styles.conversationCopy}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={styles.customerName}>{conversation.customer_name || 'Customer'}</Text>
                    <Text style={styles.timestamp}>
                      {conversation.last_message_at ? formatTime(conversation.last_message_at) : formatTime(conversation.created_at)}
                    </Text>
                  </View>
                  <Text numberOfLines={1} style={styles.customerEmail}>{conversation.customer_email}</Text>
                  <Text numberOfLines={2} style={styles.lastMessage}>
                    {conversation.last_sender_role === 'admin' ? 'You: ' : ''}
                    {conversation.last_message ?? 'Chat started'}
                  </Text>
                </View>
                <View style={[styles.openDot, conversation.status === 'closed' && styles.closedDot]} />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, minHeight: 0, padding: 18, backgroundColor: COLORS.paper },
  topBar: { width: '100%', maxWidth: 1050, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 16 },
  brandIcon: { width: 43, height: 43, borderRadius: 15, backgroundColor: COLORS.green, alignItems: 'center', justifyContent: 'center', elevation: 5, shadowColor: COLORS.green, shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  heading: { flex: 1 },
  eyebrow: { color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  title: { marginTop: 3, color: COLORS.ink, fontSize: 19, fontWeight: '900' },
  backButton: { minHeight: 39, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, borderRadius: 12, backgroundColor: COLORS.white, elevation: 3, shadowColor: COLORS.ink, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 3 } },
  backText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  error: { width: '100%', maxWidth: 1050, alignSelf: 'center', marginBottom: 10, padding: 10, borderRadius: 10, backgroundColor: '#FCE9E8', color: COLORS.red, fontSize: 11 },
  filters: { width: '100%', maxWidth: 1050, alignSelf: 'center', flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterButton: { minHeight: 37, justifyContent: 'center', paddingHorizontal: 13, borderRadius: 12, backgroundColor: COLORS.white, elevation: 2, shadowColor: COLORS.ink, shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 2 } },
  filterButtonSelected: { backgroundColor: COLORS.green, elevation: 4, shadowColor: COLORS.green, shadowOpacity: 0.22 },
  filterText: { color: COLORS.muted, fontSize: 10, fontWeight: '800' },
  filterTextSelected: { color: COLORS.white },
  refreshButton: { width: 38, height: 37, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: COLORS.white, marginLeft: 'auto', elevation: 2 },
  conversationList: { width: '100%', maxWidth: 1050, alignSelf: 'center', gap: 9, paddingBottom: 20 },
  loading: { marginVertical: 36 },
  emptyState: { alignItems: 'center', gap: 8, padding: 35, borderRadius: 18, backgroundColor: COLORS.white, elevation: 2 },
  emptyTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  emptyCopy: { color: COLORS.muted, fontSize: 11 },
  conversationCard: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 17, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, elevation: 3, shadowColor: COLORS.ink, shadowOpacity: 0.07, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
  avatar: { width: 39, height: 39, borderRadius: 14, backgroundColor: COLORS.pale, alignItems: 'center', justifyContent: 'center' },
  conversationCopy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  customerName: { flexShrink: 1, color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  timestamp: { marginLeft: 'auto', color: COLORS.muted, fontSize: 8 },
  customerEmail: { marginTop: 2, color: COLORS.muted, fontSize: 9 },
  lastMessage: { marginTop: 5, color: COLORS.ink, fontSize: 10, lineHeight: 15 },
  openDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#20A678' },
  closedDot: { backgroundColor: '#A8B5BA' },
  conversationPanel: { flex: 1, width: '100%', maxWidth: 1050, alignSelf: 'center', overflow: 'hidden', borderRadius: 19, backgroundColor: COLORS.white, borderWidth: 1, borderColor: COLORS.line, elevation: 4 },
  conversationHeader: { minHeight: 69, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  iconButton: { width: 37, height: 37, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.paper },
  customerDetails: { flex: 1 },
  statusButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 11, backgroundColor: COLORS.pale },
  closeChatButton: { backgroundColor: '#FCE9E8' },
  statusButtonText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  closeChatText: { color: COLORS.red },
  messageList: { flexGrow: 1, justifyContent: 'flex-end', gap: 11, padding: 14 },
  emptyMessages: { alignSelf: 'center', color: COLORS.muted, fontSize: 11, marginVertical: 30 },
  messageRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  adminMessageRow: { justifyContent: 'flex-end' },
  messageBubble: { maxWidth: '84%', padding: 11, borderRadius: 15, borderBottomLeftRadius: 5, backgroundColor: COLORS.paper },
  adminBubble: { borderBottomLeftRadius: 15, borderBottomRightRadius: 5, backgroundColor: COLORS.green },
  messageRole: { marginBottom: 4, color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.7 },
  adminRole: { color: COLORS.pale },
  messageBody: { color: COLORS.ink, fontSize: 11, lineHeight: 17 },
  adminMessageBody: { color: COLORS.white },
  messageTime: { marginTop: 4, color: COLORS.muted, textAlign: 'right', fontSize: 8 },
  adminMessageTime: { color: '#D4EEE6' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: COLORS.line },
  replyInput: { flex: 1, maxHeight: 110, minHeight: 43, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.paper, color: COLORS.ink, fontSize: 11 },
  sendButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.green, elevation: 5, shadowColor: COLORS.green, shadowOpacity: 0.26, shadowRadius: 5, shadowOffset: { width: 0, height: 3 } },
  disabled: { opacity: 0.45 },
  closedCopy: { padding: 14, textAlign: 'center', color: COLORS.muted, fontSize: 10 },
});
