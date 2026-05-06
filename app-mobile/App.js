import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  Switch, 
  TouchableOpacity, 
  SafeAreaView, 
  ActivityIndicator, 
  Alert,
  StatusBar,
  Image,
  Dimensions
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

// Componentes Separados
import LoginScreen from './screens/LoginScreen';
import ChatModal from './components/ChatModal';
import PaymentModal from './components/PaymentModal';

const SOCKET_URL = process.env.EXPO_PUBLIC_API_URL || 'ws://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io/ws';
const HTTP_API_URL = SOCKET_URL.replace('ws://', 'http://').replace('/ws', '');

const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

// Task de Background para Motoristas
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  if (data) {
    const { locations } = data;
    const loc = locations[0];
    if (loc) {
      // Nota: No background, idealmente usaríamos um fetch direto
      // Mas para manter simples no protótipo, o app precisa estar "vivo" para o WS
    }
  }
});

export default function App() {
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [isDriverOnline, setIsDriverOnline] = useState(false);
  const [activeRide, setActiveRide] = useState(null);
  const [chatVisible, setChatVisible] = useState(false);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [nearbyDrivers, setNearbyDrivers] = useState([]);
  
  const ws = useRef(null);
  const webViewRef = useRef(null);
  const locationSubscription = useRef(null);

  // Inicialização do WebSocket
  useEffect(() => {
    if (user) {
      connectWebSocket();
    }
    return () => ws.current?.close();
  }, [user]);

  const connectWebSocket = () => {
    ws.current = new WebSocket(SOCKET_URL);
    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: 'register', user_id: user.user_id }));
    };
    ws.current.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleWsMessage(data);
      } catch (err) {}
    };
    ws.current.onclose = () => {
      setTimeout(connectWebSocket, 3000);
    };
  };

  const handleWsMessage = (data) => {
    switch (data.type) {
      case 'ride_request':
        if (user.tipo === 'motorista') {
          Alert.alert(
            "Nova Corrida!",
            `De: ${data.ride.origin_name}\nPara: ${data.ride.dest_name}\nValor: R$ ${data.ride.fare}`,
            [
              { text: "Recusar", style: "cancel" },
              { text: "ACEITAR", onPress: () => acceptRide(data.ride.ride_id) }
            ]
          );
        }
        break;
      case 'ride_accepted':
      case 'driver_arrived':
      case 'ride_started':
      case 'ride_completed':
        setActiveRide(data.ride);
        if (data.type === 'ride_completed' && user.tipo === 'passageiro') {
          setPaymentVisible(true);
        }
        break;
      case 'driver_location':
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`updateDriverPos(${data.lat}, ${data.lng});`);
        }
        break;
      case 'chat':
        setChatMessages(prev => [...prev, data]);
        if (!chatVisible) {
          // Pequeno feedback visual ou som se desejar
        }
        break;
      case 'ride_cancelled':
        Alert.alert("Aviso", "A corrida foi cancelada.");
        setActiveRide(null);
        setChatMessages([]);
        break;
    }
  };

  // Funções de Ação
  const acceptRide = async (rideId) => {
    try {
      await fetch(`${HTTP_API_URL}/api/rides/${rideId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id })
      });
    } catch (e) {}
  };

  const toggleDriverMode = async () => {
    const newValue = !isDriverOnline;
    setIsDriverOnline(newValue);

    if (newValue) {
      await fetch(`${HTTP_API_URL}/api/drivers/online`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, lat: location.latitude, lng: location.longitude })
      });
      startTracking();
    } else {
      await fetch(`${HTTP_API_URL}/api/drivers/offline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id })
      });
      stopTracking();
    }
  };

  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
      (loc) => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({
            type: 'location_update',
            user_id: user.user_id,
            lat: loc.coords.latitude,
            lng: loc.coords.longitude
          }));
        }
      }
    );
  };

  const stopTracking = () => {
    locationSubscription.current?.remove();
  };

  const sendChatMessage = () => {
    if (!chatInput.trim() || !activeRide) return;
    const msg = {
      type: 'chat',
      ride_id: activeRide.ride_id,
      sender_id: user.user_id,
      sender: user.tipo,
      text: chatInput,
      timestamp: new Date().toISOString()
    };
    ws.current?.send(JSON.stringify(msg));
    setChatInput('');
  };

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      let loc = await Location.getCurrentPositionAsync({});
      setLocation({
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    })();
  }, []);

  if (!user) {
    return <LoginScreen onLogin={(u) => setUser(u)} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <StatusBar barStyle="dark-content" />
      
      {/* Header Premium */}
      <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#064e3b' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={require('./assets/icon.png')} style={{ width: 40, height: 40, borderRadius: 20, marginRight: 10 }} />
          <View>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18 }}>BibiMarcos</Text>
            <Text style={{ color: '#34d399', fontSize: 10, fontWeight: '700' }}>{user.nome.toUpperCase()}</Text>
          </View>
        </View>
        
        {user.tipo === 'motorista' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#047857', padding: 6, borderRadius: 20 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: 'bold', marginRight: 5 }}>{isDriverOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            <Switch
              value={isDriverOnline}
              onValueChange={toggleDriverMode}
              trackColor={{ false: '#334155', true: '#10b981' }}
              thumbColor={isDriverOnline ? '#fff' : '#94a3b8'}
              style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
            />
          </View>
        )}
      </View>

      {/* Mapa */}
      <View style={{ flex: 1 }}>
        {location ? (
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
                  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
                  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
                  <style>
                    body { padding: 0; margin: 0; }
                    #map { height: 100vh; width: 100vw; }
                    .driver-icon { font-size: 30px; text-shadow: 0 2px 5px rgba(0,0,0,0.3); }
                  </style>
                </head>
                <body>
                  <div id="map"></div>
                  <script>
                    var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([${location.latitude}, ${location.longitude}], 16);
                    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png').addTo(map);
                    
                    var userMarker = L.marker([${location.latitude}, ${location.longitude}], {
                      icon: L.divIcon({ className: '', html: '📍', iconSize: [30, 30], iconAnchor: [15, 30] })
                    }).addTo(map);

                    var drivers = {};

                    window.updateDriverPos = function(lat, lng) {
                      if (!drivers['main']) {
                        drivers['main'] = L.marker([lat, lng], {
                          icon: L.divIcon({ className: 'driver-icon', html: '🚗' })
                        }).addTo(map);
                      } else {
                        drivers['main'].setLatLng([lat, lng]);
                      }
                      var group = new L.featureGroup([userMarker, drivers['main']]);
                      map.fitBounds(group.getBounds(), { padding: [50, 50] });
                    };
                  </script>
                </body>
                </html>
              `
            }}
          />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#064e3b" />
          </View>
        )}

        {/* Botão de Chat flutuante se houver corrida */}
        {activeRide && (
          <TouchableOpacity
            style={{ position: 'absolute', bottom: 100, right: 20, backgroundColor: '#064e3b', width: 60, height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', elevation: 5 }}
            onPress={() => setChatVisible(true)}
          >
            <Text style={{ fontSize: 30 }}>💬</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Rodapé Dinâmico */}
      <View style={{ padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: '#fff', elevation: 20 }}>
        {!activeRide ? (
          user.tipo === 'passageiro' ? (
            <TouchableOpacity 
              style={{ backgroundColor: '#064e3b', padding: 18, borderRadius: 15, alignItems: 'center' }}
              onPress={() => Alert.alert("Em breve", "Fluxo de busca de destino sendo integrado.")}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>PARA ONDE VAMOS?</Text>
            </TouchableOpacity>
          ) : (
            <Text style={{ textAlign: 'center', color: '#64748b', fontWeight: 'bold' }}>
              {isDriverOnline ? 'Aguardando chamadas...' : 'Fique online para receber corridas'}
            </Text>
          )
        ) : (
          <View>
            <Text style={{ fontWeight: '900', fontSize: 18, color: '#064e3b' }}>
              {activeRide.status === 'accepted' ? 'Motorista a caminho' : 
               activeRide.status === 'in_ride' ? 'Em viagem' : 'Corrida Finalizada'}
            </Text>
            <Text style={{ color: '#64748b', marginBottom: 10 }}>{activeRide.dest_name}</Text>
            
            {user.tipo === 'motorista' && activeRide.status === 'accepted' && (
              <TouchableOpacity 
                style={{ backgroundColor: '#f59e0b', padding: 15, borderRadius: 10, alignItems: 'center' }}
                onPress={() => acceptRide(activeRide.ride_id)} // Aqui seria o StartRide
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>INICIAR CORRIDA</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <ChatModal 
        visible={chatVisible} 
        onClose={() => setChatVisible(false)}
        messages={chatMessages}
        input={chatInput}
        onChangeInput={setChatInput}
        onSend={sendChatMessage}
        isDriver={user.tipo === 'motorista'}
      />

      <PaymentModal
        visible={paymentVisible}
        ride={activeRide}
        onClose={() => setPaymentVisible(false)}
        onConfirm={() => {
          setPaymentVisible(false);
          setActiveRide(null);
          setChatMessages([]);
        }}
      />
    </SafeAreaView>
  );
}
