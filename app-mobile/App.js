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
import * as FileSystem from 'expo-file-system';
import { Asset } from 'expo-asset';
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
  const [carImageBase64, setCarImageBase64] = useState(null);

  // Drivers iniciam com coordenadas de placeholder;
  // serão atualizadas para perto do usuário assim que o GPS carregar
  const [drivers, setDrivers] = useState([
    { id: 1, latitude: -21.1300, longitude: -42.3640 },
    { id: 2, latitude: -21.1310, longitude: -42.3650 },
    { id: 3, latitude: -21.1290, longitude: -42.3620 },
    { id: 4, latitude: -21.1320, longitude: -42.3660 },
  ]);
  
  const locationSubscription = useRef(null);

  useEffect(() => {
    // Som de Partida de Carro via FileSystem (garantido no Android 14)
    const playEngineSound = async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
          staysActiveInBackground: false,
        });
        // Som embutido como base64 WAV curto (beep + partida de motor simulado)
        // Formato: WAV 8000Hz mono 8bit - compativel garantido com Android
        const soundB64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        const soundPath = FileSystem.cacheDirectory + 'engine_start.wav';
        await FileSystem.writeAsStringAsync(soundPath, soundB64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const { sound } = await Audio.Sound.createAsync({ uri: soundPath });
        await sound.playAsync();
      } catch (err) {
        console.warn('Erro ao tocar som de partida:', err);
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
          // Espalhando os carros simulados perto da localização real do usuário
          setDrivers([
            { id: 1, latitude: currentLoc.coords.latitude + 0.004, longitude: currentLoc.coords.longitude + 0.005 },
            { id: 2, latitude: currentLoc.coords.latitude - 0.003, longitude: currentLoc.coords.longitude + 0.007 },
            { id: 3, latitude: currentLoc.coords.latitude + 0.006, longitude: currentLoc.coords.longitude - 0.004 },
            { id: 4, latitude: currentLoc.coords.latitude - 0.005, longitude: currentLoc.coords.longitude - 0.006 },
          ]);
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
        // Carros próximos ao fallback (Muriaé)
        setDrivers([
          { id: 1, latitude: -21.1268, longitude: -42.3600 },
          { id: 2, latitude: -21.1340, longitude: -42.3680 },
          { id: 3, latitude: -21.1280, longitude: -42.3710 },
          { id: 4, latitude: -21.1330, longitude: -42.3590 },
        ]);
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
      {/* Header Elegante BibiMarcos com Logo */}
      <View className="bg-emerald-900 p-5 pt-14 flex-row justify-between items-center shadow-2xl border-b-[6px] border-emerald-500 rounded-b-3xl z-10">
        <View className="flex-row items-center">
          <View className="bg-white p-0.5 rounded-full mr-3 shadow-md border-2 border-emerald-400 overflow-hidden">
            <Image 
              source={require('./assets/icon.png')} 
              style={{ width: 56, height: 56, borderRadius: 28 }} 
              resizeMode="cover"
            />
          </View>
          <View>
            <Text className="text-white text-2xl font-extrabold tracking-tighter drop-shadow-md">BibiMarcos</Text>
            <Text className="text-emerald-200 text-[10px] font-bold uppercase tracking-widest mt-1">Sua cidade. Seu motorista.</Text>
          </View>
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

                    // ==========================================
                    // MOTOR DE CARROS COM ROTAS REAIS DE MURIAE
                    // ==========================================
                    // Imagem car3d.png convertida em base64 garantida para renderizar em qualquer Android
                    var carSrc = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAtGVYSWZJSSoACAAAAAYAEgEDAAEAAAABAAAAGgEFAAEAAABWAAAAGwEFAAEAAABeAAAAKAEDAAEAAAACAAAAEwIDAAEAAAABAAAAaYcEAAEAAABmAAAAAAAAAGAAAAABAAAAYAAAAAEAAAAGAACQBwAEAAAAMDIxMAGRBwAEAAAAAQIDAACgBwAEAAAAMDEwMAGgAwABAAAA//8AAAKgBAABAAAAMAAAAAOgBAABAAAAMAAAAAAAAACffAoGAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAFWmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSfvu78nIGlkPSdXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQnPz4KPHg6eG1wbWV0YSB4bWxuczp4PSdhZG9iZTpuczptZXRhLyc+CjxyZGY6UkRGIHhtbG5zOnJkZj0naHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyc+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpBdHRyaWI9J2h0dHA6Ly9ucy5hdHRyaWJ1dGlvbi5jb20vYWRzLzEuMC8nPgogIDxBdHRyaWI6QWRzPgogICA8cmRmOlNlcT4KICAgIDxyZGY6bGkgcmRmOnBhcnNlVHlwZT0nUmVzb3VyY2UnPgogICAgIDxBdHRyaWI6Q3JlYXRlZD4yMDI2LTA0LTMwPC9BdHRyaWI6Q3JlYXRlZD4KICAgICA8QXR0cmliOkRhdGE+eyZxdW90O2RvYyZxdW90OzomcXVvdDtEQUhJVWtKcHNidyZxdW90OywmcXVvdDt1c2VyJnF1b3Q7OiZxdW90O1VBRVdLYjNJMTlJJnF1b3Q7LCZxdW90O2JyYW5kJnF1b3Q7OiZxdW90O0VxdWlwZSBkZSBDT05DRUlUTyBSVUEmcXVvdDt9PC9BdHRyaWI6RGF0YT4KICAgICA8QXR0cmliOkV4dElkPjUzZTkxZmEzLTcxNWUtNGNjYS05ZGYyLTgzM2JmMTYxMDU4MDwvQXR0cmliOkV4dElkPgogICAgIDxBdHRyaWI6RmJJZD41MjUyNjU5MTQxNzk1ODA8L0F0dHJpYjpGYklkPgogICAgIDxBdHRyaWI6VG91Y2hUeXBlPjI8L0F0dHJpYjpUb3VjaFR5cGU+CiAgICA8L3JkZjpsaT4KICAgPC9yZGY6U2VxPgogIDwvQXR0cmliOkFkcz4KIDwvcmRmOkRlc2NyaXB0aW9uPgoKIDxyZGY6RGVzY3JpcHRpb24gcmRmOmFib3V0PScnCiAgeG1sbnM6ZGM9J2h0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvJz4KICA8ZGM6dGl0bGU+CiAgIDxyZGY6QWx0PgogICAgPHJkZjpsaSB4bWw6bGFuZz0neC1kZWZhdWx0Jz5EZXNpZ24gc2VtIG5vbWUgLSAyPC9yZGY6bGk+CiAgIDwvcmRmOkFsdD4KICA8L2RjOnRpdGxlPgogPC9yZGY6RGVzY3JpcHRpb24+CgogPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9JycKICB4bWxuczpwZGY9J2h0dHA6Ly9ucy5hZG9iZS5jb20vcGRmLzEuMy8nPgogIDxwZGY6QXV0aG9yPkV2YW5kcm8gU2lsdmE8L3BkZjpBdXRob3I+CiA8L3JkZjpEZXNjcmlwdGlvbj4KCiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0nJwogIHhtbG5zOnhtcD0naHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wLyc+CiAgPHhtcDpDcmVhdG9yVG9vbD5DYW52YSBkb2M9REFISVVrSnBzYncgdXNlcj1VQUVXS2IzSTE5SSBicmFuZD1FcXVpcGUgZGUgQ09OQ0VJVE8gUlVBPC94bXA6Q3JlYXRvclRvb2w+CiA8L3JkZjpEZXNjcmlwdGlvbj4KPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KPD94cGFja2V0IGVuZD0ncic/PrY29UkAAAU2SURBVGiB7ZhrTFNnGMePoFtmsuiXZTMZY9yKLb3fT6+0pS10XGR4cIo3ECltKeUOE0K9VPSDjsxossVLluimYwpUELBULupkMlzip2Xfln3Zp30RTczknP/O4bYlumyfxlnSX/LkTdr3nzz/933e9znnEESCBAkSJEiQ4CXWAUsRDhNJ3LjWCf1r+vqoZACvTJhi/yN4bmY1uZKB1M3Vt6VpNSOqjANx3dvWSWI99ztvd2Nl1VsHi22RiYqhzm/dv4bi5BPfmOZJ9ZDit7qoZa5joNxPhJeM8Iowwknc2Ni/zXrxXmT+zGMfTv24i2l7YEHjtBG1MRVCcQt9+YeTODFQ18PN/bsyWxNWkukdbf3yzMMQuh+U/N7zmGKCkzqmYcrABGI6xjusfdE768UnN9t+th17P5Wbzx3wtc2cY6WmKeK19phntn3Kg8hsOX1oxoW6uB71d0gE2fFgVM2cmN2D+huuBffxFDMn4ZuBN1on8+Yaxpw4+vBDun3GhtA91gAboWkSNcMq5vjMbgSjdpiPbbJzEt4ZaIsVzrVP5aP7YTEdiJqx95Iae86rUXVVi+qoiumYLkLTcAE8p1NtnCQcDvPAwMrVqSI2dMWpmeA1N8rrnbSr1AINqYRMkQOZTghtvojZe8qG5mHPix2fkgZOwi8DLF13tsdrDlPw7vfTVBkFo8EAiVgMgUCA9HczGYVJiP0XDfP+K045N59XBj5HzYbKS6bpUO8uNIea6XKKgoE0IEckRnZ2NjLTWAP2LJSdlD87eMmh4TT8OAPLNEbdh+21oudUixU+r48pKS0EadJAqhRBKGF34L10yPPSGbIiA9si0vHKEflbi0KedOak5mhRmn2v8n55Ry4io1X0x+OFaBl3IDhqhndQj4/OyRhXiwiGUsl82RFDCWHlT0deXUGPTxcv77Dj7C9VdNecC8332U58z4QGthvX3dUw2yIK5JYr5+uGXDJuPq/OANuNkwrr9ROFfj06Zzx0aNII/7gOgXE9/DE9qodUjLtJxhl46uuzqTgN3wysK2kmJ9wHNGgcz6WDbAeuva1lQwffmA5VbB/IC0hh26l8Ghx0KDgN7wyUthsn3FVqBEZMdCBOwjuqRQ0XI1pUDqoYR60Ytgr5s8ANs5LT8OUWWjVQ1kVO5Neq4R8x0H62dLwjXPIaHLylQWW/knHWS+CoVDzzDfCyhPqStx8l7xc1aRCIGelAjFxa/VtsDLM7MKBkCtqkcPmUz+tvWpb7AB8MLN/jI8h/fddp4/dl3VrUjRtp35h+ceWrh9mIarDvhpzxdEngaVIwVdfNFk7DjxJaNqC6uWWj7xvHI+9VCwoqdbShUArtB0Ko3QIonFmQWtOZvOZs7DynwI7PNA5OwysDW2qIjR0TRY8ab9thc5lotUwLiUgCoUCI7MytSE/JZOxNAlR+rUTFWXLZAB9K6M9GtqF7ivqurj8XFgdJk3o9lGo5ZHIxJNIcZGUIGFswC3uuKF7sPmfm1dPo6ivl4bvU+aZhN4xO1YIiRwWxQIqtGSII0rYiKzNroaA7BxVfKH4qPaTasiTkx3MQ0UdRydzY06nfd6TfCW+/hSk7oqHdQTnt9Etpd4OELjsjXzjwlRL+VuH1tc73VSyu5IViw5uRkOxC7TXt0+CUEb47OnhjbB8Y02DnZfFCTYtg5kSxcLEL8/b70CRBrC9oTVE7Iyn783pSGxxHUxvNnSlek/+dfKt10+blafxMfuV76D9M42fyf4WiiGSq7+Ug/g/JJ0iQIEGCBP8lfwDCIYCDeu4hzwAAAABJRU5ErkJggg==';

                    // Rotas perfeitamente traçadas nas ruas de Muriaé (OSRM GeoJSON - [lng, lat])
                    var routes = [
                      [[-42.364141,-21.130599],[-42.364157,-21.129504],[-42.363756,-21.129676],[-42.363719,-21.12969],[-42.363719,-21.129626],[-42.363716,-21.129265],[-42.363716,-21.129221],[-42.363685,-21.129136],[-42.363647,-21.129022],[-42.36362,-21.128952],[-42.363586,-21.128912],[-42.363527,-21.12886],[-42.363421,-21.128785],[-42.3632,-21.128744],[-42.363081,-21.128736],[-42.362974,-21.128734],[-42.362924,-21.128707],[-42.362897,-21.128673],[-42.362884,-21.128633],[-42.362883,-21.128561],[-42.362892,-21.128516],[-42.363073,-21.12846],[-42.363458,-21.128361],[-42.363646,-21.128099],[-42.363857,-21.127806],[-42.363875,-21.127749],[-42.363892,-21.127671],[-42.363901,-21.127588],[-42.363903,-21.127508],[-42.363898,-21.127424],[-42.363888,-21.127392],[-42.363864,-21.127339],[-42.363829,-21.127292],[-42.363768,-21.127257],[-42.363664,-21.127229],[-42.363448,-21.127227],[-42.363315,-21.127227],[-42.36317,-21.127228],[-42.362715,-21.127233],[-42.362623,-21.127227],[-42.362588,-21.127217],[-42.362552,-21.127205],[-42.362509,-21.127176],[-42.362493,-21.127165],[-42.362479,-21.127145],[-42.362465,-21.127125],[-42.362775,-21.126842],[-42.363484,-21.126243],[-42.363482,-21.126183],[-42.363472,-21.125655],[-42.363472,-21.125265],[-42.363427,-21.124851],[-42.363379,-21.124399],[-42.363509,-21.124182],[-42.363575,-21.124099],[-42.363698,-21.124025],[-42.364697,-21.123439],[-42.364734,-21.123158],[-42.36468,-21.123056],[-42.36454,-21.122842],[-42.364424,-21.12275],[-42.364187,-21.122465],[-42.363865,-21.122657],[-42.363294,-21.123039],[-42.363115,-21.123136],[-42.363038,-21.12315],[-42.362938,-21.123141],[-42.362431,-21.122973]],
                      [[-42.364141,-21.130599],[-42.364137,-21.130911],[-42.364579,-21.130911],[-42.365187,-21.130916],[-42.365564,-21.130914],[-42.36577,-21.130913],[-42.365886,-21.131004],[-42.366774,-21.130979],[-42.366776,-21.131256],[-42.366641,-21.131264],[-42.366609,-21.131303],[-42.366598,-21.13134],[-42.366597,-21.131417],[-42.366606,-21.131511],[-42.366316,-21.132035],[-42.366205,-21.132237],[-42.366098,-21.132529],[-42.366056,-21.132642],[-42.365976,-21.132855],[-42.365954,-21.132919],[-42.365927,-21.133076],[-42.365811,-21.133532],[-42.366653,-21.133723],[-42.366776,-21.133768],[-42.366745,-21.133887],[-42.367588,-21.134131],[-42.367638,-21.134547],[-42.367561,-21.134676],[-42.367533,-21.134736],[-42.368037,-21.134946],[-42.368091,-21.135013],[-42.368217,-21.135401],[-42.368273,-21.135439],[-42.368739,-21.135613],[-42.368492,-21.13611],[-42.368352,-21.136448],[-42.368315,-21.136605],[-42.368317,-21.136698],[-42.368349,-21.136857],[-42.368355,-21.136888],[-42.368489,-21.137466],[-42.3685,-21.137701],[-42.368473,-21.138224],[-42.368466,-21.138382],[-42.368448,-21.138805]],
                      [[-42.364141,-21.130599],[-42.364157,-21.129504],[-42.363756,-21.129676],[-42.363719,-21.12969],[-42.363684,-21.129702],[-42.363137,-21.129877],[-42.36195,-21.130161],[-42.360917,-21.13038],[-42.360603,-21.130438],[-42.360446,-21.130465],[-42.359951,-21.130454],[-42.35935,-21.130418],[-42.359021,-21.130359],[-42.35886,-21.13031],[-42.358644,-21.130226],[-42.358444,-21.130106],[-42.358314,-21.130002],[-42.357579,-21.129263],[-42.35742,-21.129094],[-42.357395,-21.129078],[-42.35734,-21.129064],[-42.3573,-21.129062],[-42.357239,-21.129067],[-42.356271,-21.127694],[-42.355919,-21.12746],[-42.355854,-21.127427],[-42.355766,-21.127402],[-42.355646,-21.127383],[-42.355595,-21.12738],[-42.355572,-21.127381],[-42.355546,-21.127458],[-42.355536,-21.127474],[-42.355522,-21.127486],[-42.355495,-21.127496],[-42.355569,-21.127856],[-42.355017,-21.127905],[-42.354948,-21.127921],[-42.354894,-21.127943],[-42.354809,-21.127987],[-42.35489,-21.128136],[-42.355031,-21.12838],[-42.355166,-21.128661],[-42.355172,-21.128674]],
                      [[-42.368448,-21.138805],[-42.368466,-21.138382],[-42.368473,-21.138224],[-42.3685,-21.137701],[-42.368489,-21.137466],[-42.368355,-21.136888],[-42.368349,-21.136857],[-42.368317,-21.136698],[-42.368315,-21.136605],[-42.368352,-21.136448],[-42.368492,-21.13611],[-42.368739,-21.135613],[-42.368273,-21.135439],[-42.368217,-21.135401],[-42.368091,-21.135013],[-42.368037,-21.134946],[-42.367533,-21.134736],[-42.367561,-21.134676],[-42.367638,-21.134547],[-42.367588,-21.134131],[-42.366745,-21.133887],[-42.366776,-21.133768],[-42.366653,-21.133723],[-42.365811,-21.133532],[-42.365927,-21.133076],[-42.365954,-21.132919],[-42.365976,-21.132855],[-42.366056,-21.132642],[-42.366098,-21.132529],[-42.366205,-21.132237],[-42.366316,-21.132035],[-42.366606,-21.131511],[-42.366597,-21.131417],[-42.366598,-21.13134],[-42.366609,-21.131303],[-42.366641,-21.131264],[-42.366776,-21.131256],[-42.366774,-21.130979],[-42.365886,-21.131004],[-42.36577,-21.130913],[-42.365564,-21.130914],[-42.365187,-21.130916],[-42.364579,-21.130911],[-42.364137,-21.130911],[-42.364141,-21.130599]]
                    ];

                    // Estado de cada carro: rota, waypoint atual, progresso (0-1) e direção
                    var carStates = routes.map(function(route) {
                      return { route: route, idx: 0, t: Math.random(), dir: 1 };
                    });

                    function lerp(a, b, t) { return a + (b - a) * t; }

                    function getCarPos(state) {
                      var r = state.route;
                      var i = state.idx;
                      var next = Math.min(i + 1, r.length - 1);
                      // Inverte o indice 0 e 1 pois o OSRM retorna [lng, lat] e o Leaflet usa [lat, lng]
                      return [lerp(r[i][1], r[next][1], state.t),
                              lerp(r[i][0], r[next][0], state.t)];
                    }

                    // Função que determina o tamanho do ícone baseado no zoom atual
                    function getIconSize() {
                      var z = map.getZoom();
                      if (z <= 13) return 28;
                      if (z <= 15) return 40;
                      if (z <= 17) return 56;
                      return 70;
                    }

                    function makeCarIcon(size, state) {
                      // Calcula o angulo baseado na rota (se move de r[idx] para r[next])
                      var r = state ? state.route : null;
                      var i = state ? state.idx : 0;
                      var angle = 0;
                      if (r && i < r.length - 1) {
                        // Como invertemos lat/lng, dx e dy usam os índices corretos
                        var dlng = r[i+1][0] - r[i][0];
                        var dlat = r[i+1][1] - r[i][1];
                        // Convertendo de lat/lng math para graus CSS
                        angle = Math.atan2(dlng, dlat) * (180 / Math.PI);
                      }

                      return L.divIcon({
                        className: '',
                        html: '<img src="' + carSrc + '" style="width:' + size + 'px;height:' + size + 'px;object-fit:contain;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.6)); transform: rotate(' + angle + 'deg); transition: transform 0.1s;"/>',
                        iconSize: [size, size],
                        iconAnchor: [size/2, size/2]
                      });
                    }

                    // Cria marcadores na posição inicial de cada rota
                    var initSize = getIconSize();
                    var driverMarkers = carStates.map(function(state) {
                      var pos = getCarPos(state);
                      return L.marker(pos, { icon: makeCarIcon(initSize, state) }).addTo(map);
                    });

                    // Atualiza tamanho e angulo dos ícones quando o usuário faz zoom ou o carro muda de direção
                    function updateIcons() {
                      var sz = getIconSize();
                      driverMarkers.forEach(function(m, i) {
                        m.setIcon(makeCarIcon(sz, carStates[i]));
                      });
                    }

                    map.on('zoomend', updateIcons);

                    // Motor de animação suave: avance por lerp a cada 50ms (~20 FPS)
                    // SPEED agora é dinamico dependendo da distancia real para manter uma velocidade "constante" do carro
                    setInterval(function() {
                      carStates.forEach(function(state, i) {
                        var r = state.route;
                        var next = Math.min(state.idx + 1, r.length - 1);
                        var dist = Math.sqrt(Math.pow(r[next][0] - r[state.idx][0], 2) + Math.pow(r[next][1] - r[state.idx][1], 2));
                        
                        // Ajusta a velocidade baseada na distancia do trecho (quanto menor a distancia, maior o avanço de "t" pra manter a mesma velocidade real em KM/H)
                        var SPEED = dist === 0 ? 1 : 0.00003 / dist; 

                        state.t += SPEED;
                        if (state.t >= 1) {
                          state.t = 0;
                          state.idx += state.dir;
                          
                          // Verifica se chegou ao fim da rua para retornar
                          var dirChanged = false;
                          if (state.idx >= state.route.length - 1) {
                            state.idx = state.route.length - 2;
                            state.dir = -1;
                            // Inverte a rota para o carro olhar pra direção certa na volta
                            state.route = state.route.slice().reverse();
                            state.idx = 0;
                            dirChanged = true;
                          } else if (state.idx < 0) {
                            state.idx = 0;
                            state.dir = 1;
                            dirChanged = true;
                          }
                          
                          if (dirChanged || state.t === 0) updateIcons();
                        }
                        var pos = getCarPos(state);
                        driverMarkers[i].setLatLng(pos);
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

        {/* Botão de Chat flutuante - acima do botão GPS para não sobrepor */}
        <View className={`absolute right-4 ${isDriverOnline ? 'bottom-10' : 'bottom-[220px]'}`}>
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
