import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, s } from './ui';
import type { Category } from './types';
import { RecipeTags } from './tags';

export function RecipeBadges({ recipe, categories }: { recipe: { category_id: string; is_hearty?: boolean }; categories: Category[] }) {
  return <RecipeTags recipe={recipe} categories={categories} />;
}

export function LibraryPage({ title, context, action, actionIcon = 'add', onAdd, children }: React.PropsWithChildren<{ title: string; context?: string; action?: string; actionIcon?: React.ComponentProps<typeof Ionicons>['name']; onAdd?: () => void }>) {
  return <SafeAreaView style={s.page} edges={['top', 'left', 'right']}><KeyboardAvoidingView style={l.page} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={l.heading}><View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Text style={l.title}>{title}</Text>{context && <Text numberOfLines={1} style={[l.context, { flexShrink: 1 }]}>{context}</Text>}</View>{action && onAdd && <Pressable accessibilityRole="button" onPress={onAdd} style={({ pressed }) => [l.add, { opacity: pressed ? 0.7 : 1 }]}><Ionicons name={actionIcon} size={20} color="#fff" /><Text style={l.addText}>{action}</Text></Pressable>}</View>{children}</KeyboardAvoidingView></SafeAreaView>;
}
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <View style={l.search}><Ionicons name="search-outline" size={21} color={colors.muted} /><TextInput style={l.searchInput} accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={colors.muted} value={value} onChangeText={onChange} autoCorrect={false} autoCapitalize="none" returnKeyType="search" />{!!value && <Pressable accessibilityRole="button" accessibilityLabel="清空搜索" onPress={() => onChange('')} style={l.iconButton}><Ionicons name="close-circle" size={19} color={colors.muted} /></Pressable>}</View>;
}
export function CategoryTabs({ options, selected, onSelect }: { options: { value: string; label: string }[]; selected: string; onSelect: (v: string) => void }) {
  return <View style={l.tabs}><ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>{options.map(o => <Pressable key={o.value} accessibilityRole="button" accessibilityState={{ selected: selected === o.value }} onPress={() => onSelect(o.value)} style={[l.tab, selected === o.value && { backgroundColor: colors.green }]}><Text style={[l.tabText, selected === o.value && { color: '#fff' }]}>{o.label}</Text></Pressable>)}</ScrollView></View>;
}
export function FilterButton({ label = '筛选', active = false, onPress }: { label?: string; active?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={l.filterButton}><Ionicons name="options-outline" size={20} color={colors.green} /><Text style={[l.filterText, active && { color: colors.green, fontWeight: '700' }]} numberOfLines={1}>{label}</Text>{active && <View style={l.dot} />}</Pressable>;
}
export function FilterSheet({ visible, title, onClose, onApply, applyDisabled = false, resetLabel = '重置筛选', onReset, children }: React.PropsWithChildren<{ visible: boolean; title: string; onClose: () => void; onApply?: () => void; applyDisabled?: boolean; resetLabel?: string; onReset: () => void }>) {
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView style={l.overlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="关闭筛选" onPress={onClose} /><SafeAreaView edges={['bottom', 'left', 'right']} style={l.sheet}><View style={s.between}><Text style={s.section}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="关闭筛选" onPress={onClose} style={l.iconButton}><Ionicons name="close" size={24} color={colors.ink} /></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 18, paddingVertical: 12 }}>{children}</ScrollView><View style={s.row}><Pressable accessibilityRole="button" onPress={onReset} style={[l.sheetAction, { backgroundColor: colors.pale }]}><Text style={l.filterText}>{resetLabel}</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: applyDisabled }} disabled={applyDisabled} onPress={onApply || onClose} style={[l.sheetAction, { flex: 1, backgroundColor: colors.green, opacity: applyDisabled ? 0.4 : 1 }]}><Text style={l.addText}>完成</Text></Pressable></View></SafeAreaView></KeyboardAvoidingView></Modal>;
}
export const l = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 18 },
  heading: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 6, paddingBottom: 10 },
  title: { color: colors.ink, fontSize: 24, fontWeight: '800', includeFontPadding: false }, context: { color: '#88602E', fontSize: 11, lineHeight: 16, includeFontPadding: false },
  add: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.green, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' }, addText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  search: { minHeight: 46, borderWidth: 1, borderColor: '#C9CEC5', borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFFFF80' }, searchInput: { flex: 1, fontSize: 16, color: colors.ink, includeFontPadding: false, paddingVertical: 8, minHeight: 44 },
  iconButton: { minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }, tabs: { borderBottomWidth: 1, borderColor: colors.line, marginTop: 2 },
  tab: { minHeight: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderRadius: 11 }, tabText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  controls: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.line, gap: 8 }, filterButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, paddingHorizontal: 4, flexShrink: 1 }, filterText: { color: colors.ink, fontSize: 14 }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.green },
  count: { color: colors.muted, fontSize: 12, paddingVertical: 6, includeFontPadding: false }, list: { gap: 7, paddingBottom: 20 },
  card: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, flexDirection: 'row', alignItems: 'center', gap: 12 }, name: { fontSize: 18, fontWeight: '700', color: colors.ink, flexShrink: 1, lineHeight: 25, includeFontPadding: false }, detail: { fontSize: 13, lineHeight: 20, color: colors.muted, includeFontPadding: false }, badge: { fontSize: 11, lineHeight: 16, color: colors.muted, backgroundColor: '#F1F0E9', borderRadius: 5, paddingHorizontal: 5, overflow: 'hidden' }, status: { fontSize: 12, lineHeight: 18, color: colors.green, backgroundColor: colors.pale, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 9, overflow: 'hidden' },
  overlay: { flex: 1, backgroundColor: '#14261C66', justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' }, sheetAction: { minHeight: 48, paddingHorizontal: 20, justifyContent: 'center', alignItems: 'center', borderRadius: 12 },
});
