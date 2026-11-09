import './ui/native-shim';
import 'react-native-gesture-handler';
import React from 'react';
import { StyleSheet, Platform, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme, guardScreen } from './ui/theme';
import { AppStoreProvider } from './store/StudioContext';

import WelcomeScreen from './screens/WelcomeScreen';
import SignInScreen from './screens/SignInScreen';
import DeckScreen from './screens/DeckScreen';
import TakesScreen from './screens/TakesScreen';
import DJModeScreen from './screens/DJModeScreen';
import BackPanelScreen from './screens/BackPanelScreen';
import SessionsScreen from './screens/SessionsScreen';

const RootStack = createStackNavigator();


function Root() {
  const t = useTheme();
  return (
    <NavigationContainer
      theme={{
        ...DefaultTheme,
        dark: !!t.dark,
        colors: { ...DefaultTheme.colors, primary: t.accent, background: t.bg, card: t.surface, text: t.text, border: t.border, notification: t.accent },
      }}
    >
      <RootStack.Navigator initialRouteName="Welcome" screenOptions={{ cardStyle: { flex: 1 }, headerShown: false }}>
      <RootStack.Screen name="Welcome" component={guardScreen(WelcomeScreen, "Welcome")} />
      <RootStack.Screen name="Sign In" component={guardScreen(SignInScreen, "Sign In")} />
      <RootStack.Screen name="Deck" component={guardScreen(DeckScreen, "Deck")} />
      <RootStack.Screen name="DJ Mode" component={guardScreen(DJModeScreen, "DJ Mode")} />
      <RootStack.Screen name="Back Panel" component={guardScreen(BackPanelScreen, "Back Panel")} />
      <RootStack.Screen name="Sessions" component={guardScreen(SessionsScreen, "Sessions")} />
      <RootStack.Screen name="Takes" component={guardScreen(TakesScreen, "Takes")} options={{ presentation: 'transparentModal', headerShown: false, cardStyle: { flex: 1, backgroundColor: 'transparent' }, cardOverlayEnabled: false }} />
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

/* The web preview's player is 285 points wide; this app is laid out for an iPhone's 390 and shrunk
   to fit it, so it looks like a phone's screen scaled down rather than a phone's screen squeezed. */
const PHONE_W = 390;
function WebPhone({ children }) {
  const { width, height } = useWindowDimensions();
  if (Platform.OS !== 'web' || width >= PHONE_W) return children;
  const k = width / PHONE_W;
  return (
    <View style={{ width: PHONE_W, height: height / k, transform: [{ scale: k }], transformOrigin: 'top left' }}>
      {children}
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider theme="mono" dark={true} bg="#0B0907" surface="#1A1714" text="#EDE6DB" textMuted="#A89F94" border="#332D27" success="#7FD18B" warning="#FFB347" danger="#FF2A1F" accent="#FF2A1F" accentSoft="#3A1411" accents={["#FFB347","#C9B79C","#6E665D","#26211D","#E8D9B8"]}>
          <WebPhone>
            <AppStoreProvider>
              <Root />
            </AppStoreProvider>
          </WebPhone>
          <StatusBar style="light" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
