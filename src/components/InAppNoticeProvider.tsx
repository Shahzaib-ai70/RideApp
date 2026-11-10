import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './AppText';

type NoticeOptions = {
  title: string;
  message: string;
};

type ConfirmationOptions = NoticeOptions & {
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Notice = NoticeOptions & {
  kind: 'notice' | 'confirmation';
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type NoticeContextValue = {
  notify: (options: NoticeOptions) => void;
  confirm: (options: ConfirmationOptions) => Promise<boolean>;
};

const NoticeContext = createContext<NoticeContextValue | null>(null);

export function InAppNoticeProvider({ children }: PropsWithChildren) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const confirmationResolver = useRef<((confirmed: boolean) => void) | null>(null);

  const resolveConfirmation = useCallback((confirmed: boolean) => {
    confirmationResolver.current?.(confirmed);
    confirmationResolver.current = null;
    setNotice(null);
  }, []);

  const notify = useCallback((options: NoticeOptions) => {
    confirmationResolver.current?.(false);
    confirmationResolver.current = null;
    setNotice({ ...options, kind: 'notice' });
  }, []);

  const confirm = useCallback((options: ConfirmationOptions) => {
    confirmationResolver.current?.(false);
    setNotice({
      ...options,
      kind: 'confirmation',
      cancelLabel: options.cancelLabel ?? 'Cancel',
    });
    return new Promise<boolean>((resolve) => {
      confirmationResolver.current = resolve;
    });
  }, []);

  useEffect(() => () => {
    confirmationResolver.current?.(false);
    confirmationResolver.current = null;
  }, []);

  return (
    <NoticeContext.Provider value={{ notify, confirm }}>
      <View style={styles.root}>
        {children}
        {notice ? (
          <View style={styles.overlay} accessibilityViewIsModal>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close message"
              onPress={() => resolveConfirmation(false)}
              style={StyleSheet.absoluteFill}
            />
            <View
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              style={styles.dialog}
            >
              <Text style={styles.title}>{notice.title}</Text>
              <Text style={styles.message}>{notice.message}</Text>
              <View style={styles.actions}>
                {notice.kind === 'confirmation' ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => resolveConfirmation(false)}
                    style={styles.cancelButton}
                  >
                    <Text style={styles.cancelText}>{notice.cancelLabel}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() => resolveConfirmation(notice.kind === 'confirmation')}
                  style={[
                    styles.confirmButton,
                    notice.destructive && styles.destructiveButton,
                  ]}
                >
                  <Text style={styles.confirmText}>
                    {notice.kind === 'confirmation' ? notice.confirmLabel : 'Okay'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </NoticeContext.Provider>
  );
}

export function useInAppNotice() {
  const context = useContext(NoticeContext);
  if (!context) throw new Error('useInAppNotice must be used inside InAppNoticeProvider.');
  return context;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10000,
    elevation: 10000,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(13, 27, 21, 0.48)',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    shadowColor: '#10293A',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  title: { color: '#12273A', fontSize: 19, fontWeight: '800' },
  message: { marginTop: 10, color: '#566E79', fontSize: 14, lineHeight: 21 },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
    marginTop: 22,
  },
  cancelButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 13,
  },
  cancelText: { color: '#596F79', fontSize: 13, fontWeight: '700' },
  confirmButton: {
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 17,
    borderRadius: 13,
    backgroundColor: '#0B786F',
  },
  destructiveButton: { backgroundColor: '#B93838' },
  confirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
