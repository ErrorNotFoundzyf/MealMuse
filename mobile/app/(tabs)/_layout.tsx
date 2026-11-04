import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '../../src/ui';

export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.green, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line }, tabBarLabelStyle: { fontSize: 11, fontWeight: '600' } }}>
    <Tabs.Screen name="ingredients" options={{ title: '食材', tabBarIcon: ({ color, size }) => <Ionicons name="leaf-outline" color={typeof color === 'string' ? color : colors.green} size={size} /> }} />
    <Tabs.Screen name="recipes" options={{ title: '菜谱', tabBarIcon: ({ color, size }) => <Ionicons name="book-outline" color={typeof color === 'string' ? color : colors.green} size={size} /> }} />
    <Tabs.Screen name="index" options={{ title: '今日灵感', tabBarIcon: ({ color, size }) => <Ionicons name="sunny-outline" color={typeof color === 'string' ? color : colors.green} size={size} /> }} />
    <Tabs.Screen name="journal" options={{ title: '食记', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={typeof color === 'string' ? color : colors.green} size={size} /> }} />
    <Tabs.Screen name="settings" options={{ title: '家庭', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={typeof color === 'string' ? color : colors.green} size={size} /> }} />
  </Tabs>;
}
