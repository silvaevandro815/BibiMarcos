import React from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, Alert } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

export default function PaymentModal({ visible, ride, onClose, onConfirm }) {
  if (!ride) return null;
  const fare = ride.fare ? ride.fare.toFixed(2) : '0.00';
  const chavePix = ride.driver_chave_pix || '';

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 24, borderWidth: 3, borderColor: '#064e3b' }}>
          <Text style={{ fontSize: 22, fontWeight: '900', color: '#064e3b', textAlign: 'center', marginBottom: 4 }}>🏁 Corrida Finalizada!</Text>
          <Text style={{ color: '#64748b', textAlign: 'center', marginBottom: 20 }}>Escolha como pagar o motorista</Text>

          <View style={{ backgroundColor: '#f0fdf4', borderRadius: 16, padding: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: '#bbf7d0' }}>
            <Text style={{ color: '#047857', fontWeight: '700', fontSize: 13, marginBottom: 4 }}>VALOR TOTAL</Text>
            <Text style={{ fontSize: 42, fontWeight: '900', color: '#064e3b' }}>R$ {fare}</Text>
            <Text style={{ color: '#10b981', fontSize: 11, fontWeight: '700', marginTop: 4 }}>100% vai para o motorista</Text>
          </View>

          {ride.dest_name && (
            <Text style={{ color: '#94a3b8', textAlign: 'center', marginBottom: 16, fontSize: 13 }}>
              📍 {ride.origin_name} → {ride.dest_name}
            </Text>
          )}

          {ride.payment_preference === 'PIX' ? (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Text style={{ color: '#475569', fontWeight: '700', textAlign: 'center', fontSize: 16 }}>Forma de pagamento escolhida:</Text>
              <Text style={{ color: '#10b981', fontWeight: '900', textAlign: 'center', fontSize: 24, marginTop: 8, marginBottom: 12 }}>❖ PIX</Text>
              <Text style={{ color: '#64748b', fontWeight: '600', textAlign: 'center', fontSize: 14, paddingHorizontal: 20 }}>
                Efetue o pagamento de R$ {fare} escaneando o QR Code físico no veículo ou solicitando a chave ao motorista.
              </Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 20 }}>
              <Text style={{ color: '#475569', fontWeight: '700', textAlign: 'center', fontSize: 16 }}>Forma de pagamento escolhida:</Text>
              <Text style={{ color: '#10b981', fontWeight: '900', textAlign: 'center', fontSize: 24, marginTop: 8, marginBottom: 12 }}>💵 Dinheiro</Text>
              <Text style={{ color: '#64748b', fontWeight: '600', textAlign: 'center', fontSize: 14, paddingHorizontal: 20 }}>
                Por favor, entregue o valor de R$ {fare} em mãos ao motorista.
              </Text>
            </View>
          )}

          <TouchableOpacity onPress={() => onConfirm(ride.payment_preference === 'PIX' ? 'pix' : 'cash')}
            style={{ backgroundColor: ride.payment_preference === 'PIX' ? '#064e3b' : '#f59e0b', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>
              {ride.payment_preference === 'PIX' ? '❖ JÁ PAGUEI VIA PIX' : '💵 JÁ PAGUEI EM DINHEIRO'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#94a3b8', fontWeight: '600' }}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
