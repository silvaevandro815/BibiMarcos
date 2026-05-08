import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  FlatList, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const UA = 'BibiMarcos/3.0 (contato@bibimarcos.app)';

export async function geocodeAddress(query) {
  // Converte a busca para letras minúsculas para verificação
  const qLower = query.toLowerCase();
  
  // Lista dos distritos e povoados conhecidos de Muriaé
  const distritos = ['belisário', 'belisario', 'boa família', 'boa familia', 'bom jesus', 'itamuri', 'pirapanema', 'vermelho', 'macuco', 'retiro', 'capetinga', 'são joão do glória', 'sao joao do gloria'];
  
  // Verifica se o usuário já digitou 'muriaé' ou se é um distrito conhecido
  const hasMuriae = qLower.includes('muria');
  const isDistrito = distritos.some(d => qLower.includes(d));

  // Formata a string de busca perfeitamente para o Nominatim entender que é em Muriaé
  let queryStr = query;
  if (!hasMuriae) {
    queryStr = isDistrito ? `${query}, Muriaé - MG` : `${query}, Muriaé - MG`;
  }

  // Viewbox expandido para 40km, cobrindo todo o município de Muriaé e zonas rurais, blindando o resto do Brasil
  const url = `${NOMINATIM_URL}/search?format=jsonv2&q=${encodeURIComponent(queryStr)}&limit=5&countrycodes=br&viewbox=-42.70,-20.80,-42.00,-21.40&bounded=1`;
  
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  return r.json();
}

export async function reverseGeocode(lat, lng) {
  const url = `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const d = await r.json();
  return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export async function getRoute(originLat, originLng, destLat, destLng) {
  const url = `${OSRM_URL}/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`;
  const r = await fetch(url);
  const d = await r.json();
  if (d.routes && d.routes.length > 0) {
    const route = d.routes[0];
    return {
      distance_meters: route.distance,
      duration_seconds: route.duration,
      geometry: route.geometry.coordinates, // [[lng, lat], ...]
    };
  }
  return null;
}

export default function DestinationModal({ visible, onClose, origin, onConfirm }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  
  // Novo State para a Tela de Confirmação (Review)
  const [reviewData, setReviewData] = useState(null);
  const [paymentMode, setPaymentMode] = useState('PIX');

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await geocodeAddress(query);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const selectDest = async (item) => {
    setLoading(true);
    try {
      const destLat = parseFloat(item.lat);
      const destLng = parseFloat(item.lon);
      const route = await getRoute(origin.latitude, origin.longitude, destLat, destLng);
      
      const distance = route ? route.distance_meters : haversineSimple(origin.latitude, origin.longitude, destLat, destLng);
      const fareCalculated = 5.0 + (distance / 1000.0) * 2.0;

      setReviewData({
        dest_lat: destLat,
        dest_lng: destLng,
        dest_name: item.display_name.split(',').slice(0, 2).join(',').trim(),
        distance_meters: distance,
        geometry: route ? route.geometry : null,
        fare: fareCalculated.toFixed(2)
      });
      setQuery('');
      setResults([]);
    } catch (e) {
      alert('Erro ao calcular rota. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const confirmRide = () => {
    if (reviewData) {
      onConfirm({
        ...reviewData,
        payment_preference: paymentMode
      });
      setReviewData(null);
    }
  };

  const fecharTudo = () => {
    setReviewData(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={fecharTudo}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: '85%' }}>
          
          {reviewData ? (
            // ==========================================
            // TELA DE CONFIRMAÇÃO (REVIEW SCREEN)
            // ==========================================
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b' }}>Resumo da Viagem</Text>
                <TouchableOpacity onPress={() => setReviewData(null)} style={{ backgroundColor: '#f1f5f9', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900', color: '#64748b', fontSize: 18 }}>←</Text>
                </TouchableOpacity>
              </View>

              <View style={{ backgroundColor: '#f8fafc', padding: 16, borderRadius: 16, marginBottom: 16 }}>
                <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '700', marginBottom: 4 }}>Destino</Text>
                <Text style={{ color: '#0f172a', fontSize: 18, fontWeight: '900', marginBottom: 12 }}>{reviewData.dest_name}</Text>
                
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 12 }}>
                  <View>
                    <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '700' }}>Distância</Text>
                    <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '900' }}>{(reviewData.distance_meters / 1000).toFixed(1)} km</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: '#64748b', fontSize: 13, fontWeight: '700' }}>Valor Estimado</Text>
                    <Text style={{ color: '#10b981', fontSize: 22, fontWeight: '900' }}>R$ {reviewData.fare}</Text>
                  </View>
                </View>
              </View>

              <Text style={{ color: '#0f172a', fontSize: 16, fontWeight: '800', marginBottom: 12 }}>Forma de Pagamento</Text>
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                <TouchableOpacity 
                  onPress={() => setPaymentMode('PIX')}
                  style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 2, borderColor: paymentMode === 'PIX' ? '#10b981' : '#e2e8f0', backgroundColor: paymentMode === 'PIX' ? '#ecfdf5' : '#fff', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '800', color: paymentMode === 'PIX' ? '#064e3b' : '#64748b' }}>❖ PIX</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => setPaymentMode('Dinheiro')}
                  style={{ flex: 1, padding: 14, borderRadius: 12, borderWidth: 2, borderColor: paymentMode === 'Dinheiro' ? '#10b981' : '#e2e8f0', backgroundColor: paymentMode === 'Dinheiro' ? '#ecfdf5' : '#fff', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '800', color: paymentMode === 'Dinheiro' ? '#064e3b' : '#64748b' }}>💵 Dinheiro</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity onPress={confirmRide} style={{ backgroundColor: '#10b981', paddingVertical: 18, borderRadius: 16, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '900' }}>Confirmar e Pedir BibiMarcos</Text>
              </TouchableOpacity>
            © OpenStreetMap contributors
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function haversineSimple(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
