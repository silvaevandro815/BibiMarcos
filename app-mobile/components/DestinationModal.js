import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Modal,
  FlatList, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';
const UA = 'BibiMarcos/3.0 (contato@bibimarcos.app)';

export async function geocodeAddress(query) {
  const queryStr = query.toLowerCase().includes('muria') ? query : `${query}, Muriaé - MG`;
  const url = `${NOMINATIM_URL}/search?format=jsonv2&q=${encodeURIComponent(queryStr)}&limit=5&countrycodes=br`;
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
      onConfirm({
        dest_lat: destLat,
        dest_lng: destLng,
        dest_name: item.display_name.split(',').slice(0, 2).join(',').trim(),
        distance_meters: route ? route.distance_meters : haversineSimple(origin.latitude, origin.longitude, destLat, destLng),
        geometry: route ? route.geometry : null,
      });
      setQuery('');
      setResults([]);
    } catch (e) {
      alert('Erro ao calcular rota. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, maxHeight: '85%' }}>
          {/* Header */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: '#064e3b' }}>📍 Para onde vamos?</Text>
            <TouchableOpacity onPress={onClose} style={{ backgroundColor: '#f1f5f9', width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ fontWeight: '900', color: '#64748b', fontSize: 18 }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Busca */}
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
                  <Text style={{ color: '#94a3b8', fontSize: 12 }} numberOfLines={1}>
                    {item.display_name.split(',').slice(1, 3).join(',').trim()}
                  </Text>
                </View>
                <Text style={{ color: '#064e3b', fontWeight: '700', fontSize: 13 }}>›</Text>
              </TouchableOpacity>
            )}
          />

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
