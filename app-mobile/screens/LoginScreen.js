import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Animated,
} from 'react-native';

const HTTP_API_URL = process.env.EXPO_PUBLIC_API_URL
  ? process.env.EXPO_PUBLIC_API_URL.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '')
  : 'http://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io';

export default function LoginScreen({ onLogin }) {
  const [isRegister, setIsRegister] = useState(true);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [tipo, setTipo] = useState('passageiro');
  const [chavePix, setChavePix] = useState('');
  const [veiculo, setVeiculo] = useState('');
  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const switchMode = (mode) => {
    Animated.sequence([
      Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setIsRegister(mode);
  };

  const handleSubmit = async () => {
    if (!telefone.trim()) { Alert.alert('Atenção', 'Informe seu telefone'); return; }
    if (isRegister && !nome.trim()) { Alert.alert('Atenção', 'Informe seu nome completo'); return; }
    if (isRegister && tipo === 'motorista' && !veiculo.trim()) {
      Alert.alert('Atenção', 'Informe os dados do seu veículo'); return;
    }
    setLoading(true);
    try {
      const endpoint = isRegister ? '/api/register' : '/api/login';
      const body = isRegister
        ? { nome, telefone, tipo, chave_pix: chavePix, veiculo }
        : { telefone };

      const resp = await fetch(`${HTTP_API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (resp.status === 404) {
        Alert.alert('Usuário não encontrado', 'Você ainda não tem cadastro. Clique em "Cadastrar".');
        switchMode(true);
        return;
      }

      const data = await resp.json();
      if (data.user_id || data.user) {
        onLogin(data.user || data);
      } else {
        Alert.alert('Erro', 'Falha ao autenticar. Tente novamente.');
      }
    } catch (e) {
      Alert.alert('Erro de Conexão', `Não foi possível conectar ao servidor.\n\nVerifique sua internet.\n\nDetalhe: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: '#064e3b' }}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }} keyboardShouldPersistTaps="handled">
        {/* Logo + Título */}
        <View style={{ alignItems: 'center', marginBottom: 36 }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: '#047857', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#34d399', marginBottom: 16, shadowColor: '#10b981', shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 }}>
            <Image
              source={require('../assets/icon.png')}
              style={{ width: 80, height: 80, borderRadius: 40 }}
              resizeMode="cover"
            />
          </View>
          <Text style={{ color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1 }}>BibiMarcos</Text>
          <Text style={{ color: '#6ee7b7', fontSize: 12, letterSpacing: 3, marginTop: 4, fontWeight: '700' }}>SUA CIDADE. SEU MOTORISTA.</Text>
        </View>

        {/* Card */}
        <View style={{ backgroundColor: '#fff', borderRadius: 28, padding: 24, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, elevation: 14 }}>

          {/* Toggle Cadastrar / Entrar */}
          <View style={{ flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 14, marginBottom: 22, padding: 4 }}>
            {['Cadastrar', 'Entrar'].map((label, i) => {
              const active = (i === 0) === isRegister;
              return (
                <TouchableOpacity
                  key={label}
                  onPress={() => switchMode(i === 0)}
                  style={{
                    flex: 1, paddingVertical: 11, borderRadius: 11,
                    backgroundColor: active ? '#064e3b' : 'transparent',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: active ? '#fff' : '#64748b', fontWeight: '800', fontSize: 15 }}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Animated.View style={{ opacity: fadeAnim }}>
            {/* Campo Nome (só no cadastro) */}
            {isRegister && (
              <Field label="Nome completo" value={nome} onChange={setNome} placeholder="Ex: João Silva" />
            )}

            {/* Campo Telefone */}
            <Field label="Telefone (WhatsApp)" value={telefone} onChange={setTelefone} placeholder="Ex: 32999991234" keyboard="phone-pad" />

            {/* Tipo de usuário (só no cadastro) */}
            {isRegister && (
              <>
                <Text style={{ color: '#475569', fontWeight: '700', marginBottom: 10, fontSize: 13 }}>Você é:</Text>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 18 }}>
                  {[
                    { key: 'passageiro', label: 'Passageiro', emoji: '🧑' },
                    { key: 'motorista', label: 'Motorista', emoji: '🚗' },
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setTipo(opt.key)}
                      style={{
                        flex: 1, paddingVertical: 14, borderRadius: 14,
                        borderWidth: 2, borderColor: tipo === opt.key ? '#064e3b' : '#e2e8f0',
                        backgroundColor: tipo === opt.key ? '#ecfdf5' : '#f8fafc',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 26 }}>{opt.emoji}</Text>
                      <Text style={{ color: tipo === opt.key ? '#064e3b' : '#94a3b8', fontWeight: '800', marginTop: 4, fontSize: 13 }}>{opt.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Campos exclusivos de motorista */}
                {tipo === 'motorista' && (
                  <View style={{ backgroundColor: '#f0fdf4', borderRadius: 14, padding: 14, marginBottom: 10 }}>
                    <Text style={{ color: '#047857', fontWeight: '800', marginBottom: 10, fontSize: 13 }}>🚗 Dados do Motorista</Text>
                    <Field label="Chave Pix (CPF, e-mail ou telefone)" value={chavePix} onChange={setChavePix} placeholder="Ex: 123.456.789-00" />
                    <Field label="Veículo (modelo e placa)" value={veiculo} onChange={setVeiculo} placeholder="Ex: Gol 2020 - ABC1D23" />
                  </View>
                )}
              </>
            )}

            {/* Botão */}
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={loading}
              style={{ backgroundColor: '#064e3b', paddingVertical: 17, borderRadius: 16, alignItems: 'center', marginTop: 8, opacity: loading ? 0.7 : 1, shadowColor: '#064e3b', shadowOpacity: 0.35, shadowRadius: 10, elevation: 6 }}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 }}>
                    {isRegister ? '🚀  CRIAR CONTA' : '▶  ENTRAR'}
                  </Text>
              }
            </TouchableOpacity>
          </Animated.View>
        </View>

        <Text style={{ color: '#6ee7b7', textAlign: 'center', marginTop: 20, fontSize: 11, opacity: 0.7 }}>
          © OpenStreetMap contributors • BibiMarcos v3
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChange, placeholder, keyboard }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: '#475569', fontWeight: '700', marginBottom: 6, fontSize: 12 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#cbd5e1"
        keyboardType={keyboard || 'default'}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          backgroundColor: focused ? '#f0fdf4' : '#f8fafc',
          borderWidth: 1.5,
          borderColor: focused ? '#064e3b' : '#e2e8f0',
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 15,
          color: '#1e293b',
        }}
      />
    </View>
  );
}
