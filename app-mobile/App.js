import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  Switch, 
  Modal, 
  TextInput, 
  TouchableOpacity, 
  SafeAreaView, 
  ActivityIndicator, 
  FlatList,
  Alert
} from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import QRCode from 'react-native-qrcode-svg';
import * as Location from 'expo-location';
import io from 'socket.io-client';

// A URL agora é configurada por variáveis de ambiente ou aponta localmente por padrão
const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL || 'ws://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io/ws';
const socket = io(SOCKET_URL, { autoConnect: false });

export default function App() {
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [location, setLocation] = useState(null);
  const [destinationModalVisible, setDestinationModalVisible] = useState(false);
  const [rideSummaryVisible, setRideSummaryVisible] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  
  // Dummy data para o PIX do Motorista
  const motoristaPix = "123.456.789-00";
  const valorCorrida = "25.50";
  
  // Estados para a busca de destino (OpenStreetMap)
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationResults, setDestinationResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  const [drivers, setDrivers] = useState([
    // Mock inicial, depois pode vir do /match da sua API
    { id: 1, latitude: -23.5505, longitude: -46.6333 },
    { id: 2, latitude: -23.5525, longitude: -46.6310 }
  ]);
  
  const locationSubscription = useRef(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Erro', 'Permissão de localização negada');
        return;
      }

      let currentLoc = await Location.getCurrentPositionAsync({});
      setLocation({
        latitude: currentLoc.coords.latitude,
        longitude: currentLoc.coords.longitude,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      });
    })();

    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      socket.disconnect();
    };
  }, []);

  const toggleDriverMode = async () => {
    const newValue = !isDriverOnline;
    setIsDriverOnline(newValue);

    if (newValue) {
      socket.connect();
      
      // Captura localização e envia pro Socket a cada 5s
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
        },
        (loc) => {
          const newCoord = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          };
          setLocation(newCoord);
          
          socket.emit('update_location', {
            driver_id: 1, // Exemplo
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      );
    } else {
      socket.disconnect();
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
    }
  };

  // Alternativa gratuita usando Nominatim (OpenStreetMap)
  const searchDestination = async (text) => {
    setDestinationQuery(text);
    if (text.length < 3) {
      setDestinationResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${text}&format=json&addressdetails=1&limit=5`, {
        headers: { 'User-Agent': 'BibiMarcosApp-Muriae/1.0' }
      });
      const data = await response.json();
      setDestinationResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const fetchRoute = async (destLat, destLon) => {
    if (!location) return;
    try {
      const startLon = location.longitude;
      const startLat = location.latitude;
      const url = `http://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${destLon},${destLat}?overview=full&geometries=geojson`;
      
      const response = await fetch(url, {
        headers: { 'User-Agent': 'BibiMarcosApp-Muriae/1.0' }
      });
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        // OSRM retorna coordenadas no formato [longitude, latitude]
        const coords = data.routes[0].geometry.coordinates.map(c => ({
          latitude: c[1],
          longitude: c[0]
        }));
        setRouteCoordinates(coords);
      }
    } catch (err) {
      console.error("Erro ao buscar rota OSRM", err);
    }
  };

  const selectDestination = (item) => {
    setDestinationModalVisible(false);
    setDestinationQuery('');
    Alert.alert('Viagem solicitada', `Traçando rota para:\n${item.display_name}`);
    
    // A API Nominatim retorna lat e lon como strings
    fetchRoute(parseFloat(item.lat), parseFloat(item.lon));
    
    // Aqui você chamaria o fetch para sua rota POST /match
    // com a sua location atual e atualizaria os 'drivers' do mapa
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* Header Estilo Governamental (Verde e Amarelo discreto) */}
      <View className="bg-emerald-800 p-5 pt-12 flex-row justify-between items-center shadow-lg border-b-4 border-yellow-400">
        <View>
          <Text className="text-white text-2xl font-bold tracking-tight">GovTransporte</Text>
          <Text className="text-emerald-100 text-xs font-medium uppercase tracking-wider">Mobilidade Urbana</Text>
        </View>
        <View className="flex-col items-center">
          <Text className="text-white mb-1 text-xs font-bold uppercase tracking-wider">
            {isDriverOnline ? 'Online' : 'Offline'}
          </Text>
          <Switch
            value={isDriverOnline}
            onValueChange={toggleDriverMode}
            trackColor={{ false: '#475569', true: '#facc15' }}
            thumbColor={isDriverOnline ? '#ffffff' : '#cbd5e1'}
          />
        </View>
      </View>

      {/* Área do Mapa */}
      <View className="flex-1 relative bg-slate-200">
        {location ? (
          <MapView
            className="flex-1"
            initialRegion={location}
            region={location}
            showsUserLocation={false} 
            mapType="none" // Desativa os mapas base nativos para usar apenas o OpenStreetMap
          >
            {/* Camada de Mapas base CartoDB (Voyager) */}
            <UrlTile
              urlTemplate="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
              maximumZ={19}
              flipY={false}
              userAgent="BibiMarcosApp-Muriae/1.0"
            />

            {/* Linha da rota traçada pelo OSRM */}
            {routeCoordinates.length > 0 && (
              <Polyline
                coordinates={routeCoordinates}
                strokeColor="#10b981" // Verde do Governo (emerald-500)
                strokeWidth={5}
                lineDashPattern={[0]} // Para algumas plataformas manter sólido
              />
            )}
            {/* Marcador do Passageiro/Usuário atual */}
            <Marker coordinate={location} title="Sua posição">
              <View className="bg-blue-600 border-2 border-white rounded-full w-5 h-5 shadow-lg" />
            </Marker>

            {/* Marcadores dos Motoristas (Carrinhos) */}
            {drivers.map(driver => (
              <Marker 
                key={driver.id} 
                coordinate={{ latitude: driver.latitude, longitude: driver.longitude }} 
                title={`Motorista #${driver.id}`}
              >
                <View className="bg-emerald-600 p-1.5 rounded-lg border-2 border-yellow-400 shadow-md">
                  <Text className="text-white text-xs">🚕</Text>
                </View>
              </Marker>
            ))}
          </MapView>
        ) : (
          <View className="flex-1 justify-center items-center">
            <ActivityIndicator size="large" color="#047857" />
            <Text className="mt-4 text-emerald-800 font-bold uppercase">Acessando GPS...</Text>
          </View>
        )}

        {/* Botão Flutuante do Passageiro */}
        {!isDriverOnline && (
          <View className="absolute bottom-10 left-6 right-6">
            <TouchableOpacity
              className="bg-emerald-700 py-4 rounded-xl shadow-xl border border-emerald-600 elevation-5"
              onPress={() => setDestinationModalVisible(true)}
            >
              <Text className="text-white text-lg font-bold text-center uppercase tracking-widest">
                Solicitar Viagem
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Botão de Finalizar Viagem (Apenas visível para demonstração quando há rota ativa) */}
        {routeCoordinates.length > 0 && !isDriverOnline && (
          <View className="absolute bottom-28 left-6 right-6">
            <TouchableOpacity
              className="bg-yellow-500 py-4 rounded-xl shadow-xl border border-yellow-600 elevation-5"
              onPress={() => {
                setRouteCoordinates([]);
                setRideSummaryVisible(true);
              }}
            >
              <Text className="text-emerald-900 text-lg font-bold text-center uppercase tracking-widest">
                Finalizar Viagem
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Modal de Solicitação (Busca de Destino) */}
      <Modal
        visible={destinationModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setDestinationModalVisible(false)}
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-white rounded-t-3xl shadow-2xl h-[80%] border-t-[6px] border-emerald-700">
            <View className="p-6">
              <View className="w-12 h-1.5 bg-slate-300 rounded-full self-center mb-6" />
              <Text className="text-2xl font-extrabold text-slate-800 mb-2">Para onde?</Text>
              <Text className="text-sm text-slate-500 mb-6">Informe o destino para encontrar motoristas do governo próximos a você.</Text>
              
              <View className="bg-slate-100 rounded-xl p-1 mb-4 border border-slate-300 flex-row items-center">
                <Text className="pl-3 pr-2 text-xl">📍</Text>
                <TextInput
                  className="flex-1 text-base text-slate-800 p-3"
                  placeholder="Ex: Praça da Sé, São Paulo"
                  placeholderTextColor="#94a3b8"
                  value={destinationQuery}
                  onChangeText={searchDestination}
                  autoFocus
                />
                {isSearching && <ActivityIndicator className="pr-3" color="#047857" />}
              </View>

              <FlatList
                data={destinationResults}
                keyExtractor={(item) => item.place_id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    className="py-4 border-b border-slate-100 flex-row items-center"
                    onPress={() => selectDestination(item)}
                  >
                    <Text className="text-slate-400 mr-3 text-lg">🏢</Text>
                    <Text className="text-slate-700 text-sm flex-1">{item.display_name}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={() => (
                  destinationQuery.length >= 3 && !isSearching ? 
                  <Text className="text-slate-400 text-center mt-4">Nenhum resultado encontrado.</Text> : null
                )}
              />

              <TouchableOpacity 
                className="mt-4 bg-slate-200 py-4 rounded-xl"
                onPress={() => setDestinationModalVisible(false)}
              >
                <Text className="text-center text-slate-700 font-bold text-lg uppercase">Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de Resumo da Corrida e Pagamento PIX */}
      <Modal
        visible={rideSummaryVisible}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setRideSummaryVisible(false)}
      >
        <View className="flex-1 justify-center items-center bg-black/70 p-6">
          <View className="bg-white rounded-2xl w-full p-6 shadow-2xl items-center border-4 border-emerald-700">
            <Text className="text-2xl font-extrabold text-emerald-800 mb-2 uppercase tracking-wide">Corrida Finalizada</Text>
            <Text className="text-slate-500 mb-6 text-center">Pague diretamente ao motorista. Taxa Zero para o governo.</Text>

            <View className="bg-emerald-50 rounded-xl p-4 w-full items-center mb-6 border border-emerald-200">
              <Text className="text-emerald-700 text-sm font-bold uppercase mb-1">Valor Total</Text>
              <Text className="text-4xl font-extrabold text-emerald-900">R$ {valorCorrida}</Text>
            </View>

            <View className="bg-white p-2 rounded-xl shadow-sm border border-slate-200 mb-6">
              {/* O formato BR.GOV.BCB.PIX é gerado aqui de forma simplificada para o mock */}
              <QRCode
                value={`00020126360014br.gov.bcb.pix0114${motoristaPix}5204000053039865405${valorCorrida}5802BR5909Motorista6008S. Paulo62070503***6304`}
                size={180}
                color="#064e3b"
                backgroundColor="white"
              />
            </View>

            <Text className="text-slate-600 font-bold mb-2">Chave PIX (CPF):</Text>
            <View className="bg-slate-100 p-3 rounded-lg w-full flex-row justify-between items-center mb-6">
              <Text className="text-slate-800 font-medium text-lg tracking-wider">{motoristaPix}</Text>
              <TouchableOpacity 
                className="bg-emerald-600 px-3 py-2 rounded-md"
                onPress={() => Alert.alert('Sucesso', 'Chave PIX copiada para a área de transferência!')}
              >
                <Text className="text-white font-bold text-xs uppercase">Copiar</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              className="bg-slate-200 py-3 px-8 rounded-xl w-full"
              onPress={() => setRideSummaryVisible(false)}
            >
              <Text className="text-center text-slate-700 font-bold text-lg uppercase">Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
