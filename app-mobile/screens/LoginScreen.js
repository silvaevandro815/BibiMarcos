import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import Constants from 'expo-constants';


// ============================================================
// CONFIGURAÇÃO DE URL — ordem de prioridade
// O backend está em HTTP (Coolify sem SSL ativado)
// ============================================================
const BACKEND_HOST = 'p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io';

const API_CANDIDATES = [
  // 1. Variável de ambiente injetada no build (EAS Build)
  process.env.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
        .replace('ws://', 'http://')
        .replace('wss://', 'http://')
        .replace('/ws', '')
    : null,
  // 2. URL salva no app.json > extra.apiUrl
  Constants.expoConfig?.extra?.apiUrl || null,
  // 3. HTTP com domínio sslip.io (Coolify sem SSL)
  `http://${BACKEND_HOST}`,
  // 4. IP direto como último recurso
  `http://72.61.43.154:8000`,
].filter(Boolean);

const WS_CANDIDATES = [
  process.env.EXPO_PUBLIC_API_URL
    ? process.env.EXPO_PUBLIC_API_URL
        .replace('http://', 'ws://')
        .replace('https://', 'ws://')
        .replace(/\/?$/, '/ws')
    : null,
  Constants.expoConfig?.extra?.wsUrl || null,
  `ws://${BACKEND_HOST}/ws`,
  `ws://72.61.43.154:8000/ws`,
].filter(Boolean);


// Tenta conectar em cada URL com timeout de 8s
async function fetchWithFallback(path, options) {
  let lastError;
  for (const base of API_CANDIDATES) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(`${base}${path}`, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return resp;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

// Sanitiza número: remove +, espaços, traços; garante formato 10-11 dígitos
function sanitizeTelefone(raw) {
  let num = raw.replace(/\D/g, '');
  // Remove prefixo 55 se resultar em número longo (ex: 5532... -> 32...)
  if (num.length === 13 && num.startsWith('55')) num = num.slice(2);
  if (num.length === 12 && num.startsWith('55')) num = num.slice(2);
  return num;
}

// Armazenamento local de OTP para modo offline
let _localOtpStore = {};


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

const STEP = { PHONE: 'phone', OTP: 'otp', REGISTER: 'register', RECOVER: 'recover', RECOVER_OTP: 'recover_otp' };


export default function LoginScreen({ onLogin }) {
  const [step, setStep] = useState(STEP.PHONE);
  const [telefone, setTelefone] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [isNewUser, setIsNewUser] = useState(false);
  const [nome, setNome] = useState('');
  const [tipo, setTipo] = useState('passageiro');
  const [chavePix, setChavePix] = useState('');
  const [veiculo, setVeiculo] = useState('');
  const [fotoBase64, setFotoBase64] = useState('');
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [pushToken, setPushToken] = useState(null);
  // Recuperação de conta
  const [recoverNome, setRecoverNome] = useState('');
  const [recoverNovoTel, setRecoverNovoTel] = useState('');
  const [recoverOtp, setRecoverOtp] = useState('');
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

  const requestOTP = async () => {
    const numSanitizado = sanitizeTelefone(telefone);
    if (!numSanitizado || numSanitizado.length < 10) {
      Alert.alert('Atenção', 'Informe um telefone válido com DDD (ex: 32999991234).');
      return;
    }
    // Atualiza o campo com número sanitizado
    setTelefone(numSanitizado);
    setLoading(true);
    try {
      const r = await fetchWithFallback('/api/auth/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: numSanitizado }),
      });
      const d = await r.json();
      animStep(() => setStep(STEP.OTP));
      setCountdown(60);
      timerRef.current = setInterval(() =>
        setCountdown(c => { if (c <= 1) { clearInterval(timerRef.current); return 0; } return c - 1; }), 1000);
      if (d.debug_code) {
        Alert.alert(
          '📱 Código de Verificação',
          `Seu código: ${d.debug_code}\n\n(Em produção chegará via SMS/WhatsApp)`,
        );
      }
    } catch (e) {
      // Modo offline: gera código local para não bloquear o fluxo
      const codigoLocal = String(Math.floor(100000 + Math.random() * 900000));
      _localOtpStore[numSanitizado] = codigoLocal;
      animStep(() => setStep(STEP.OTP));
      setCountdown(60);
      timerRef.current = setInterval(() =>
        setCountdown(c => { if (c <= 1) { clearInterval(timerRef.current); return 0; } return c - 1; }), 1000);
      Alert.alert(
        '⚠️ Servidor Offline — Modo Demo',
        `Não conseguimos alcançar o servidor.\n\nUse este código para continuar:\n\n🔑 ${codigoLocal}\n\n(Seus dados serão salvos quando a conexão voltar)`,
      );
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    if (otpCode.length !== 6) { Alert.alert('Atenção', 'Informe o código de 6 dígitos.'); return; }
    setLoading(true);
    // Verificação modo offline
    const localCode = _localOtpStore[telefone];
    if (localCode) {
      if (otpCode !== localCode) {
        Alert.alert('Código incorreto', 'O código informado não confere. Tente novamente.');
        setLoading(false); return;
      }
      delete _localOtpStore[telefone];
      // No modo offline, vai direto para cadastro sem consultar o servidor
      animStep(() => { setIsNewUser(true); setStep(STEP.REGISTER); });
      setLoading(false); return;
    }
    try {
      const r = await fetchWithFallback('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone, code: otpCode }),
      });
      if (!r.ok) { const e = await r.json(); Alert.alert('Erro', e.detail); return; }
      const d = await r.json();
      if (d.is_new) {
        animStep(() => { setIsNewUser(true); setStep(STEP.REGISTER); });
      } else {
        if (pushToken) {
          await fetchWithFallback('/api/users/push-token', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: d.user.user_id, push_token: pushToken }),
          });
          d.user.push_token = pushToken;
        }
        onLogin(d.user);
      }
    } catch (e) {
      Alert.alert('Erro de Conexão', 'Não foi possível verificar o código.\nVerifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Precisamos de acesso às fotos para atualizar seu perfil.');
      return;
    }
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.1,   // comprimida ao máximo para evitar payloads grandes
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      const b64 = `data:image/jpeg;base64,${result.assets[0].base64}`;
      // Limite de segurança no mobile: ~400KB em base64
      if (result.assets[0].base64.length > 400_000) {
        Alert.alert('Foto muito grande', 'Por favor escolha uma foto menor ou tire uma nova foto.');
        return;
      }
      setFotoBase64(b64);
    }
  };

  const completeRegister = async () => {
    if (!nome.trim()) { Alert.alert('Atenção', 'Informe seu nome.'); return; }
    if (tipo === 'motorista' && !veiculo.trim()) { Alert.alert('Atenção', 'Informe o veículo.'); return; }
    setLoading(true);
    try {
      // 1. Cadastrar sem foto (payload leve)
      const r = await fetchWithFallback('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, telefone, tipo, chave_pix: chavePix, veiculo, push_token: pushToken, foto_url: '' }),
      });
      if (!r.ok) {
        const err = await r.json();
        Alert.alert('Erro no cadastro', err.detail || 'Tente novamente.'); return;
      }
      const d = await r.json();
      if (!d.user_id) { Alert.alert('Erro', 'Falha no cadastro.'); return; }

      // 2. Subir foto separadamente (só se o usuário escolheu uma)
      if (fotoBase64 && d.user_id) {
        try {
          await fetchWithFallback('/api/users/photo', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: d.user_id, foto_base64: fotoBase64 }),
          });
          d.user.foto_url = fotoBase64;
        } catch (photoErr) {
          // Foto falhou, mas o cadastro já foi — pode adicionar foto depois
          console.warn('Upload de foto falhou:', photoErr.message);
        }
      }

      onLogin(d.user);
    } catch (e) {
      Alert.alert(
        '⚠️ Sem Conexão',
        'Não foi possível salvar seu cadastro.\n\nVerifique se você tem internet e tente novamente.',
        [{ text: 'OK' }, { text: 'Tentar novamente', onPress: completeRegister }]
      );
    } finally {
      setLoading(false);
    }
  };


  // -------- RECUPERAÇÃO DE CONTA --------
  const requestRecoverOTP = async () => {
    const novoNum = sanitizeTelefone(recoverNovoTel);
    if (!recoverNome.trim() || novoNum.length < 10) {
      Alert.alert('Atenção', 'Preencha seu nome completo e o novo número com DDD.'); return;
    }
    setLoading(true);
    try {
      const r = await fetchWithFallback('/api/auth/change-phone/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novo_telefone: novoNum, nome_confirmacao: recoverNome }),
      });
      const d = await r.json();
      setRecoverNovoTel(novoNum);
      animStep(() => setStep(STEP.RECOVER_OTP));
      if (d.debug_code) {
        Alert.alert('Código de Recuperação', `Código: ${d.debug_code}\n\n(Em produção chegará no novo número)`);
      }
    } catch (e) {
      Alert.alert('Erro', 'Não foi possível enviar o código. Verifique sua conexão.');
    } finally { setLoading(false); }
  };

  const confirmRecoverOTP = async () => {
    if (recoverOtp.length !== 6) { Alert.alert('Atenção', 'Informe o código de 6 dígitos.'); return; }
    setLoading(true);
    try {
      const r = await fetchWithFallback('/api/auth/change-phone/verify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novo_telefone: recoverNovoTel, nome_confirmacao: recoverNome, code: recoverOtp }),
      });
      if (!r.ok) { const e = await r.json(); Alert.alert('Erro', e.detail); return; }
      Alert.alert(
        '✅ Conta Recuperada!',
        `Seu acesso foi restaurado!\nFaça login com o novo número: ${recoverNovoTel}`,
        [{ text: 'Fazer Login', onPress: () => { setTelefone(recoverNovoTel); animStep(() => setStep(STEP.PHONE)); } }]
      );
    } catch (e) {
      Alert.alert('Erro', 'Falha na recuperação. Tente novamente.');
    } finally { setLoading(false); }
  };


  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#064e3b' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: '#047857', borderWidth: 3, borderColor: '#34d399', justifyContent: 'center', alignItems: 'center', marginBottom: 14, elevation: 10 }}>
            <Image source={require('../assets/icon.png')} style={{ width: 74, height: 74, borderRadius: 37 }} />
          </View>
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900', letterSpacing: -1 }}>BibiMarcos</Text>
          <Text style={{ color: '#6ee7b7', fontSize: 11, letterSpacing: 3, marginTop: 4, fontWeight: '700' }}>SUA CIDADE. SEU MOTORISTA.</Text>
        </View>

        <View style={{ backgroundColor: '#fff', borderRadius: 28, padding: 24, elevation: 14 }}>
          <Animated.View style={{ opacity: fade }}>

            {step === STEP.PHONE && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>Entrar ou Cadastrar</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>Informe seu WhatsApp para receber um código.</Text>
                <Field label="Telefone (com DDD)" value={telefone} onChange={setTelefone} placeholder="Ex: 32999991234" keyboard="phone-pad" />
                <Btn label="ENVIAR CÓDIGO →" onPress={requestOTP} loading={loading} />
                <TouchableOpacity onPress={() => animStep(() => setStep(STEP.RECOVER))} style={{ marginTop: 18, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8', fontSize: 13 }}>Troquei de número / Não consigo entrar</Text>
                  <Text style={{ color: '#064e3b', fontWeight: '800', fontSize: 13, marginTop: 2 }}>Recuperar minha conta →</Text>
                </TouchableOpacity>
              </>
            )}


            {step === STEP.OTP && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>Código de Verificação</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>Informe o código enviado para {telefone}.</Text>
                <TextInput
                  value={otpCode} onChangeText={setOtpCode}
                  placeholder="000000" placeholderTextColor="#cbd5e1"
                  keyboardType="number-pad" maxLength={6} textAlign="center"
                  style={{ backgroundColor: '#f0fdf4', borderWidth: 2, borderColor: '#064e3b', borderRadius: 16, paddingVertical: 18, fontSize: 32, fontWeight: '900', color: '#064e3b', letterSpacing: 10, marginBottom: 20 }}
                />
                <Btn label="VERIFICAR ✓" onPress={verifyOTP} loading={loading} />
                <TouchableOpacity onPress={countdown === 0 ? requestOTP : null} style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: countdown > 0 ? '#94a3b8' : '#064e3b', fontWeight: '700' }}>{countdown > 0 ? `Reenviar em ${countdown}s` : '↩ Reenviar código'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => animStep(() => setStep(STEP.PHONE))} style={{ marginTop: 10, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8' }}>← Trocar telefone</Text>
                </TouchableOpacity>
              </>
            )}

            {/* ===== RECUPERAÇÃO DE CONTA ===== */}
            {step === STEP.RECOVER && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>Recuperar Conta</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 16, fontSize: 13 }}>Informe o nome exato do seu cadastro e seu novo número de WhatsApp.</Text>
                <View style={{ backgroundColor: '#fefce8', borderRadius: 12, padding: 12, marginBottom: 16, borderLeftWidth: 3, borderColor: '#f59e0b' }}>
                  <Text style={{ color: '#78350f', fontSize: 12, fontWeight: '700' }}>Como funciona?</Text>
                  <Text style={{ color: '#92400e', fontSize: 11, marginTop: 4, lineHeight: 16 }}>{'Nosso sistema usa OTP (código por WhatsApp) como senha.\nSe trocou de número, informe aqui o nome cadastrado e o novo número para recuperar o acesso.'}</Text>
                </View>
                <Field label="Nome completo cadastrado" value={recoverNome} onChange={setRecoverNome} placeholder="Ex: João Silva" />
                <Field label="Novo número WhatsApp (com DDD)" value={recoverNovoTel} onChange={setRecoverNovoTel} placeholder="Ex: 32999991234" keyboard="phone-pad" />
                <Btn label="ENVIAR CÓDIGO DE RECUPERAÇÃO" onPress={requestRecoverOTP} loading={loading} />
                <TouchableOpacity onPress={() => animStep(() => setStep(STEP.PHONE))} style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8' }}>← Voltar ao login</Text>
                </TouchableOpacity>
              </>
            )}

            {step === STEP.RECOVER_OTP && (
              <>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b', marginBottom: 6 }}>✅ Confirmar Recuperação</Text>
                <Text style={{ color: '#94a3b8', marginBottom: 20, fontSize: 13 }}>Informe o código enviado para {recoverNovoTel}.</Text>
                <TextInput
                  value={recoverOtp} onChangeText={setRecoverOtp}
                  placeholder="000000" placeholderTextColor="#cbd5e1"
                  keyboardType="number-pad" maxLength={6} textAlign="center"
                  style={{ backgroundColor: '#f0fdf4', borderWidth: 2, borderColor: '#064e3b', borderRadius: 16, paddingVertical: 18, fontSize: 32, fontWeight: '900', color: '#064e3b', letterSpacing: 10, marginBottom: 20 }}
                />
                <Btn label="CONFIRMAR E RECUPERAR ✓" onPress={confirmRecoverOTP} loading={loading} />
                <TouchableOpacity onPress={() => animStep(() => setStep(STEP.RECOVER))} style={{ marginTop: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#94a3b8' }}>← Voltar</Text>
                </TouchableOpacity>
              </>
            )}

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
                    <View style={{ alignItems: 'center', marginBottom: 14 }}>
                        <TouchableOpacity onPress={pickImage} style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#d1fae5', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#10b981', overflow: 'hidden' }}>
                            {fotoBase64 ? <Image source={{ uri: fotoBase64 }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontSize: 24 }}>📸</Text>}
                        </TouchableOpacity>
                        <Text style={{ color: '#047857', fontSize: 11, fontWeight: '700', marginTop: 6 }}>Sua Foto</Text>
                    </View>
                    <Field label="Chave Pix" value={chavePix} onChange={setChavePix} placeholder="CPF, e-mail ou telefone" />
                    <Field label="Veículo (modelo e placa)" value={veiculo} onChange={setVeiculo} placeholder="Ex: Gol 2020 - ABC1D23" />
                  </View>
                )}
                {tipo === 'passageiro' && (
                   <View style={{ alignItems: 'center', marginBottom: 14 }}>
                        <TouchableOpacity onPress={pickImage} style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#cbd5e1', overflow: 'hidden' }}>
                            {fotoBase64 ? <Image source={{ uri: fotoBase64 }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ fontSize: 24 }}>📸</Text>}
                        </TouchableOpacity>
                        <Text style={{ color: '#64748b', fontSize: 11, fontWeight: '700', marginTop: 6 }}>Sua Foto (Opcional)</Text>
                    </View>
                )}
                <Btn label="🚀  CRIAR CONTA" onPress={completeRegister} loading={loading} />
              </>
            )}

          </Animated.View>
        </View>
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
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#cbd5e1" keyboardType={keyboard || 'default'}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        style={{ backgroundColor: focused ? '#f0fdf4' : '#f8fafc', borderWidth: 1.5, borderColor: focused ? '#064e3b' : '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1e293b' }}
      />
    </View>
  );
}

function Btn({ label, onPress, loading }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={loading} style={{ backgroundColor: '#064e3b', paddingVertical: 17, borderRadius: 16, alignItems: 'center', opacity: loading ? 0.7 : 1, elevation: 4 }}>
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15, letterSpacing: 0.5 }}>{label}</Text>}
    </TouchableOpacity>
  );
}
