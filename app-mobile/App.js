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
import { WebView } from 'react-native-webview';
import QRCode from 'react-native-qrcode-svg';
import { Audio } from 'expo-av';
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
  const [pickupLocation, setPickupLocation] = useState(null);
  
  // Variáveis para Pagamento Direto ao Motorista (100% repasse)
  const motoristaPix = "123.456.789-00"; // Chave Pix mockada
  const [valorCorrida, setValorCorrida] = useState("0.00");
  
  // Estados para a busca de destino (OpenStreetMap)
  const [destinationQuery, setDestinationQuery] = useState('');
  const [destinationResults, setDestinationResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);

  // Estados para o Chat
  const [chatVisible, setChatVisible] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const ws = useRef(null);
  const webViewRef = useRef(null);

  const [drivers, setDrivers] = useState([
    // Mock inicial, depois pode vir do /match da sua API
    { id: 1, latitude: -23.5505, longitude: -46.6333 },
    { id: 2, latitude: -23.5525, longitude: -46.6310 }
  ]);
  
  const locationSubscription = useRef(null);

  useEffect(() => {
    // Tocar Som de Partida de Carro
    const playEngineSound = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: 'https://cdn.pixabay.com/download/audio/2021/08/04/audio_3d1e67eeef.mp3?filename=car-engine-starting-43639.mp3' },
          { shouldPlay: true }
        );
        // O som tocará automaticamente.
        await sound.playAsync();
      } catch (err) {
        console.warn("Erro ao tocar o som da engine:", err);
      }
    };
    playEngineSound();

    (async () => {
      try {
        let { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
        if (fgStatus !== 'granted') {
          Alert.alert('Erro', 'Permissão de localização negada');
          // Fallback para não travar o app em tela de carregamento
          setLocation({ latitude: -21.1306, longitude: -42.3642, latitudeDelta: 0.05, longitudeDelta: 0.05 });
          return;
        }

        // 1. Tenta a última posição conhecida (Rápido e não consome bateria)
        let currentLoc = await Location.getLastKnownPositionAsync({
          maxAge: 60000 // Aceita cache de até 1 minuto
        });

        // 2. Se não tiver cache, pede a posição com precisão BAIXA para ser rápido e não travar o Android (ANR)
        if (!currentLoc) {
          // Timeout de 8 segundos para não deixar o app pendurado esperando satélite
          const locationPromise = Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low, // Low usa Wi-Fi e Antenas (rápido), High usa GPS (lento e pode travar)
          });
          
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('GPS_TIMEOUT')), 8000)
          );

          currentLoc = await Promise.race([locationPromise, timeoutPromise]);
        }
        
        if (currentLoc) {
          const locObj = {
            latitude: currentLoc.coords.latitude,
            longitude: currentLoc.coords.longitude,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          };
          setLocation(locObj);
          setPickupLocation(locObj);
        }
      } catch (error) {
        console.warn("Erro ao obter localização inicial (timeout ou falha):", error);
        Alert.alert("Aviso de GPS", "Não foi possível obter sua localização exata rapidamente. Usando localização padrão.");
        const fallbackLoc = {
          latitude: -21.1306,
          longitude: -42.3642,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        };
        setLocation(fallbackLoc);
        setPickupLocation(fallbackLoc);
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

  // Algoritmo de Precificação Justa (Motorista não paga taxa)
  // Baseado na Gasolina a R$ 7.00/litro e rendimento médio de 10km/l na cidade
  const calculateFare = (distanceInMeters) => {
    const distanceInKm = distanceInMeters / 1000;
    
    // Parâmetros Fixos
    const baseFare = 5.00; // Bandeirada (Taxa mínima de acionamento)
    const ratePerKm = 2.20; // R$ 0.70 de custo de combustível + R$ 1.50 de tempo/lucro por KM
    const minFare = 8.00; // A corrida nunca custará menos que isso

    let rawPrice = baseFare + (distanceInKm * ratePerKm);

    // Variáveis de Tempo Real
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay(); // 0 = Domingo, 6 = Sábado
    
    let multiplier = 1.0; // Horário comercial normal
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Regras de Tarifa Dinâmica / Bandeiras
    if (hour >= 0 && hour < 6) {
      // Madrugada: Bandeira 3 (+50% de risco/demanda)
      multiplier = 1.5;
    } else if (hour >= 20 && hour <= 23) {
      // Noite: Bandeira 2 (+20% ou +30% se for fds)
      multiplier = isWeekend ? 1.3 : 1.2;
    } else if (isWeekend) {
      // Fim de semana de dia (+20%)
      multiplier = 1.2;
    }

    let finalPrice = rawPrice * multiplier;

    // Garante que viagens muito curtas paguem o mínimo viável
    if (finalPrice < minFare) {
      finalPrice = minFare;
    }
    
    return finalPrice.toFixed(2);
  };

  const fetchRoute = async (destLat, destLon) => {
    // Usa a localização do pino móvel (pickupLocation) como partida, ou o GPS nativo
    const startLocation = pickupLocation || location;
    if (!startLocation) return;

    try {
      const startLon = startLocation.longitude;
      const startLat = startLocation.latitude;
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
        
        // Calcular e definir o preço exato com base na distância da rota
        const distanceMeters = data.routes[0].distance; // OSRM fornece em metros
        setValorCorrida(calculateFare(distanceMeters));
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

  const onMapMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'location_changed') {
        setPickupLocation({ latitude: data.lat, longitude: data.lng });
      }
    } catch(e) {}
  };

  const recenterMap = () => {
    if (location && webViewRef.current) {
      // Injeta JavaScript para mover o mapa de volta para o GPS real do celular
      const script = `map.flyTo([${location.latitude}, ${location.longitude}], 16, { animate: true, duration: 0.5 }); true;`;
      webViewRef.current.injectJavaScript(script);
      setPickupLocation(location);
    }
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

      {/* Área do Mapa - Usando Leaflet com Simulação Uber */}
      <View className="flex-1 relative bg-slate-200">
        {location ? (
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            onMessage={onMapMessage}
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                  <style>
                    body { padding: 0; margin: 0; background-color: #e2e8f0; }
                    html, body, #map { height: 100%; width: 100%; }
                    
                    /* Pino móvel simulando Uber */
                    .center-marker {
                      position: absolute;
                      top: 50%;
                      left: 50%;
                      transform: translate(-50%, -100%);
                      font-size: 45px;
                      z-index: 1000;
                      pointer-events: none;
                      text-shadow: 0 4px 10px rgba(0,0,0,0.5);
                      transition: transform 0.2s ease-out;
                    }
                    .center-marker.moving {
                      transform: translate(-50%, -120%);
                    }

                    /* Balãozinho do Pino */
                    .pickup-label {
                      position: absolute;
                      top: calc(50% - 60px);
                      left: 50%;
                      transform: translateX(-50%);
                      background: #064e3b;
                      color: white;
                      padding: 6px 14px;
                      border-radius: 20px;
                      font-family: sans-serif;
                      font-weight: bold;
                      font-size: 14px;
                      z-index: 1000;
                      pointer-events: none;
                      white-space: nowrap;
                      box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                      transition: opacity 0.2s;
                    }
                    .center-marker.moving + .pickup-label {
                      opacity: 0;
                    }
                    
                    /* Oculta o Leaflet logo */
                    .leaflet-control-container .leaflet-bottom.leaflet-right { display: none; }
                  </style>
                </head>
                <body>
                  <div id="map"></div>
                  <!-- O pino fica flutuando exatamente no centro -->
                  <div id="centerMarker" class="center-marker">📍</div>
                  <div class="pickup-label">Local de Embarque</div>

                  <script>
                    var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${location.latitude}, ${location.longitude}], 16);
                    L.tileLayer('https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

                    // Eventos do mapa para fazer o pino "pular" (efeito Uber) e reportar a nova coordenada
                    var markerEl = document.getElementById('centerMarker');
                    var labelEl = document.querySelector('.pickup-label');
                    
                    map.on('movestart', function() { 
                      markerEl.classList.add('moving'); 
                    });
                    
                    map.on('moveend', function() { 
                      markerEl.classList.remove('moving');
                      var center = map.getCenter();
                      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'location_changed', lat: center.lat, lng: center.lng }));
                    });

                    // Desenhando a Rota se existir
                    var routePoints = ${JSON.stringify(routeCoordinates.map(c => [c.latitude, c.longitude]))};
                    if (routePoints.length > 0) {
                      var polyline = L.polyline(routePoints, {color: '#10b981', weight: 6, lineCap: 'round'}).addTo(map);
                      map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
                      
                      // Esconde o pino móvel durante a corrida
                      markerEl.style.display = 'none';
                      labelEl.style.display = 'none';
                      
                      // Marca o ponto exato de partida escolhido pelo usuário
                      var pickupIcon = L.divIcon({
                        className: '',
                        html: '<div style="background-color: #064e3b; border: 3px solid #34d399; border-radius: 50%; width: 24px; height: 24px; box-shadow: 0 4px 6px rgba(0,0,0,0.5);"></div>',
                        iconSize: [24, 24],
                        iconAnchor: [12, 12]
                      });
                      L.marker(routePoints[0], {icon: pickupIcon}).addTo(map);
                    }

                    // Simulador Avançado de Carros (Apresentação do App)
                    // Usando DivIcon puro garantido para não depender de imagens externas (evita erros 403 Forbidden)
                    var carIcon = L.divIcon({
                      className: 'custom-car-marker',
                      html: '<div style="background-color: #10b981; border: 2px solid white; border-radius: 8px; width: 34px; height: 34px; display: flex; justify-content: center; align-items: center; box-shadow: 0 3px 6px rgba(0,0,0,0.4); font-size: 20px;">🚘</div>',
                      iconSize: [34, 34],
                      iconAnchor: [17, 17]
                    });
                    
                    var drivers = ${JSON.stringify(drivers)};
                    var driverMarkers = drivers.map(function(driver) {
                      // Atribui uma direção e velocidade fixa para cada carro
                      return {
                        marker: L.marker([driver.latitude, driver.longitude], {icon: carIcon}).addTo(map),
                        latSpeed: (Math.random() - 0.5) * 0.00005, // Menos tremor, mais direção
                        lngSpeed: (Math.random() - 0.5) * 0.00005
                      };
                    });

                    // Animação fluida dos carrinhos (30 FPS simulados)
                    setInterval(function() {
                      driverMarkers.forEach(function(d) {
                        var pos = d.marker.getLatLng();
                        var newLat = pos.lat + d.latSpeed;
                        var newLng = pos.lng + d.lngSpeed;
                        
                        // Fazer o carro virar se distanciar muito do centro
                        if (Math.abs(newLat - ${location.latitude}) > 0.01) d.latSpeed *= -1;
                        if (Math.abs(newLng - ${location.longitude}) > 0.01) d.lngSpeed *= -1;
                        
                        d.marker.setLatLng([newLat, newLng]);
                      });
                    }, 50);
                  </script>
                </body>
                </html>
              `
            }}
            className="flex-1"
          />
        ) : (
          <View className="flex-1 justify-center items-center">
            <ActivityIndicator size="large" color="#047857" />
            <Text className="mt-4 text-emerald-800 font-bold uppercase">Acessando GPS...</Text>
          </View>
        )}

        {/* Painel Inferior Estilo Uber */}
        {!isDriverOnline && (
          <View className="absolute bottom-0 w-full bg-white rounded-t-[30px] pt-6 pb-10 px-6 shadow-[0_-10px_40px_rgba(0,0,0,0.15)] elevation-20">
            {routeCoordinates.length === 0 ? (
              <>
                <Text className="text-2xl font-black text-slate-800 mb-4 tracking-tight">Para onde vamos?</Text>
                <TouchableOpacity 
                  className="bg-slate-100 flex-row items-center p-4 rounded-2xl border border-slate-200 active:bg-slate-200"
                  onPress={() => setDestinationModalVisible(true)}
                >
                  <View className="bg-emerald-100 p-2 rounded-full mr-3">
                    <Text className="text-xl">🔍</Text>
                  </View>
                  <Text className="text-slate-500 font-bold text-lg flex-1">Buscar destino...</Text>
                </TouchableOpacity>
              </>
            ) : (
               <TouchableOpacity
                className="bg-yellow-500 py-4 rounded-xl shadow-xl elevation-5 flex-row justify-center items-center"
                onPress={() => {
                  setRouteCoordinates([]);
                  setRideSummaryVisible(true);
                }}
              >
                <Text className="text-emerald-900 text-xl font-bold text-center uppercase tracking-widest mr-2">
                  Finalizar Viagem
                </Text>
                <Text className="text-2xl">🏁</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Botão Centralizar GPS */}
        {!isDriverOnline && routeCoordinates.length === 0 && (
          <View className="absolute bottom-[160px] right-4">
            <TouchableOpacity
              className="bg-white w-12 h-12 rounded-full justify-center items-center shadow-lg border border-slate-200 elevation-5"
              onPress={recenterMap}
            >
              <Text className="text-emerald-700 text-2xl">🎯</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Botão de Chat flutuante (Sempre visível para Demo) */}
        <View className={`absolute right-4 ${isDriverOnline ? 'bottom-10' : 'bottom-48'}`}>
          <TouchableOpacity
            className="bg-emerald-800 w-16 h-16 rounded-full justify-center items-center shadow-2xl elevation-10 border-4 border-white"
            onPress={() => setChatVisible(true)}
          >
            <Text className="text-white text-3xl drop-shadow-md">💬</Text>
            {chatMessages.length > 0 && (
              <View className="absolute -top-1 -right-1 bg-red-500 w-6 h-6 rounded-full justify-center items-center border-2 border-white">
                <Text className="text-white text-xs font-black">{chatMessages.length}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
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
              <Text className="text-emerald-700 text-sm font-bold uppercase mb-1">Valor Total a Pagar</Text>
              <Text className="text-4xl font-extrabold text-emerald-900">R$ {valorCorrida}</Text>
              <Text className="text-emerald-600 text-[10px] mt-1 font-bold uppercase tracking-wider">100% do valor vai para o motorista</Text>
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
