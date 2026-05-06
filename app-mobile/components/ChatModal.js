import React, { useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, Modal, KeyboardAvoidingView, Platform } from 'react-native';

export default function ChatModal({ visible, onClose, messages, input, onChangeInput, onSend, isDriver }) {
  const flatRef = useRef(null);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '65%', borderTopWidth: 5, borderTopColor: '#064e3b' }}>
          <View style={{ backgroundColor: '#064e3b', padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 17 }}>💬 Chat da Viagem</Text>
            <TouchableOpacity onPress={onClose} style={{ backgroundColor: '#047857', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 }}>
              <Text style={{ color: '#fff', fontWeight: '700' }}>✕</Text>
            </TouchableOpacity>
          </View>
          <FlatList ref={flatRef} data={messages} style={{ flex: 1, padding: 12 }}
            keyExtractor={(_, i) => i.toString()}
            onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: '#94a3b8', marginTop: 20 }}>Nenhuma mensagem ainda.</Text>}
            renderItem={({ item }) => {
              const isMe = item.sender === (isDriver ? 'motorista' : 'passageiro');
              return (
                <View style={{ marginBottom: 10, maxWidth: '80%', alignSelf: isMe ? 'flex-end' : 'flex-start',
                  backgroundColor: isMe ? '#d1fae5' : '#f1f5f9', borderRadius: 16,
                  borderBottomRightRadius: isMe ? 4 : 16, borderBottomLeftRadius: isMe ? 16 : 4,
                  padding: 12, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 }}>
                  <Text style={{ color: '#1e293b', fontSize: 15 }}>{item.text}</Text>
                  <Text style={{ color: '#94a3b8', fontSize: 10, marginTop: 4, textAlign: 'right' }}>
                    {item.sender === 'motorista' ? '🚗 Motorista' : '🧑 Passageiro'}
                  </Text>
                </View>
              );
            }}
          />
          <View style={{ padding: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center' }}>
            <TextInput value={input} onChangeText={onChangeInput} placeholder="Escreva sua mensagem..."
              placeholderTextColor="#94a3b8" style={{ flex: 1, backgroundColor: '#f8fafc', borderRadius: 24,
              paddingHorizontal: 18, paddingVertical: 12, marginRight: 10, borderWidth: 1.5,
              borderColor: '#e2e8f0', color: '#1e293b', fontSize: 15 }} />
            <TouchableOpacity onPress={onSend} style={{ backgroundColor: '#064e3b', width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 }}>
              <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900' }}>›</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
