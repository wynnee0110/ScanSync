import { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Palette } from '@/constants/palette';
import { useAuth } from '@/features/auth/auth-context';
import { loadStoredOperators, syncOperatorsFromSupabase } from '@/features/operators/operator-store';
import { getPreference } from '@/lib/preferences';

function cleanCode(code: string): string {
  return code.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function cleanDigits(code: string): string {
  return code.replace(/[^0-9]/g, '');
}

function matchesEmail(inputEmail: string, opEmail: string): boolean {
  const cleanInput = inputEmail.trim().toLowerCase();
  const cleanOp = opEmail.trim().toLowerCase();

  if (cleanInput === cleanOp) return true;
  const inputPrefix = cleanInput.split('@')[0];
  const opPrefix = cleanOp.split('@')[0];

  return inputPrefix === opPrefix || cleanInput === opPrefix || cleanOp === inputPrefix;
}

function matchesPasscode(inputPass: string, opPass: string): boolean {
  const cleanInput = inputPass.trim().toLowerCase();
  const cleanOp = opPass.trim().toLowerCase();

  if (cleanInput === cleanOp) return true;

  const codeA = cleanCode(cleanInput);
  const codeB = cleanCode(cleanOp);
  if (codeA && codeB && codeA === codeB) return true;

  const digitsA = cleanDigits(cleanInput);
  const digitsB = cleanDigits(cleanOp);
  if (digitsA && digitsB && (digitsA === digitsB || codeA.endsWith(digitsB) || codeB.endsWith(digitsA))) return true;

  return false;
}

export function LoginScreen() {
  const { signInWithEmail, signInLocally, isConfigured } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void syncOperatorsFromSupabase();
    void (async () => {
      try {
        const savedEmail = await getPreference('auth.remembered_email');
        const savedRemember = await getPreference('auth.remember_me');
        if (savedEmail) setEmail(savedEmail);
        if (savedRemember === 'false') setRememberMe(false);
      } catch { }
    })();
  }, []);

  const handleLogin = async () => {
    setError(null);

    const trimmedEmail = email.trim();
    const trimmedPass = password.trim();

    if (!trimmedEmail || !trimmedPass) {
      setError('Please enter your email and passcode.');
      return;
    }

    setLoading(true);

    if (isConfigured) {
      const { error: authError } = await signInWithEmail(trimmedEmail, trimmedPass);
      if (!authError) {
        setLoading(false);
        router.replace('/(tabs)' as Href);
        return;
      }
    }

    // Supabase not configured: check local operator store
    const localOperators = await loadStoredOperators();
    const matchingOp = localOperators.find(
      (op) => matchesEmail(trimmedEmail, op.email) && matchesPasscode(trimmedPass, op.generatedPasswordCode),
    );

    if (matchingOp) {
      try {
        const { listEvents } = await import('@/features/events/event-repository');
        const { getOperatorAccessStatus } = await import('@/features/operators/operator-helpers');
        const realEvents = await listEvents();
        const accessStatus = getOperatorAccessStatus(matchingOp, realEvents);

        if (accessStatus.isRevoked) {
          setLoading(false);
          setError(`Access Revoked: Operator account is ${accessStatus.label.toLowerCase()}.`);
          return;
        }
      } catch {
        // Fallthrough if status check fails
      }

      signInLocally(
        {
          id: matchingOp.id,
          email: matchingOp.email,
          name: matchingOp.name,
          role: matchingOp.role,
          assignedEventId: matchingOp.assignedEventId,
        },
        rememberMe,
      );
      setLoading(false);
      router.replace('/(tabs)' as Href);
      return;
    }

    setLoading(false);
    setError('Invalid email or passcode. Please check your credentials.');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">

          {/* BRANDING HEADER */}
          <View style={styles.brandHeader}>
            <View style={styles.logoBadge}>
              <Image
                source={require('@/assets/images/Logo.png')}
                style={styles.logoImage}
                resizeMode="cover"
              />
            </View>

            <Text style={styles.brandTitle}>ScanSync</Text>
            <Text style={styles.brandSubtitle}>Attendance Portal</Text>
          </View>

          {/* MINIMAL CARD */}
          <View style={styles.card}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="mail-outline" size={18} color="#94A3B8" />
                <TextInput
                  value={email}
                  onChangeText={(val) => {
                    setEmail(val);
                    setError(null);
                  }}
                  placeholder="email"
                  placeholderTextColor="#CBD5E1"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  style={styles.textInput}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Passcode</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color="#94A3B8" />
                <TextInput
                  value={password}
                  onChangeText={(val) => {
                    setPassword(val);
                    setError(null);
                  }}
                  placeholder="password"
                  placeholderTextColor="#CBD5E1"
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                  style={styles.textInput}
                />
                <TouchableOpacity
                  onPress={() => setShowPassword(!showPassword)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color="#94A3B8"
                  />
                </TouchableOpacity>
              </View>
            </View>

            {/* REMEMBER ME TOGGLE */}
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberMe }}
              accessibilityLabel="Remember me"
              onPress={() => setRememberMe(!rememberMe)}
              style={styles.rememberRow}>
              <Ionicons
                name={rememberMe ? 'checkbox' : 'square-outline'}
                size={20}
                color={rememberMe ? '#0F172A' : '#94A3B8'}
              />
              <Text style={styles.rememberText}>Remember me?</Text>
            </Pressable>

            {error && (
              <View style={styles.errorCard}>
                <Ionicons name="alert-circle" size={16} color={Palette.dangerText} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={handleLogin}
              disabled={loading}
              style={({ pressed }) => [
                styles.submitButton,
                loading && styles.submitButtonDisabled,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={styles.submitButtonText}>
                {loading ? 'Signing in…' : 'Sign In'}
              </Text>
            </Pressable>
          </View>

          {/* FOOTER */}
          <Text style={styles.footerText}>ScanSync v1.0.0 • ICpEP.SE</Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoBadge: {
    width: 128,
    height: 128,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 6,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  brandTitle: {
    marginTop: 16,
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.4,
  },
  brandSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 2,
  },
  inputGroup: {
    marginBottom: 18,
  },
  inputLabel: {
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
  },
  textInput: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#0F172A',
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    marginTop: 2,
    gap: 8,
  },
  rememberText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#475569',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: Palette.dangerText,
  },
  submitButton: {
    height: 52,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  submitButtonDisabled: {
    backgroundColor: '#94A3B8',
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  footerText: {
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '500',
    color: '#CBD5E1',
    marginTop: 24,
  },
});
