import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

const HTTP_URL = process.env.EXPO_PUBLIC_API_URL
  ? process.env.EXPO_PUBLIC_API_URL.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '')
  : 'http://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function registerForPushNotifications() {
  if (!Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;
  const token = (await Notifications.getExpoPushTokenAsync()).data;
  return token;
}

// ── Telas do fluxo ────────────────────────────────────────
const STEP = { PHONE: 'phone', OTP: 'otp', REGISTER: 'register' };

export default function LoginScreen({ onLogin }) {
  const [step, setStep] = useState(STEP.PHONE);
  const [telefone, setTelefone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('passageiro');
  const [chavePix, setChavePix] = useState('');
  const [veiculo, setVeiculo] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [pushToken, setPushToken] = useState(null);
  const fade = useRef(new Animated.Value(1)).current;
  const timerRef = useRef(null);

  useEffect(() => {
    registerForPushNotifications().then(setPushToken);
    return () => clearInterval(timerRef.current);
  }, []);

  const animStep = (fn) => {
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 100, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    fn();
  };

  // ── ETAPA 1: Solicitar OTP ──────────────────────────────
  const requestOTP = async () => {
    if (!telefone.trim() || telefone.length < 10) {
      Alert.alert('Atenção', 'Informe um telefone válido (com DDD).'); return;
    }
    setLoading(true);
    try {
      const r = await fetch(`${HTTP_URL}/api/auth/request-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone }),
      });
      const d = await r.json();
      animStep(() => setStep(STEP.OTP));
      setCountdown(60);
      timerRef.current = setInterval(() => setCountdown(c => { if (c <= 1) { clearInterval(timerRef.current); return 0; } return c - 1; }), 1000);
      // Em desenvolvimento: mostra o código no alerta
      if (d.debug_code) {
        Alert.alert('Código de Verificação', `Seu código: ${d.debug_code}\n\n(Em produção este código chegará por WhatsApp/SMS)`);
      }
    } catch (e) {
      Alert.alert('Erro de Conexão', e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── ETAPA 2: Verificar OTP ──────────────────────────────
  const verifyOTP = async () => {
    if (otpCode.length !== 6) { Alert.alert('Atenção', 'Informe o código de 6 dígitos.'); return; }
    setLoading(true);
    try {
      const r = await fetch(`${HTTP_URL}/api/auth/verify-otp`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone, code: otpCode }),
      });
      if (!r.ok) {
        const e = await r.json(); Alert.alert('Erro', e.detail); return;
      }
      const d = await r.json();
      if (d.is_new) {
        animStep(() => { setIsNewUser(true); setStep(STEP.REGISTER); });
      } else {
        // Usuário existente — atualiza push token e faz login
        if (pushToken) {
          await fetch(`${HTTP_URL}/api/users/push-token`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: d.user.user_id, push_token: pushToken }),
          });
          d.user.push_token = pushToken;
        }
        onLogin(d.user);
      }
    } catch (e) {
      Alert.alert('Erro', e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── ETAPA 3: Completar cadastro ─────────────────────────
  const completeRegister = async () => {
    if (!nome.trim()) { Alert.alert('Atenção', 'Informe seu nome.'); return; }
    if (tipo === 'motorista' && !veiculo.trim()) { Alert.alert('Atenção', 'Informe o veículo.'); return; }
    setLoading(true);
    try {
      const r = await fetch(`${HTTP_URL}/api/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, telefone, tipo, chave_pix: chavePix, veiculo, push_token: pushToken }),
      });
      const d = await r.json();
      if (d.user_id) onLogin(d.user);
      else Alert.alert('Erro', 'Falha no cadastro.');
    } catch (e) {
      Alert.alert('Erro', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#064e3b' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: '#047857', borderWidth: 3, borderColor: '#34d399', justifyContent: 'center', alignItems: 'center', marginBottom: 14, elevation: 10 }}>
            <Image source={require('../assets/icon.png')} style={{ width: 74, height: 74, borderRadius: 37 }} />
          </View>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -1 }}>BibiMarcos</Text>
          <Text style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, marginTop: 4, fontWeight: '700' }}>SUA CIDADE. SEU MOTORISTA.</Text>
        </View>

        {/* Card */}
        <View style={{ backgroundColor: '#fff', borderRadius: 28, padding: 24, elevation: 14 }}>
          <Animated.View style={{ opacity: fade }}>

            {/* STEP: PHONE */}
            {step === STEP.PHONE && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>Entrar ou Cadastrar</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>Informe seu WhatsApp para receber um código de verificação.</Text>
                <Field label="Telefone (com DDD)" value={telefone} onChange={setTelefone} placeholder="Ex: 32999991234" keyboard="phone-pad" />
                <Btn label="ENVIAR CÓDIGO →" onPress={requestOTP} loading={loading} />
              </>
            )}

            {/* STEP: OTP */}
            {step === STEP.OTP && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>Código de Verificação</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>Informe o código de 6 dígitos enviado para {telefone}.</Text>
                <TextInput
                  value={otpCode} onChangeText={setOtpCode}
                  placeholder="000000" placeholderTextColor="#cbd5e1"
                  keyboardType="number-pad" maxLength={6} textAlign="center"
                  style={{ backgroundColor: '#f0fdf4', borderWidth: 2, borderColor: '#064e3b', borderRadius: 16, paddingVertical: 18, fontSize: 32, fontWeight: '900', color: '#064e3b', letterSpacing: 10, marginBottom: 20 }}
                />
                <Btn label="VERIFICAR ✓" onPress={verifyOTP} loading={loading} />
                <TouchableOpacity
                  onPress={countdown === 0 ? requestOTP : null}
                  style={{ marginTop: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: countdown > 0 ? '#94a3b8' : '#064e3b', fontWeight: '700' }}>
                    {countdown > 0 ? `Reenviar em ${countdown}s` : '↩ Reenviar código'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => animStep(() => setStep(STEP.PHONE))} style={{ marginTop: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8' }}>← Trocar telefone</Text>
                </TouchableOpacity>
              </>
            )}

            {/* STEP: REGISTER */}
            {step === STEP.REGISTER && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>Completar cadastro</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 16, fontSize: 13 }}>Primeira vez por aqui! Complete seus dados.</Text>
                <Field label="Nome completo" value={nome} onChange={setNome} placeholder="Ex: João Silva" />
                <Text style={{ color: '#475569', fontWeight: '700', marginBottom: 10, fontSize: 12 }}>Você é:</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  {[{ k: 'passageiro', e: '🧑', l: 'Passageiro' }, { k: 'motorista', e: '🚗', l: 'Motorista' }].map(opt => (
                    <TouchableOpacity key={opt.k} onPress={() => setTipo(opt.k)}
                      style={{ flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 2, borderColor: tipo === opt.k ? '#064e3b' : '#e2e8f0', backgroundColor: tipo === opt.k ? '#ecfdf5' : '#f8fafc', alignItems: 'center' }}>
                      <Text style={{ fontSize: 24 }}>{opt.e}</Text>
                      <Text style={{ color: tipo === opt.k ? '#064e3b' : '#94a3b8', fontWeight: '800', fontSize: 12, marginTop: 4 }}>{opt.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {tipo === 'motorista' && (
                  <View style={{ backgroundColor: '#f0fdf4', borderRadius: 14, padding: 14, marginBottom: 12 }}>
                    <Text style={{ color: '#047857', fontWeight: '800', marginBottom: 10, fontSize: 12 }}>🚗 Dados do Motorista</Text>
                    <Field label="Chave Pix" value={chavePix} onChange={setChavePix} placeholder="CPF, e-mail ou telefone" />
                    <Field label="Veículo (modelo e placa)" value={veiculo} onChange={setVeiculo} placeholder="Ex: Gol 2020 - ABC1D23" />
                  </View>
                )}
                <Btn label="🚀  CRIAR CONTA" onPress={completeRegister} loading={loading} />
              </>
            )}

          </Animated.View>
        </View>

        <Text style={{ color: '#6ee7b7', textAlign: 'center', marginTop: 18, fontSize: 10, opacity: 0.6 }}>
          © OpenStreetMap · BibiMarcos v4
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: '#475569', fontWeight: '700', marginBottom: 5, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value} onChangeText={onChange} placeholder={placeholder}
        placeholderTextColor="#cbd5e1" keyboardType={keyboard || 'default'}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ backgroundColor: focused ? '#f0fdf4' : '#f8fafc', borderWidth: 1.5, borderColor: focused ? '#064e3b' : '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1e293b' }}
      />
    </View>
  );
}

function Btn({ label, onPress, loading }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={loading}
      style={{ backgroundColor: '#064e3b', paddingVertical: 17, borderRadius: 16, alignItems: 'center', opacity: loading ? 0.7 : 1, elevation: 4 }}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }}>{label}</Text>}
    </TouchableOpacity>
  );
}
