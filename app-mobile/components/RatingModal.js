import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';

export default function RatingModal({ visible, onClose, onSubmit, isDriver }) {
  const [rating, setRating] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (rating === 0) return;
    setLoading(true);
    await onSubmit(rating);
    setLoading(false);
    setRating(0);
  };

  const handleSkip = () => {
    setRating(0); // Sempre resetar antes de fechar
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 28, padding: 30, alignItems: 'center', elevation: 20 }}>
          <Text style={{ fontSize: 26, fontWeight: '900', color: '#064e3b', marginBottom: 8 }}>Corrida Finalizada!</Text>
          <Text style={{ color: '#64748b', textAlign: 'center', marginBottom: 24, fontSize: 16 }}>
            {isDriver ? 'Avalie o comportamento do passageiro:' : 'Como foi a sua viagem com o motorista?'}
          </Text>

          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 30 }}>
            {[1, 2, 3, 4, 5].map(star => (
              <TouchableOpacity key={star} onPress={() => setRating(star)}>
                <Text style={{ fontSize: 44, color: star <= rating ? '#fbbf24' : '#e2e8f0', textShadowColor: 'rgba(0,0,0,0.1)', textShadowOffset: {width: 0, height: 2}, textShadowRadius: 4 }}>★</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            disabled={rating === 0 || loading}
            onPress={handleSubmit}
            style={{ backgroundColor: rating > 0 ? '#064e3b' : '#cbd5e1', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 16, width: '100%', alignItems: 'center', elevation: rating > 0 ? 5 : 0 }}
          >
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16, letterSpacing: 1 }}>ENVIAR AVALIAÇÃO</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSkip} style={{ marginTop: 20 }}>
            <Text style={{ color: '#94a3b8', fontWeight: '800', fontSize: 15 }}>Pular</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
