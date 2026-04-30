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
  Alert,
  Image
} from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import QRCode from 'react-native-qrcode-svg';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
// A URL agora é configurada por variáveis de ambiente ou aponta localmente por padrão
const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL || 'ws://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io/ws';
const HTTP_API_URL = SOCKET_URL.replace('ws://', 'http://').replace('/ws', '');

const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error(error);
    return;
  }
  if (data) {
    const { locations } = data;
    const loc = locations[0];
    if (loc) {
      try {
        await fetch(`${HTTP_API_URL}/api/location/update`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'BibiMarcosApp-Muriae/1.0'
          },
          body: JSON.stringify({
            id_motorista: 1, // Mock
            lat: loc.coords.latitude,
            lng: loc.coords.longitude
          })
        });
      } catch (err) {
        console.error("Erro ao enviar loc no background:", err);
      }
    }
  }
});

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

  // Estados para o Chat
  const [chatVisible, setChatVisible] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const ws = useRef(null);

  const [drivers, setDrivers] = useState([
    // Mock inicial, depois pode vir do /match da sua API
    { id: 1, latitude: -23.5505, longitude: -46.6333 },
    { id: 2, latitude: -23.5525, longitude: -46.6310 }
  ]);
  
  const locationSubscription = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        let { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
        if (fgStatus !== 'granted') {
          Alert.alert('Erro', 'Permissão de localização negada');
          return;
        }

        // NÃO solicite permissão de background aqui no Android 14+! 
        // Isso causa um SecurityException e o app fecha. 
        // A permissão de background só deve ser pedida quando o usuário ativar o modo motorista.

        // Usa getLastKnownPositionAsync primeiro para evitar crash se o GPS estiver buscando sinal
        let currentLoc = await Location.getLastKnownPositionAsync({});
        if (!currentLoc) {
          currentLoc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
        }
        
        if (currentLoc) {
          setLocation({
            latitude: currentLoc.coords.latitude,
            longitude: currentLoc.coords.longitude,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          });
        }
      } catch (error) {
        console.warn("Erro ao obter localização inicial:", error);
      }
    })();

    // Conexão WebSocket Nativa
    ws.current = new WebSocket(SOCKET_URL);
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'chat') {
          setChatMessages(prev => [...prev, data]);
        }
      } catch (err) {}
    };

    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
      ws.current?.close();
    };
  }, []);

  const toggleDriverMode = async () => {
    const newValue = !isDriverOnline;
    setIsDriverOnline(newValue);

    if (newValue) {
      if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
        ws.current = new WebSocket(SOCKET_URL);
      }
      
      // Rastreamento Profissional em Segundo Plano (estilo Uber)
      const { status: fgStatus } = await Location.getForegroundPermissionsAsync();
      let bgStatus = (await Location.getBackgroundPermissionsAsync()).status;

      // No Android 11+, a permissão de background deve ser pedida de forma separada
      if (fgStatus === 'granted' && bgStatus !== 'granted') {
        Alert.alert(
          "Permissão Necessária",
          "Para receber corridas com o app fechado, selecione 'Permitir o tempo todo' na próxima tela.",
          [
            { text: "Cancelar", style: "cancel", onPress: () => setIsDriverOnline(false) },
            { 
              text: "Configurar", 
              onPress: async () => {
                const { status } = await Location.requestBackgroundPermissionsAsync();
                if (status === 'granted') {
                  finishToggleDriverMode();
                } else {
                  setIsDriverOnline(false);
                }
              }
            }
          ]
        );
        return;
      } else if (fgStatus !== 'granted') {
        setIsDriverOnline(false);
        Alert.alert("Aviso de Segurança", "O rastreamento do motorista requer permissão de localização.");
        return;
      }

      finishToggleDriverMode();
    } else {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
      if (locationSubscription.current) {
        locationSubscription.current.remove();
        locationSubscription.current = null;
      }
    }
  };

  const finishToggleDriverMode = async () => {

      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 10,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: "BibiMarcos Ativo",
            notificationBody: "Compartilhando sua localização com os passageiros.",
            notificationColor: "#10b981",
          },
        });
      } catch (error) {
        Alert.alert("Aviso", "Não foi possível iniciar o rastreamento em 2º plano. Verifique as permissões de localização.");
        console.warn("Erro no startLocationUpdatesAsync:", error);
      }

      // Também manter o Foreground para atualizar a UI localmente de forma suave
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
          
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({
              driver_id: 1,
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            }));
          }
        }
      );
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
      // Filtro exclusivo para Muriaé adicionado na query
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${text}, Muriaé, MG, Brasil&format=json&addressdetails=1&limit=5`, {
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
    
    fetchRoute(parseFloat(item.lat), parseFloat(item.lon));
  };

  const sendChatMessage = () => {
    if (chatInput.trim() === '') return;
    const msg = {
      type: 'chat',
      text: chatInput,
      sender: isDriverOnline ? 'motorista' : 'passageiro',
      timestamp: new Date().toISOString()
    };
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(msg));
    } else {
      setChatMessages(prev => [...prev, msg]); // Caso esteja offline
    }
    setChatInput('');
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50">
      {/* Header Elegante BibiMarcos */}
      <View className="bg-emerald-900 p-6 pt-14 flex-row justify-between items-center shadow-2xl border-b-[6px] border-emerald-500 rounded-b-3xl z-10">
        <View>
          <Text className="text-white text-3xl font-extrabold tracking-tighter drop-shadow-md">BibiMarcos</Text>
          <Text className="text-emerald-200 text-xs font-bold uppercase tracking-widest mt-1">Sua cidade. Seu motorista.</Text>
        </View>
        <View className="flex-col items-center bg-emerald-800 p-2 rounded-2xl border border-emerald-600 shadow-inner">
          <Text className="text-white mb-2 text-[10px] font-black uppercase tracking-widest">
            {isDriverOnline ? '🟢 Online' : '⚫ Offline'}
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
            <Marker coordinate={location} title="Local de Partida">
              <View className="bg-emerald-900 border-[3px] border-emerald-400 rounded-full w-12 h-12 justify-center items-center shadow-2xl elevation-10">
                <Text className="text-white text-xl drop-shadow-lg">📍</Text>
              </View>
            </Marker>

            {/* Marcadores dos Motoristas (Renderizando Imagem do Asset local) */}
            {drivers.map(driver => (
              <Marker 
                key={driver.id} 
                coordinate={{ latitude: driver.latitude, longitude: driver.longitude }} 
                title={`Motorista #${driver.id}`}
              >
                {/* Fallback de UI caso o asset não exista no mock de ambiente (car3d.png) */}
                <Image 
                  source={require('./assets/car3d.png')} 
                  style={{ width: 45, height: 45, resizeMode: 'contain' }} 
                  defaultSource={{uri: 'https://cdn-icons-png.flaticon.com/512/3204/3204905.png'}}
                />
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

        {/* Botão de Finalizar Viagem */}
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

        {/* Botão de Chat flutuante */}
        {routeCoordinates.length > 0 && (
          <View className="absolute top-10 right-4">
            <TouchableOpacity
              className="bg-emerald-600 w-14 h-14 rounded-full justify-center items-center shadow-lg border-2 border-white"
              onPress={() => setChatVisible(true)}
            >
              <Text className="text-white text-2xl">💬</Text>
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

      {/* Modal de Chat em Tempo Real */}
      <Modal
        visible={chatVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setChatVisible(false)}
      >
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white rounded-t-3xl h-[60%] border-t-[6px] border-emerald-700 flex-col pb-4">
            <View className="bg-emerald-800 p-5 rounded-t-2xl flex-row justify-between items-center">
              <Text className="text-white font-bold text-lg">Chat da Viagem</Text>
              <TouchableOpacity onPress={() => setChatVisible(false)} className="bg-emerald-700 px-3 py-1 rounded-full">
                <Text className="text-white font-bold">X</Text>
              </TouchableOpacity>
            </View>
            
            <FlatList
              className="flex-1 p-4"
              data={chatMessages}
              keyExtractor={(_, index) => index.toString()}
              renderItem={({ item }) => {
                const isMe = item.sender === (isDriverOnline ? 'motorista' : 'passageiro');
                return (
                  <View className={`mb-3 max-w-[80%] rounded-2xl p-3 shadow-sm ${isMe ? 'bg-emerald-100 self-end rounded-br-sm' : 'bg-slate-200 self-start rounded-bl-sm'}`}>
                    <Text className="text-slate-800 font-medium">{item.text}</Text>
                  </View>
                );
              }}
            />
            
            <View className="p-4 border-t border-slate-200 flex-row items-center">
              <TextInput
                className="flex-1 bg-slate-100 rounded-full px-5 py-3 mr-3 border border-slate-300 text-slate-800 text-base"
                placeholder="Escreva sua mensagem..."
                value={chatInput}
                onChangeText={setChatInput}
              />
              <TouchableOpacity 
                className="bg-emerald-600 w-12 h-12 rounded-full justify-center items-center shadow-md"
                onPress={sendChatMessage}
              >
                <Text className="text-white font-extrabold text-lg">›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
