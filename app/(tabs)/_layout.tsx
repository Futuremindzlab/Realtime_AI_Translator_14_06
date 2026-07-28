import { Tabs } from 'expo-router';
import { Home, History, Settings, BarChart2 } from 'lucide-react-native';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/contexts/AuthContext';

// Polyfill must stay at the top — fast-text-encoding self-installs
// global.TextDecoder/TextEncoder as a side effect (it has no exports of its
// own to pull from, so there's nothing to assign after this import).
import 'fast-text-encoding';

export default function TabLayout() {
  const { user, viewMode } = useAuth();
  const insets = useSafeAreaInsets();
  // Hide Dashboard for regular users and when owner previews user experience
  const isUserView = user?.role === 'USER' || viewMode === 'user';

  // On Android the system navigation bar (gesture strip or buttons) sits at the
  // bottom. insets.bottom gives the exact height we need to clear it so all tabs
  // remain tappable. iOS uses the standard home-indicator inset.
  const tabBarHeight = Platform.OS === 'ios' ? 88 : 56 + insets.bottom;
  const tabBarPaddingBottom = Platform.OS === 'ios' ? 30 : insets.bottom + 6;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: '#6b7280',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#e5e7eb',
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ size, color }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ size, color }) => <History size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: 'Dashboard',
          // href: null hides the tab from the tab bar (Expo Router v3)
          href: isUserView ? null : undefined,
          tabBarIcon: ({ size, color }) => <BarChart2 size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ size, color }) => <Settings size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
