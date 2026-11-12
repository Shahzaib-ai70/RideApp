import {
  Pressable as NativePressable,
  Text as NativeText,
  TextInput as NativeTextInput,
  Platform,
  StyleSheet,
} from 'react-native';
import type {
  PressableProps,
  PressableStateCallbackType,
  StyleProp,
  TextInputProps,
  TextProps,
  TextStyle,
  ViewStyle,
} from 'react-native';

export const APP_FONT_FAMILY = Platform.select({ default: 'Manrope' }) ?? 'Manrope';

function typographyStyle(style: StyleProp<TextStyle>) {
  const flattened = StyleSheet.flatten(style);
  const weight = Number(flattened?.fontWeight ?? 400);
  return {
    fontFamily: flattened?.fontFamily ?? (weight >= 600 ? 'Manrope_700Bold' : weight >= 500 ? 'Manrope_500Medium' : APP_FONT_FAMILY),
  };
}

function pressableStyle(style: PressableProps['style'], state: PressableStateCallbackType): StyleProp<ViewStyle> {
  const customStyle = typeof style === 'function' ? style(state) : style;
  return [
    styles.raised,
    state.pressed && styles.pressed,
    customStyle,
  ];
}

export function Pressable({ style, ...props }: PressableProps) {
  return <NativePressable {...props} style={(state) => pressableStyle(style, state)} />;
}

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[style, typographyStyle(style)]} />;
}

export function TextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={[style, typographyStyle(style)]} />;
}

const styles = StyleSheet.create({
  raised: {
    shadowColor: '#153947',
    shadowOpacity: 0.18,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  pressed: {
    transform: [{ translateY: 2 }, { scale: 0.99 }],
    shadowOpacity: 0.06,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
