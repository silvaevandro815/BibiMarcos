import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform } from 'react-native';

const HTTP_API_URL = process.env.EXPO_PUBLIC_API_URL
  ? process.env.EXPO_PUBLIC_API_URL.replace('ws://', 'http://').replace('/ws', '')
  : 'http://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io';

export default function LoginScreen({ onLogin }) {
  const [isRegister, setIsRegister] = useState(true);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [tipo, setTipo] = useState('passageiro');
  const [chavePix, setChavePix] = useState('');
  const [veiculo, setVeiculo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!telefone.trim()) { Alert.alert('Atenção', 'Informe seu telefone'); return; }
    if (isRegister && !nome.trim()) { Alert.alert('Atenção', 'Informe seu nome'); return; }
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
      if (resp.status === 404) { Alert.alert('Erro', 'Usuário não encontrado. Cadastre-se.'); setIsRegister(true); return; }
      const data = await resp.json();
      if (data.user_id) onLogin(data.user);
      else Alert.alert('Erro', 'Falha ao autenticar.');
    } catch (e) {
      Alert.alert('Erro de Conexão', 'Verifique sua internet e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#064e3b' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <Image source={require('../assets/icon.png')} style={{ width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: '#34d399' }} />
          <Text style={{ color: '#fff', fontSize: 32, fontWeight: '900', marginTop: 12 }}>BibiMarcos</Text>
          <Text style={{ color: '#6ee7b7', fontSize: 13, letterSpacing: 2, marginTop: 4 }}>SUA CIDADE. SEU MOTORISTA.</Text>
        </View>

        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 }}>
          <View style={{ flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 12, marginBottom: 20, padding: 4 }}>
            {['Cadastrar', 'Entrar'].map((label, i) => (
              <TouchableOpacity key={label} onPress={() => setIsRegister(i === 0)}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: (i === 0) === isRegister ? '#064e3b' : 'transparent', alignItems: 'center' }}>
                <Text style={{ color: (i === 0) === isRegister ? '#fff' : '#64748b', fontWeight: '700', fontSize: 15 }}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {isRegister && (
            <Input label="Nome completo" value={nome} onChangeText={setNome} placeholder="Ex: João Silva" />
          )}
          <Input label="Telefone (WhatsApp)" value={telefone} onChangeText={setTelefone} placeholder="Ex: 32999991234" keyboardType="phone-pad" />

          {isRegister && (
            <>
              <Text style={{ color: '#475569', fontWeight: '700', marginBottom: 8 }}>Você é:</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                {['passageiro', 'motorista'].map(t => (
                  <TouchableOpacity key={t} onPress={() => setTipo(t)}
                    style={{ flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: tipo === t ? '#064e3b' : '#e2e8f0', backgroundColor: tipo === t ? '#ecfdf5' : '#f8fafc', alignItems: 'center' }}>
                    <Text style={{ fontSize: 22 }}>{t === 'passageiro' ? '🧑' : '🚗'}</Text>
                    <Text style={{ color: tipo === t ? '#064e3b' : '#94a3b8', fontWeight: '700', marginTop: 4, textTransform: 'capitalize' }}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {tipo === 'motorista' && (
                <>
                  <Input label="Chave Pix (CPF, e-mail ou telefone)" value={chavePix} onChangeText={setChavePix} placeholder="Ex: 123.456.789-00" />
                  <Input label="Veículo (modelo/placa)" value={veiculo} onChangeText={setVeiculo} placeholder="Ex: Gol 2019 - ABC1D23" />
                </>
              )}
            </>
          )}

          <TouchableOpacity onPress={handleSubmit} disabled={loading}
            style={{ backgroundColor: '#064e3b', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8, opacity: loading ? 0.7 : 1 }}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 }}>{isRegister ? 'CRIAR CONTA' : 'ENTRAR'}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Input({ label, value, onChangeText, placeholder, keyboardType }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: '#475569', fontWeight: '700', marginBottom: 6, fontSize: 13 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor="#cbd5e1" keyboardType={keyboardType || 'default'}
        style={{ backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1e293b' }} />
    </View>
  );
}
