import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Switch, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert, StatusBar, Image, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

import LoginScreen from './screens/LoginScreen';
import ChatModal from './components/ChatModal';
import PaymentModal from './components/PaymentModal';
import DestinationModal from './components/DestinationModal';
import RatingModal from './components/RatingModal';

const WS_URL = process.env.EXPO_PUBLIC_API_URL || 'ws://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io/ws';
const HTTP_URL = WS_URL.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');
const BG_TASK = 'BACKGROUND_LOCATION_TASK';
const USER_FILE = FileSystem.documentDirectory + 'session.json';

TaskManager.defineTask(BG_TASK, ({ data, error }) => { if (error || !data) return; });

export default function App() {
  const [user, setUser] = useState(null);
  const [appReady, setAppReady] = useState(false);
  const [location, setLocation] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [activeRide, setActiveRide] = useState(null);
  const [chatVisible, setChatVisible] = useState(false);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [destVisible, setDestVisible] = useState(false);
  const [ratingVisible, setRatingVisible] = useState(false);
  const [rideToRate, setRideToRate] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [rideStatus, setRideStatus] = useState('');
  const [searching, setSearching] = useState(false);

  const ws = useRef(null);
  const webViewRef = useRef(null);
  const locSub = useRef(null);

  const rideStatusRef = useRef(rideStatus);
  const locationRef = useRef(location);

  useEffect(() => { rideStatusRef.current = rideStatus; }, [rideStatus]);
  useEffect(() => { locationRef.current = location; }, [location]);

  useEffect(() => {
    (async () => {
      try {
        const stored = await FileSystem.readAsStringAsync(USER_FILE);
        if (stored) {
          const u = JSON.parse(stored);
          setUser(u);
          
          // Blindagem Vale do Silício: Recuperar corrida se o app fechou no meio da viagem
          try {
            const r = await fetch(`${HTTP_URL}/api/users/${u.user_id}/active-ride`);
            const d = await r.json();
            if (d && d.ride_id) {
              setActiveRide(d);
              setRideStatus(d.status);
              if (u.tipo === 'motorista') {
                setIsOnline(true);
              }
            }
          } catch(e) {}
        }
      } catch {}
      setAppReady(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  const reconnectTimer = useRef(null);
  const pingInterval = useRef(null);
  const pongTimeout = useRef(null);
  
  useEffect(() => {
    if (user) {
      connectWS();
      playHorn();
    }
    return () => {
      clearTimeout(reconnectTimer.current);
      clearInterval(pingInterval.current);
      clearTimeout(pongTimeout.current);
      if (ws.current) {
        ws.current.onclose = null; // impede auto-reconnect ao desmontar
        ws.current.close();
      }
    };
  }, [user]);

  const playHorn = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('./assets/horn.ogg'),
        { shouldPlay: true, volume: 1.0 }
      );
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync();
        }
      });
    } catch (e) {
      console.log('Erro ao tocar som:', e);
    }
  };

  const connectWS = () => {
    clearTimeout(reconnectTimer.current);
    clearInterval(pingInterval.current);
    clearTimeout(pongTimeout.current);
    
    if (ws.current) {
      ws.current.onclose = null;
      ws.current.close();
    }
    
    ws.current = new WebSocket(WS_URL);
    ws.current.onopen = () => {
      ws.current.send(JSON.stringify({ type: 'register', user_id: user.user_id }));
      // Ping a cada 15s para garantir que não virou zumbi
      pingInterval.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: 'ping' }));
          // Se não voltar o pong em 5s, a conexão está morta (dropamos)
          pongTimeout.current = setTimeout(() => {
            console.log("WS Zumbi detectado! Forçando reconexão...");
            ws.current?.close();
          }, 5000);
        }
      }, 15000);
    };
    
    ws.current.onmessage = (e) => { 
      try { 
        const d = JSON.parse(e.data);
        if (d.type === 'pong') {
          clearTimeout(pongTimeout.current); // Bateu o coração, conexão está viva!
          return;
        }
        handleMsg(d); 
      } catch {} 
    };
    
    ws.current.onclose = () => {
      clearInterval(pingInterval.current);
      clearTimeout(pongTimeout.current);
      reconnectTimer.current = setTimeout(connectWS, 3000);
    };
  };

  const send = (obj) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(obj));

  const handleMsg = (data) => {
    switch (data.type) {
      case 'ride_request':
        if (user.tipo === 'motorista') {
          const r = data.ride;
          playHorn();
          Alert.alert(
            '🚗 Nova Solicitação de Corrida!',
            `Passageiro: ${r.passenger_name} (⭐${r.passenger_avaliacao?.toFixed(1) || '5.0'})\nDe: ${r.origin_name}\nPara: ${r.dest_name}\nValor: R$ ${r.fare?.toFixed(2)}\nDistância: ${(r.driver_distance_meters / 1000).toFixed(1)}km`,
            [{ text: 'Recusar', style: 'cancel' }, { text: 'ACEITAR ✓', onPress: () => acceptRide(r.ride_id) }]
          );
        }
        break;
      case 'ride_accepted':
        setActiveRide(data.ride);
        setRideStatus('accepted');
        setSearching(false);
        break;
      case 'driver_arrived':
        setActiveRide(data.ride);
        setRideStatus('driver_arrived');
        break;
      case 'ride_started':
        setActiveRide(data.ride);
        setRideStatus('in_ride');
        break;
      case 'ride_completed':
        setRideToRate(data.ride);
        if (user.tipo === 'passageiro') {
          setPaymentVisible(true);
        } else {
          setActiveRide(null); setRideStatus(''); setChatMessages([]);
          if (isOnline) startTracking();
          setRatingVisible(true);
        }
        break;
      case 'driver_location':
        if (rideStatusRef.current === 'accepted' && locationRef.current) {
          const loc = locationRef.current;
          fetch(`https://router.project-osrm.org/route/v1/driving/${data.lng},${data.lat};${loc.longitude},${loc.latitude}?overview=false`)
            .then(r => r.json())
            .then(d => {
                let eta = '';
                if (d.routes && d.routes.length > 0) {
                    const mins = Math.ceil(d.routes[0].duration / 60);
                    eta = mins > 0 ? `${mins} min` : 'Chegando';
                }
                webViewRef.current?.injectJavaScript(`updateDriver(${data.lat},${data.lng}, "${eta}");true;`);
            }).catch(() => webViewRef.current?.injectJavaScript(`updateDriver(${data.lat},${data.lng}, "");true;`));
        } else {
          webViewRef.current?.injectJavaScript(`updateDriver(${data.lat},${data.lng}, "");true;`);
        }
        break;
      case 'chat':
        setChatMessages(p => [...p, data]);
        if (!chatVisible) {
          Alert.alert('Nova mensagem', `${data.sender === 'motorista' ? 'Motorista' : 'Passageiro'}: ${data.text}`);
        }
        break;
      case 'ride_cancelled':
        Alert.alert('Corrida cancelada', 'A corrida foi cancelada.');
        setActiveRide(null); setRideStatus(''); setSearching(false); setChatMessages([]);
        if (user.tipo === 'motorista' && isOnline) setIsOnline(true);
        break;
    }
  };

  const acceptRide = async (rideId) => {
    try {
      const r = await fetch(`${HTTP_URL}/api/rides/${rideId}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id })
      });
      const d = await r.json();
      setActiveRide(d.ride); setRideStatus('accepted');
      
      // Traçar rota verde do motorista até o passageiro
      if (locationRef.current) {
        const dLat = locationRef.current.latitude;
        const dLng = locationRef.current.longitude;
        const pLat = d.ride.origin_lat;
        const pLng = d.ride.origin_lng;
        fetch(`https://router.project-osrm.org/route/v1/driving/${dLng},${dLat};${pLng},${pLat}?overview=full&geometries=geojson`)
          .then(res => res.json())
          .then(data => {
            if (data.routes && data.routes.length > 0) {
              const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Leaflet usa [lat, lng]
              webViewRef.current?.injectJavaScript(`drawRoute(${JSON.stringify(coords)});true;`);
            }
          }).catch(err => console.log('Erro ao traçar rota até o passageiro:', err));
      }
    } catch { Alert.alert('Erro', 'Não foi possível aceitar.'); }
  };

  const toggleOnline = async () => {
    const val = !isOnline;
    setIsOnline(val);
    if (val) {
      await fetch(`${HTTP_URL}/api/drivers/online`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, lat: location?.latitude || 0, lng: location?.longitude || 0 })
      });
      startTracking();
    } else {
      await fetch(`${HTTP_URL}/api/drivers/offline`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id })
      });
      stopTracking();
    }
  };

  const startTracking = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    locSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 8 },
      (loc) => {
        const lat = loc.coords.latitude, lng = loc.coords.longitude;
        setLocation({ latitude: lat, longitude: lng });
        send({ type: 'location_update', user_id: user.user_id, lat, lng });
        webViewRef.current?.injectJavaScript(`updateMe(${lat},${lng});true;`);
      }
    );
  };
  const stopTracking = () => locSub.current?.remove();

  const requestRide = async (destInfo) => {
    setDestVisible(false);
    setSearching(true);
    try {
      const r = await fetch(`${HTTP_URL}/api/rides/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passenger_id: user.user_id,
          origin_lat: location.latitude, origin_lng: location.longitude,
          origin_name: 'Minha Localização',
          dest_lat: destInfo.dest_lat, dest_lng: destInfo.dest_lng,
          dest_name: destInfo.dest_name,
          distance_meters: destInfo.distance_meters,
        })
      });
      if (!r.ok) {
        const e = await r.json();
        Alert.alert('Aviso', e.detail || 'Nenhum motorista disponível.'); setSearching(false);
      } else {
        const d = await r.json();
        setActiveRide({ ride_id: d.ride_id, fare: d.fare, dest_name: destInfo.dest_name, origin_name: 'Minha Localização' });
        setRideStatus('searching');
        if (destInfo.geometry) {
          const coords = destInfo.geometry.map(([lng, lat]) => [lat, lng]);
          webViewRef.current?.injectJavaScript(`drawRoute(${JSON.stringify(coords)});true;`);
        }
      }
    } catch (e) { Alert.alert('Erro', e.message); setSearching(false); }
  };

  const driverAction = async (action) => {
    try {
      await fetch(`${HTTP_URL}/api/rides/${activeRide.ride_id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id })
      });
      setRideStatus(action === 'arrived' ? 'driver_arrived' : 'in_ride');
      
      // Se iniciou a corrida, desenha a linha verde até o destino do passageiro
      if (action === 'start' && locationRef.current && activeRide) {
        const dLat = locationRef.current.latitude;
        const dLng = locationRef.current.longitude;
        const destLat = activeRide.dest_lat;
        const destLng = activeRide.dest_lng;
        fetch(`https://router.project-osrm.org/route/v1/driving/${dLng},${dLat};${destLng},${destLat}?overview=full&geometries=geojson`)
          .then(res => res.json())
          .then(data => {
            if (data.routes && data.routes.length > 0) {
              const coords = data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
              webViewRef.current?.injectJavaScript(`drawRoute(${JSON.stringify(coords)});true;`);
            }
          }).catch(e => console.log(e));
      }
    } catch {}
  };

  const completeRide = async (method) => {
    if (!activeRide) return;
    if (user.tipo === 'motorista') {
        await fetch(`${HTTP_URL}/api/rides/${activeRide.ride_id}/complete`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: user.user_id, payment_method: method || 'pix' })
        });
        setRideToRate(activeRide);
        setActiveRide(null); setRideStatus(''); setChatMessages([]);
        if (isOnline) startTracking();
        setRatingVisible(true);
    } else {
        setActiveRide(null); setRideStatus(''); setChatMessages([]);
        setRatingVisible(true);
    }
  };

  const cancelRide = () => {
    if (!activeRide) return;
    Alert.alert('Cancelar corrida?', 'Deseja cancelar esta corrida?', [
      { text: 'Não' },
      { text: 'Sim, cancelar', style: 'destructive', onPress: async () => {
        await fetch(`${HTTP_URL}/api/rides/${activeRide.ride_id}/cancel`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: user.user_id })
        });
        setActiveRide(null); setRideStatus(''); setChatMessages([]); setSearching(false);
      }}
    ]);
  };

  const sendChat = () => {
    if (!chatInput.trim() || !activeRide) return;
    const msg = { type: 'chat', ride_id: activeRide.ride_id, sender_id: user.user_id, sender: user.tipo, text: chatInput, timestamp: new Date().toISOString() };
    send(msg);
    setChatMessages(p => [...p, msg]);
    setChatInput('');
  };

  const submitRating = async (rating) => {
    if (!rideToRate) return;
    try {
      await fetch(`${HTTP_URL}/api/rides/${rideToRate.ride_id}/rate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id, rating })
      });
    } catch {}
    setRatingVisible(false);
    setRideToRate(null);
  };

  const recenterGPS = async () => {
    // 1. Move a câmera instantaneamente para a última posição conhecida (UX rápida)
    if (location) {
      webViewRef.current?.injectJavaScript(`map.setView([${location.latitude}, ${location.longitude}], 16); true;`);
    }
    // 2. Busca o GPS real do hardware atualizado para garantir precisão total
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = loc.coords.latitude;
      const lng = loc.coords.longitude;
      setLocation({ latitude: lat, longitude: lng });
      webViewRef.current?.injectJavaScript(`map.flyTo([${lat}, ${lng}], 16, {duration: 0.8}); meMarker.setLatLng([${lat}, ${lng}]); true;`);
    } catch (e) {
      console.log('Erro ao recentralizar:', e);
    }
  };

  const handleWebViewMessage = (e) => {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'location_changed') {
        setLocation({ latitude: data.lat, longitude: data.lng });
      }
    } catch {}
  };

  if (!appReady) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: '#064e3b' }]}>
        <ActivityIndicator size="large" color="#34d399" />
      </View>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={async (u) => { 
      setUser(u); 
      try { await FileSystem.writeAsStringAsync(USER_FILE, JSON.stringify(u)); } catch {} 
    }} />;
  }

  const mapHtml = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body{margin:0;padding:0}
  #map{height:100vh;width:100vw}
  @keyframes pulse {
    0% { transform: scale(0.6); opacity: 1; }
    100% { transform: scale(1.6); opacity: 0; }
  }
</style>
</head><body><div id="map"></div><script>
var map = L.map('map',{zoomControl:false,attributionControl:false}).setView([${location?.latitude||(-21.13)},${location?.longitude||(-42.37)}],16);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{attribution:''}).addTo(map);

// Marcador do Passageiro/Minha Posição estilizado com efeito de drag-and-drop e pulso
var meIcon = L.divIcon({
  className: '',
  html: '<div style="position:relative; width:46px; height:46px; display:flex; justify-content:center; align-items:center;">' +
        '<div style="position:absolute; width:16px; height:16px; background:#064e3b; border:3.5px solid #fff; border-radius:50%; box-shadow:0 3px 8px rgba(0,0,0,0.4); z-index:2;"></div>' +
        '<div style="position:absolute; width:36px; height:36px; border:2.5px solid #10b981; border-radius:50%; animation: pulse 1.8s infinite; opacity:0.75; z-index:1;"></div>' +
        '</div>',
  iconSize: [46, 46],
  iconAnchor: [23, 23]
});

var meMarker = L.marker([${location?.latitude||(-21.13)},${location?.longitude||(-42.37)}],{icon:meIcon, draggable: true}).addTo(map);

meMarker.on('dragend', function(e) {
  var pos = e.target.getLatLng();
  window.ReactNativeWebView.postMessage(JSON.stringify({
    type: 'location_changed',
    lat: pos.lat,
    lng: pos.lng
  }));
});

var driverMarker = null;
var routeLine = null;
var simulatedCars = [];

var car3dData = 'data:image/png;base64,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';

function getCarSize() {
  var z = map.getZoom();
  var base = 48;
  if (z >= 18) return base * 1.5;
  if (z === 17) return base * 1.25;
  if (z === 16) return base;
  if (z === 15) return base * 0.75;
  if (z <= 14) return base * 0.5;
  return base;
}

function getCarIcon(eta) {
  var size = getCarSize();
  var etaHtml = eta ? '<div style="position:absolute;top:-' + (size/2 + 16) + 'px;left:50%;transform:translateX(-50%);background:#064e3b;color:#fff;padding:5px 10px;border-radius:14px;font-size:11px;font-weight:900;white-space:nowrap;box-shadow:0 3px 8px rgba(0,0,0,0.3);border:2px solid #34d399;font-family:sans-serif;">' + eta + '</div>' : '';
  var iconHtml = '<div style="position:relative;width:100%;height:100%;">' + etaHtml + '<img src="' + car3dData + '" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 4px 6px rgba(0,0,0,0.25));" /></div>';
  return L.divIcon({className:'', html: iconHtml, iconSize:[size, size], iconAnchor:[size/2, size/2]});
}

window.updateMe = function(lat,lng){
  meMarker.setLatLng([lat,lng]);
  map.panTo([lat,lng]);
};

window.updateDriver = function(lat,lng,eta){
  if (!driverMarker) {
    driverMarker = L.marker([lat,lng]);
  }
  driverMarker.eta = eta;
  
  driverMarker.setLatLng([lat,lng]);
  driverMarker.setIcon(getCarIcon(eta)).addTo(map);
  
  var grp = L.featureGroup([meMarker,driverMarker]);
  map.fitBounds(grp.getBounds(),{padding:[60,60]});
};

window.drawRoute = function(coords){
  if(routeLine) map.removeLayer(routeLine);
  routeLine = L.polyline(coords,{color:'#064e3b',weight:6,opacity:0.85,lineCap:'round',lineJoin:'round'}).addTo(map);
  map.fitBounds(routeLine.getBounds(),{padding:[60,60]});
};

// ATUALIZA TAMANHOS NO ZOOM
map.on('zoomend', function() {
  if (driverMarker) {
    driverMarker.setIcon(getCarIcon(driverMarker.eta));
  }
  var size = getCarSize();
  simulatedCars.forEach(function(c) {
    var carHtml = '<div style="width:100%;height:100%;"><img src="' + car3dData + '" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3));" /></div>';
    c.marker.setIcon(L.divIcon({className:'', html: carHtml, iconSize: [size, size], iconAnchor: [size/2, size/2]}));
  });
});

// SIMULAÇÃO DE VEÍCULOS VERDES NAS RUAS (OSRM)
function initSimulatedCars(lat, lng) {
  simulatedCars.forEach(c => map.removeLayer(c.marker));
  simulatedCars = [];
  
  var size = getCarSize();
  for (var i = 0; i < 4; i++) {
    var angle = Math.random() * Math.PI * 2;
    var dist = 0.002 + Math.random() * 0.004;
    var cLat = lat + Math.sin(angle) * dist;
    var cLng = lng + Math.cos(angle) * dist;
    
    fetch('https://router.project-osrm.org/route/v1/driving/' + lng + ',' + lat + ';' + cLng + ',' + cLat + '?overview=full&geometries=geojson')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.routes && data.routes[0] && data.routes[0].geometry.coordinates.length > 1) {
          var coords = data.routes[0].geometry.coordinates;
          var carHtml = '<div style="width:100%;height:100%;"><img src="' + car3dData + '" style="width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.3));" /></div>';
          var carIcon = L.divIcon({ className: '', html: carHtml, iconSize: [size, size], iconAnchor: [size/2, size/2] });
          var startCoord = coords[0];
          var marker = L.marker([startCoord[1], startCoord[0]], {icon: carIcon}).addTo(map);
          
          simulatedCars.push({
            marker: marker,
            path: coords,
            pathIndex: 0,
            progress: 0
          });
        }
      });
  }
}

initSimulatedCars(${location?.latitude||(-21.13)}, ${location?.longitude||(-42.37)});

function getDistance(p1, p2) {
  var R = 6371e3;
  var phi1 = p1[1] * Math.PI/180;
  var phi2 = p2[1] * Math.PI/180;
  var deltaPhi = (p2[1]-p1[1]) * Math.PI/180;
  var deltaLambda = (p2[0]-p1[0]) * Math.PI/180;
  var a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) +
          Math.cos(phi1) * Math.cos(phi2) *
          Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

setInterval(function() {
  if (simulatedCars.length === 0) return;
  simulatedCars.forEach(function(c) {
    if (c.path && c.pathIndex < c.path.length - 1) {
      var p1 = c.path[c.pathIndex]; // [lng, lat]
      var p2 = c.path[c.pathIndex + 1];
      
      if (!c.dist) c.dist = getDistance(p1, p2);
      
      if (c.dist < 0.1) {
        c.progress = 1;
      } else {
        var stepPercentage = 0.5 / c.dist; // move 0.5 metros por tick (aprox 36 km/h em 50ms)
        c.progress += stepPercentage;
      }
      
      if (c.progress >= 1) {
        c.progress = 0;
        c.pathIndex++;
        if (c.pathIndex >= c.path.length - 1) {
          c.path.reverse();
          c.pathIndex = 0;
        }
        c.dist = null;
        p1 = c.path[c.pathIndex];
        p2 = c.path[c.pathIndex + 1];
      }
      
      var currentLng = p1[0] + (p2[0] - p1[0]) * c.progress;
      var currentLat = p1[1] + (p2[1] - p1[1]) * c.progress;
      c.marker.setLatLng([currentLat, currentLng]);
      
      var angle = Math.atan2(p2[0] - p1[0], p2[1] - p1[1]);
      var deg = (angle * 180 / Math.PI);
      
      var el = c.marker.getElement();
      if (el) {
        var div = el.querySelector('div');
        if (div) div.style.transform = 'rotate(' + Math.round(deg) + 'deg)';
      }
    }
  });
}, 50);
</script></body></html>`;

  const statusLabel = { searching: '🔍 Buscando motorista...', accepted: '🚗 Motorista a caminho', driver_arrived: '✅ Motorista chegou!', in_ride: '🛣️ Em viagem' };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#064e3b' }}>
      <StatusBar barStyle="light-content" backgroundColor="#064e3b" />

      {/* Floating Header Glassmorphism Overlay */}
      <View style={styles.floatingHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={user.foto_url ? {uri: user.foto_url} : require('./assets/icon.png')} style={styles.headerProfileImage} />
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Image source={require('./assets/icon.png')} style={{width: 18, height: 18, borderRadius: 4, marginRight: 6}} />
              <Text style={styles.headerTitle}>BibiMarcos</Text>
              <View style={styles.liveBadge} />
            </View>
            <Text style={styles.headerSubtitle}>{user.nome.toUpperCase()} · ⭐ {(user.avaliacao||5.0).toFixed(1)}</Text>
          </View>
        </View>
        {user.tipo === 'motorista' && (
          <View style={styles.onlineSwitchContainer}>
            <Text style={styles.onlineText}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            <Switch value={isOnline} onValueChange={toggleOnline} trackColor={{ false: '#1e293b', true: '#10b981' }} thumbColor={isOnline ? '#fff' : '#94a3b8'} style={{ transform: [{ scaleX: 0.75 }, { scaleY: 0.75 }] }} />
          </View>
        )}
      </View>

      {/* Map WebView Section */}
      <View style={{ flex: 1 }}>
        {location ? (
          <WebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: mapHtml }}
            style={{ flex: 1 }}
            javaScriptEnabled
            onMessage={handleWebViewMessage}
            scrollEnabled={false}
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#064e3b" />
            <Text style={styles.loadingText}>Obtendo localização...</Text>
          </View>
        )}

        {/* Floating Actions on Map */}
        <View style={styles.floatingMapActions}>
          {/* Recenter Button */}
          <TouchableOpacity style={styles.recenterButton} onPress={recenterGPS}>
            <Text style={{ fontSize: 24, fontWeight: 'bold', color: '#064e3b' }}>⌖</Text>
          </TouchableOpacity>

          {/* Active Ride Chat */}
          {activeRide && rideStatus !== 'searching' && (
            <TouchableOpacity style={styles.chatButton} onPress={() => setChatVisible(true)}>
              <Text style={{ fontSize: 24 }}>💬</Text>
              {chatMessages.length > 0 && (
                <View style={styles.chatBadge} />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Dynamic Bottom Sheet Panel */}
      <View style={styles.bottomSheet}>
        <View style={styles.sheetHandle} />
        
        {activeRide && rideStatus !== 'searching' && (
          <View style={styles.rideCard}>
            <View style={styles.rideCardHeader}>
                <Text style={styles.statusText}>{statusLabel[rideStatus] || '⏳ Processando...'}</Text>
                {activeRide.fare && <Text style={styles.fareText}>R$ {parseFloat(activeRide.fare).toFixed(2)}</Text>}
            </View>

            {user.tipo === 'passageiro' && activeRide.driver_name && (
                <View style={styles.driverInfoCard}>
                    <View style={styles.driverAvatarContainer}>
                        {activeRide.driver_foto_url ? (
                            <Image source={{ uri: activeRide.driver_foto_url }} style={styles.fullImage} />
                        ) : (
                            <Text style={{ fontSize: 22 }}>🚗</Text>
                        )}
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.driverName}>{activeRide.driver_name}</Text>
                        <Text style={styles.driverCar}>{activeRide.driver_veiculo}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.driverRating}>⭐ {(activeRide.driver_avaliacao || 5.0).toFixed(1)}</Text>
                    </View>
                </View>
            )}

            {user.tipo === 'motorista' && activeRide.passenger_name && (
                 <View style={styles.driverInfoCard}>
                    <View style={styles.driverAvatarContainer}>
                        {activeRide.passenger_foto_url ? (
                            <Image source={{ uri: activeRide.passenger_foto_url }} style={styles.fullImage} />
                        ) : (
                            <Text style={{ fontSize: 22 }}>🧑</Text>
                        )}
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.driverName}>{activeRide.passenger_name}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.driverRating}>⭐ {(activeRide.passenger_avaliacao || 5.0).toFixed(1)}</Text>
                    </View>
                </View>
            )}

            {activeRide.dest_name && <Text style={styles.destinationText}>📍 Destino: {activeRide.dest_name}</Text>}
          </View>
        )}

        {!activeRide && user.tipo === 'passageiro' && !searching && (
          <TouchableOpacity style={styles.primaryActionButton} onPress={() => setDestVisible(true)}>
            <Text style={styles.primaryActionText}>🗺️  PARA ONDE VAMOS?</Text>
          </TouchableOpacity>
        )}

        {searching && (
          <View style={styles.searchingContainer}>
            <ActivityIndicator color="#064e3b" size="large" />
            <Text style={styles.searchingText}>Buscando motorista mais próximo...</Text>
            <TouchableOpacity onPress={cancelRide} style={styles.cancelLink}>
              <Text style={styles.cancelLinkText}>Cancelar solicitação</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeRide && user.tipo === 'passageiro' && rideStatus !== 'completed' && (
          <TouchableOpacity onPress={cancelRide} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>✕  Cancelar corrida</Text>
          </TouchableOpacity>
        )}

        {user.tipo === 'motorista' && !isOnline && !activeRide && (
          <Text style={styles.offlineHelperText}>Fique online para começar a receber chamadas em Muriaé</Text>
        )}

        {user.tipo === 'motorista' && isOnline && !activeRide && (
          <View style={styles.waitingContainer}>
            <ActivityIndicator size="small" color="#10b981" style={{ marginRight: 8 }} />
            <Text style={styles.waitingText}>Aguardando novas chamadas...</Text>
          </View>
        )}

        {user.tipo === 'motorista' && activeRide && rideStatus === 'accepted' && (
          <TouchableOpacity style={styles.driverArrivedButton} onPress={() => driverAction('arrived')}>
            <Text style={styles.driverActionButtonText}>📍  CHEGUEI AO LOCAL</Text>
          </TouchableOpacity>
        )}

        {user.tipo === 'motorista' && activeRide && rideStatus === 'driver_arrived' && (
          <TouchableOpacity style={styles.startRideButton} onPress={() => driverAction('start')}>
            <Text style={styles.driverActionButtonText}>▶  INICIAR VIAGEM</Text>
          </TouchableOpacity>
        )}

        {user.tipo === 'motorista' && activeRide && rideStatus === 'in_ride' && (
          <TouchableOpacity style={styles.completeRideButton} onPress={() => completeRide('pix')}>
            <Text style={styles.driverActionButtonText}>🏁  FINALIZAR CORRIDA</Text>
          </TouchableOpacity>
        )}
      </View>

      <ChatModal visible={chatVisible} onClose={() => setChatVisible(false)} messages={chatMessages} input={chatInput} onChangeInput={setChatInput} onSend={sendChat} isDriver={user.tipo === 'motorista'} />
      <PaymentModal visible={paymentVisible} ride={rideToRate || activeRide} onClose={() => setPaymentVisible(false)} onConfirm={(method) => { setPaymentVisible(false); completeRide(method); }} />
      <DestinationModal visible={destVisible} onClose={() => setDestVisible(false)} origin={location} onConfirm={requestRide} />
      <RatingModal visible={ratingVisible} onClose={() => setRatingVisible(false)} onSubmit={submitRating} isDriver={user.tipo === 'motorista'} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  floatingHeader: {
    position: 'absolute',
    top: StatusBar.currentHeight ? StatusBar.currentHeight + 10 : 45,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(6, 78, 59, 0.9)',
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(52, 211, 153, 0.35)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  headerProfileImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
    borderWidth: 2,
    borderColor: '#34d399',
  },
  headerTitle: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 19,
    letterSpacing: -0.5,
  },
  liveBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginLeft: 6,
    borderWidth: 1,
    borderColor: '#fff',
  },
  headerSubtitle: {
    color: '#a7f3d0',
    fontSize: 10,
    fontWeight: '800',
    marginTop: 1,
    letterSpacing: 0.5,
  },
  onlineSwitchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(4, 120, 87, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
  },
  onlineText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '900',
    marginRight: 4,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: {
    color: '#64748b',
    marginTop: 12,
    fontWeight: '700',
  },
  floatingMapActions: {
    position: 'absolute',
    bottom: 24,
    right: 16,
    gap: 12,
    zIndex: 5,
  },
  recenterButton: {
    backgroundColor: '#fff',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  chatButton: {
    backgroundColor: '#064e3b',
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  chatBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ef4444',
    borderWidth: 2,
    borderColor: '#fff',
  },
  bottomSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 20,
  },
  sheetHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#cbd5e1',
    borderRadius: 2.5,
    alignSelf: 'center',
    marginBottom: 20,
  },
  primaryActionButton: {
    backgroundColor: '#064e3b',
    paddingVertical: 18,
    borderRadius: 18,
    alignItems: 'center',
    shadowColor: '#064e3b',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 5,
  },
  primaryActionText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.5,
  },
  rideCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 18,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rideCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusText: {
    fontWeight: '900',
    fontSize: 16,
    color: '#064e3b',
  },
  fareText: {
    color: '#10b981',
    fontWeight: '900',
    fontSize: 19,
  },
  driverInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  driverAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    marginRight: 12,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  driverName: {
    fontWeight: '800',
    fontSize: 15,
    color: '#1e293b',
  },
  driverCar: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 1,
  },
  driverRating: {
    fontWeight: '900',
    color: '#f59e0b',
    fontSize: 15,
  },
  destinationText: {
    color: '#64748b',
    marginTop: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  searchingContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  searchingText: {
    color: '#064e3b',
    fontWeight: '800',
    marginTop: 10,
    fontSize: 15,
  },
  cancelLink: {
    marginTop: 14,
    padding: 6,
  },
  cancelLinkText: {
    color: '#ef4444',
    fontWeight: '800',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  cancelButton: {
    backgroundColor: '#fef2f2',
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cancelButtonText: {
    color: '#ef4444',
    fontWeight: '800',
  },
  offlineHelperText: {
    textAlign: 'center',
    color: '#94a3b8',
    fontWeight: '700',
    paddingVertical: 10,
    fontSize: 13,
  },
  waitingContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  waitingText: {
    color: '#10b981',
    fontWeight: '800',
    fontSize: 14,
  },
  driverArrivedButton: {
    backgroundColor: '#f59e0b',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  startRideButton: {
    backgroundColor: '#10b981',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  completeRideButton: {
    backgroundColor: '#064e3b',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  driverActionButtonText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
