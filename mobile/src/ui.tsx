import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

export const colors = { bg: '#F7F5EE', paper: '#FFFFFF', ink: '#26392D', muted: '#647067', green: '#3D6244', pale: '#E9EEDD', line: '#E1E3D8', accent: '#A04C2E', red: '#A9342D' };
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.bg }, content: { padding: 22, paddingBottom: 40, gap: 18 },
  title: { color: colors.ink, fontSize: 29, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 23 },
  section: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  body: { color: colors.ink, fontSize: 16, lineHeight: 25 },
  caption: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  card: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, borderRadius: 20, padding: 18, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 50, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#C9D1C3', backgroundColor: colors.paper, color: colors.ink, fontSize: 16 },
  label: { color: colors.ink, fontSize: 14, fontWeight: '600', marginBottom: 8 },
});

export function Page({ title, subtitle, children, scroll = true, belowHeader = false }: React.PropsWithChildren<{ title: string; subtitle?: string; scroll?: boolean; belowHeader?: boolean }>) {
  const body = <><View style={{ gap: 8 }}><Text style={s.title}>{title}</Text>{subtitle && <Text style={s.subtitle}>{subtitle}</Text>}</View>{children}</>;
  // Stack navigation already accounts for the status bar and top safe area.
  const contentStyle = [s.content, belowHeader && { paddingTop: 10, gap: 14 }];
  return <SafeAreaView style={s.page} edges={belowHeader ? ['left', 'right'] : ['top', 'left', 'right']}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>{scroll ? <ScrollView contentContainerStyle={contentStyle} keyboardShouldPersistTaps="handled">{body}</ScrollView> : <View style={[contentStyle, { flex: 1, paddingBottom: 0 }]}>{body}</View>}</KeyboardAvoidingView></SafeAreaView>;
}

export function Button({ label, onPress, secondary = false, busy = false, disabled = false, danger = false }: { label: string; onPress: () => void; secondary?: boolean; busy?: boolean; disabled?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => ({ minHeight: 50, paddingVertical: 13, paddingHorizontal: 18, borderRadius: 14, justifyContent: 'center', alignItems: 'center', backgroundColor: secondary ? colors.pale : danger ? colors.red : colors.green, opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1 })}>{busy ? <ActivityIndicator color={secondary ? colors.green : '#fff'} /> : <Text style={{ color: secondary ? colors.ink : '#fff', fontSize: 15, fontWeight: '700' }}>{label}</Text>}</Pressable>;
}

export function Chip({ label, selected = false, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  const style = { minHeight: onPress ? 48 : 28, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 12, borderWidth: 1, borderColor: selected ? colors.green : colors.line, backgroundColor: selected ? colors.pale : colors.paper, justifyContent: 'center' as const };
  return onPress ? <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={style}><Text style={{ color: selected ? colors.green : colors.muted, fontSize: 13 }}>{label}</Text></Pressable> : <View style={style}><Text style={s.caption}>{label}</Text></View>;
}

export function Field({ label, value, onChange, placeholder, multiline = false, numeric = false, secret = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; numeric?: boolean; secret?: boolean }) {
  return <View><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.muted} multiline={multiline} keyboardType={numeric ? 'number-pad' : 'default'} secureTextEntry={secret} autoCapitalize="none" autoCorrect={false} style={[s.input, multiline && { minHeight: 100, textAlignVertical: 'top' }]} /></View>;
}

export function Notice({ text, error = false, onRetry }: { text: string; error?: boolean; onRetry?: () => void }) {
  return <View accessibilityLiveRegion="polite" style={[s.card, { backgroundColor: error ? '#FBEEE8' : colors.pale, borderColor: error ? '#E5BCA9' : colors.line }]}><View style={[s.row, { alignItems: 'flex-start' }]}><Ionicons name={error ? 'alert-circle-outline' : 'information-circle-outline'} size={20} color={error ? colors.red : colors.green} /><Text style={[s.caption, { flex: 1, color: error ? colors.red : colors.ink }]}>{text}</Text></View>{onRetry && <Button label="重新连接" secondary onPress={onRetry} />}</View>;
}

export function Loading() { return <View style={{ padding: 28 }}><ActivityIndicator size="large" color={colors.green} /></View>; }

export function Stepper({ label, value, onChange, min = 0, max = 20 }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return <View style={s.between}><Text style={s.body}>{label}</Text><View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel={`减少${label}`} accessibilityState={{ disabled: value <= min }} disabled={value <= min} onPress={() => onChange(value - 1)} style={{ padding: 13, opacity: value <= min ? 0.3 : 1 }}><Ionicons name="remove-circle-outline" size={24} color={colors.green} /></Pressable><Text style={[s.section, { minWidth: 24, textAlign: 'center' }]}>{value}</Text><Pressable accessibilityRole="button" accessibilityLabel={`增加${label}`} accessibilityState={{ disabled: value >= max }} disabled={value >= max} onPress={() => onChange(value + 1)} style={{ padding: 13, opacity: value >= max ? 0.3 : 1 }}><Ionicons name="add-circle-outline" size={24} color={colors.green} /></Pressable></View></View>;
}
