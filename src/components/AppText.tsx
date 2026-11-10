import {
  Text as NativeText,
  TextInput as NativeTextInput,
  Platform,
  StyleSheet,
} from 'react-native';
import type { StyleProp, TextInputProps, TextProps, TextStyle } from 'react-native';

export const APP_FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'system-ui',
}) ?? 'sans-serif';

function typographyStyle(style: StyleProp<TextStyle>) {
  const flattened = StyleSheet.flatten(style);
  return {
    fontFamily: flattened?.fontFamily ?? APP_FONT_FAMILY,
  };
}

export function Text({ style, ...props }: TextProps) {
  return <NativeText {...props} style={[style, typographyStyle(style)]} />;
}

export function TextInput({ style, ...props }: TextInputProps) {
  return <NativeTextInput {...props} style={[style, typographyStyle(style)]} />;
}
