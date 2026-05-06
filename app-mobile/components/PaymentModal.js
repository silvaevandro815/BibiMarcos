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

          {chavePix ? (
            <ScrollView>
              <Text style={{ color: '#475569', fontWeight: '700', textAlign: 'center', marginBottom: 12 }}>Pagar via PIX</Text>
              <View style={{ alignItems: 'center', marginBottom: 12, backgroundColor: '#fff', padding: 8, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, elevation: 3 }}>
                <QRCode value={`00020126360014br.gov.bcb.pix0114${chavePix}5204000053039865405${fare}5802BR5909BibiMarcos6008Muriae62070503***6304`}
                  size={160} color="#064e3b" backgroundColor="white" />
              </View>
              <Text style={{ color: '#475569', fontWeight: '600', textAlign: 'center', marginBottom: 4, fontSize: 13 }}>Chave PIX:</Text>
              <Text style={{ color: '#064e3b', fontWeight: '800', textAlign: 'center', fontSize: 16, marginBottom: 20 }}>{chavePix}</Text>
            </ScrollView>
          ) : null}

          <TouchableOpacity onPress={() => { Alert.alert('Dinheiro', `Entregue R$ ${fare} em dinheiro ao motorista.`); onConfirm('cash'); }}
            style={{ backgroundColor: '#f59e0b', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>💵 PAGAR EM DINHEIRO</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={() => onConfirm('pix')}
            style={{ backgroundColor: '#064e3b', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>📱 PAGAR VIA PIX</Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#94a3b8', fontWeight: '600' }}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
