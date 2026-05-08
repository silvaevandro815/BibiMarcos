import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  FlatList, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const UA = 'BibiMarcos/3.0 (contato@bibimarcos.app)';

const MURIAE_CATALOG = [
  { name: 'Bairro União, Muriaé - MG', lat: '-21.1244', lon: '-42.3853' },
  { name: 'Centro, Muriaé - MG', lat: '-21.1308', lon: '-42.3658' },
  { name: 'Barra, Muriaé - MG', lat: '-21.1399', lon: '-42.3663' },
  { name: 'Dornelas, Muriaé - MG', lat: '-21.1154', lon: '-42.3705' },
  { name: 'Safira, Muriaé - MG', lat: '-21.1265', lon: '-42.3551' },
  { name: 'Porto, Muriaé - MG', lat: '-21.1390', lon: '-42.3560' },
  { name: 'Aeroporto, Muriaé - MG', lat: '-21.1500', lon: '-42.3500' },
  { name: 'São Francisco, Muriaé - MG', lat: '-21.1330', lon: '-42.3600' },
  { name: 'Santa Terezinha, Muriaé - MG', lat: '-21.1450', lon: '-42.3600' },
  { name: 'Planalto, Muriaé - MG', lat: '-21.1200', lon: '-42.3650' },
  { name: 'Joanópolis, Muriaé - MG', lat: '-21.1400', lon: '-42.3800' },
  { name: 'São Joaquim, Muriaé - MG', lat: '-21.1300', lon: '-42.3850' },
  { name: 'Gaspar, Muriaé - MG', lat: '-21.1250', lon: '-42.3450' },
  { name: 'Augusto de Abreu, Muriaé - MG', lat: '-21.1100', lon: '-42.3750' },
  { name: 'Belisário (Distrito), Muriaé - MG', lat: '-20.8931', lon: '-42.2743' },
  { name: 'Boa Família (Distrito), Muriaé - MG', lat: '-21.1895', lon: '-42.2856' },
  { name: 'Bom Jesus da Cachoeira (Distrito), Muriaé - MG', lat: '-21.2405', lon: '-42.3021' },
  { name: 'Itamuri (Distrito), Muriaé - MG', lat: '-21.0335', lon: '-42.3650' },
  { name: 'Macuco (Distrito), Muriaé - MG', lat: '-21.0900', lon: '-42.2500' },
  { name: 'Pirapanema (Distrito), Muriaé - MG', lat: '-21.0505', lon: '-42.4350' },
  { name: 'Vermelho (Distrito), Muriaé - MG', lat: '-21.1180', lon: '-42.3050' },
  { name: 'Retiro, Muriaé - MG', lat: '-21.0800', lon: '-42.3200' },
  { name: 'Capetinga, Muriaé - MG', lat: '-21.0600', lon: '-42.3000' },
  { name: 'São João do Glória, Muriaé - MG', lat: '-21.1000', lon: '-42.4000' },
  { name: 'Cardoso de Melo, Muriaé - MG', lat: '-21.1450', lon: '-42.3450' },
  { name: 'Cerâmica, Muriaé - MG', lat: '-21.1400', lon: '-42.3700' },
  { name: 'Inconfidência, Muriaé - MG', lat: '-21.1250', lon: '-42.3600' },
  { name: 'João XXIII, Muriaé - MG', lat: '-21.1200', lon: '-42.3550' },
  { name: 'Padre Tiago / Marambaia, Muriaé - MG', lat: '-21.1150', lon: '-42.3500' },
  { name: 'Santana, Muriaé - MG', lat: '-21.1350', lon: '-42.3450' },
  { name: 'Napoleão, Muriaé - MG', lat: '-21.1100', lon: '-42.3600' },
  { name: 'José Cirilo, Muriaé - MG', lat: '-21.1180', lon: '-42.3650' },
  { name: 'Encoberta, Muriaé - MG', lat: '-21.1450', lon: '-42.3650' },
  { name: 'Primavera, Muriaé - MG', lat: '-21.1300', lon: '-42.3500' },
  { name: 'Santo Antônio, Muriaé - MG', lat: '-21.1350', lon: '-42.3600' },
  { name: 'Bico Doce, Muriaé - MG', lat: '-21.1380', lon: '-42.3620' },
  { name: 'Alterosa, Muriaé - MG', lat: '-21.1250', lon: '-42.3800' },
  { name: 'Alto do Castelo, Muriaé - MG', lat: '-21.1280', lon: '-42.3680' },
  { name: 'Boa Esperança, Muriaé - MG', lat: '-21.1400', lon: '-42.3500' },
  { name: 'Boa Vista, Muriaé - MG', lat: '-21.1350', lon: '-42.3550' },
  { name: 'Bom Pastor, Muriaé - MG', lat: '-21.1450', lon: '-42.3400' },
  { name: 'Chácara da Gávea, Muriaé - MG', lat: '-21.1200', lon: '-42.3400' },
  { name: 'Chácara Doutor Brum, Muriaé - MG', lat: '-21.1150', lon: '-42.3450' },
  { name: 'Chácara Leblom, Muriaé - MG', lat: '-21.1100', lon: '-42.3500' },
  { name: 'Chalé, Muriaé - MG', lat: '-21.1050', lon: '-42.3550' },
  { name: 'Colety, Muriaé - MG', lat: '-21.1300', lon: '-42.3700' },
  { name: 'Coronel Izalino, Muriaé - MG', lat: '-21.1350', lon: '-42.3750' },
  { name: 'Distrito Industrial, Muriaé - MG', lat: '-21.1550', lon: '-42.3300' }
];

const normalize = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export async function geocodeAddress(query) {
  const normQuery = normalize(query);
  
  // Lista dos distritos e povoados conhecidos de Muriaé
  const distritos = ['belisário', 'belisario', 'boa família', 'boa familia', 'bom jesus', 'itamuri', 'pirapanema', 'vermelho', 'macuco', 'retiro', 'capetinga', 'são joão do glória', 'sao joao do gloria'];
  
  // 1. Busca no Catálogo Blindado
  let localResults = [];
  if (normQuery.length > 2) {
    const localMatches = MURIAE_CATALOG.filter(c => 
      normalize(c.name).includes(normQuery) || 
      normQuery.includes(normalize(c.name).split(',')[0].trim())
    );
    localResults = localMatches.map(m => ({
      display_name: m.name,
      lat: m.lat,
      lon: m.lon,
      isLocal: true // flag opcional para debug
    }));
  }

  // 2. Continua para a API do Nominatim
  const qLower = query.toLowerCase();
  const hasMuriae = qLower.includes('muria');
  const isDistrito = distritos.some(d => qLower.includes(d));

  let queryStr = query;
  if (!hasMuriae) {
    queryStr = isDistrito ? `${query}, Muriaé - MG` : `${query}, Muriaé - MG`;
  }

  const url = `${NOMINATIM_URL}/search?format=jsonv2&q=${encodeURIComponent(queryStr)}&limit=5&countrycodes=br&viewbox=-42.70,-20.80,-42.00,-21.40&bounded=1`;
  
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const apiData = await r.json();
    
    // Mescla os resultados: Catálogo Blindado primeiro, depois a API externa
    // Filtra duplicatas grosseiras (mesmo display_name ou mto perto)
    const combined = [...localResults];
    for (const item of apiData) {
      if (!combined.find(c => c.display_name === item.display_name)) {
        combined.push(item);
      }
    }
    return combined;
  } catch (e) {
    console.log("Falha no Nominatim, retornando apenas catálogo local", e);
    return localResults;
  }
}

export async function reverseGeocode(lat, lng) {
  const url = `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const d = await r.json();
  return d.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

async function getRoute(lat1, lng1, lat2, lng2) {
  const url = `${OSRM_URL}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
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
            </View>
          ) : (
            // ==========================================
            // TELA DE BUSCA (SEARCH SCREEN)
            // ==========================================
            <View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b' }}>📍 Para onde vamos?</Text>
                <TouchableOpacity onPress={onClose} style={{ backgroundColor: '#f1f5f9', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontWeight: '900', color: '#64748b', fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Digite a rua ou bairro em Muriaé..."
                  placeholderTextColor="#94a3b8"
                  onSubmitEditing={search}
                  returnKeyType="search"
                  style={{ flex: 1, backgroundColor: '#f8fafc', borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, fontSize: 15, color: '#1e293b' }}
                />
                <TouchableOpacity onPress={search} style={{ backgroundColor: '#064e3b', borderRadius: 14, paddingHorizontal: 18, justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>🔍</Text>
                </TouchableOpacity>
              </View>

              {loading && <ActivityIndicator color="#064e3b" style={{ marginVertical: 16 }} />}

              <FlatList
                data={results}
                keyExtractor={(_, i) => i.toString()}
                ListEmptyComponent={!loading ? <Text style={{ color: '#94a3b8', textAlign: 'center', marginTop: 16 }}>Pesquise um endereço acima</Text> : null}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    onPress={() => selectDest(item)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}
                  >
                    <Text style={{ fontSize: 22, marginRight: 12 }}>
                      {item.type === 'residential' ? '🏠' : item.type === 'commercial' ? '🏢' : '📍'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: '700', color: '#1e293b', fontSize: 14 }} numberOfLines={1}>
                        {item.display_name.split(',')[0]}
                      </Text>
                      <Text style={{ color: '#64748b', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                        {item.display_name.split(',').slice(1, 3).join(',')}
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
                style={{ maxHeight: 300 }}
              />
            </View>
          )}

          <Text style={{ color: '#cbd5e1', textAlign: 'center', marginTop: 12, fontSize: 10 }}>
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
