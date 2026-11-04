import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ApiProvider } from '../src/api';
import { MenuProvider } from '../src/menu-draft';
import { colors } from '../src/ui';

export default function RootLayout() {
  return <ApiProvider><MenuProvider><StatusBar style="dark" /><Stack screenOptions={{ contentStyle: { backgroundColor: colors.bg }, headerTintColor: colors.ink, headerStyle: { backgroundColor: colors.bg }, headerShadowVisible: false }}><Stack.Screen name="(tabs)" options={{ headerShown: false }} /><Stack.Screen name="ingredient" options={{ title: '维护食材' }} /><Stack.Screen name="recipe" options={{ title: '菜谱' }} /><Stack.Screen name="menu" options={{ title: '本餐菜单' }} /></Stack></MenuProvider></ApiProvider>;
}
