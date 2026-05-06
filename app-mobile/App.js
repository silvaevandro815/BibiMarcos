import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Switch, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert, StatusBar, Image, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import LoginScreen from './screens/LoginScreen';
import ChatModal from './components/ChatModal';
import PaymentModal from './components/PaymentModal';
import DestinationModal from './components/DestinationModal';

const WS_URL = process.env.EXPO_PUBLIC_API_URL || 'ws://p12v8ns66xyrez0h1ywnhj8w.72.61.43.154.sslip.io/ws';
const HTTP_URL = WS_URL.replace('ws://', 'http://').replace('wss://', 'https://').replace('/ws', '');
const BG_TASK = 'BACKGROUND_LOCATION_TASK';

TaskManager.defineTask(BG_TASK, ({ data, error }) => { if (error || !data) return; });

export default function App() {
  const [user, setUser] = useState(null);
  const [location, setLocation] = useState(null);
  const [isOnline, setIsOnline] = useState(false);
  const [activeRide, setActiveRide] = useState(null);
  const [chatVisible, setChatVisible] = useState(false);
  const [paymentVisible, setPaymentVisible] = useState(false);
  const [destVisible, setDestVisible] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [rideStatus, setRideStatus] = useState('');
  const [searching, setSearching] = useState(false);

  const ws = useRef(null);
  const webViewRef = useRef(null);
  const locSub = useRef(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
    })();
  }, []);

  useEffect(() => {
    if (user) connectWS();
    return () => ws.current?.close();
  }, [user]);

  const connectWS = () => {
    ws.current = new WebSocket(WS_URL);
    ws.current.onopen = () => ws.current.send(JSON.stringify({ type: 'register', user_id: user.user_id }));
    ws.current.onmessage = (e) => { try { handleMsg(JSON.parse(e.data)); } catch {} };
    ws.current.onclose = () => setTimeout(connectWS, 3000);
  };

  const send = (obj) => ws.current?.readyState === WebSocket.OPEN && ws.current.send(JSON.stringify(obj));

  const handleMsg = (data) => {
    switch (data.type) {
      case 'ride_request':
        if (user.tipo === 'motorista') {
          const r = data.ride;
          Alert.alert(
            '🚗 Nova Corrida!',
            `Passageiro: ${r.passenger_name}\nDe: ${r.origin_name}\nPara: ${r.dest_name}\nValor: R$ ${r.fare?.toFixed(2)}\nDistância até passag.: ${(r.driver_distance_meters / 1000).toFixed(1)}km`,
            [{ text: 'Recusar', style: 'cancel' }, { text: 'ACEITAR ✓', onPress: () => acceptRide(r.ride_id) }]
          );
        }
        break;
      case 'ride_accepted':
        setActiveRide(data.ride);
        setRideStatus('accepted');
        setSearching(false);
        Alert.alert('✅ Motorista encontrado!', `${data.ride.driver_name}\n${data.ride.driver_veiculo}`);
        break;
      case 'driver_arrived':
        setActiveRide(data.ride);
        setRideStatus('driver_arrived');
        Alert.alert('🚗 Motorista chegou!', 'Seu motorista está no local de embarque.');
        break;
      case 'ride_started':
        setActiveRide(data.ride);
        setRideStatus('in_ride');
        break;
      case 'ride_completed':
        setActiveRide(data.ride);
        setRideStatus('completed');
        if (user.tipo === 'passageiro') setPaymentVisible(true);
        break;
      case 'driver_location':
        webViewRef.current?.injectJavaScript(`updateDriver(${data.lat},${data.lng});true;`);
        break;
      case 'chat':
        setChatMessages(p => [...p, data]);
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
        Alert.alert('Sem motoristas', e.detail || 'Nenhum motorista disponível.'); setSearching(false);
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
    if (!activeRide) return;
    try {
      await fetch(`${HTTP_URL}/api/rides/${activeRide.ride_id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.user_id })
      });
    } catch {}
  };

  const completeRide = async (method) => {
    if (!activeRide) return;
    await fetch(`${HTTP_URL}/api/rides/${activeRide.ride_id}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.user_id, payment_method: method })
    });
    setActiveRide(null); setRideStatus(''); setChatMessages([]);
    if (isOnline) startTracking();
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

  if (!user) return <LoginScreen onLogin={setUser} />;

  const mapHtml = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>body{margin:0;padding:0}#map{height:100vh;width:100vw}</style>
</head><body><div id="map"></div><script>
var map=L.map('map',{zoomControl:false,attributionControl:true}).setView([${location?.latitude||(-21.13)},${location?.longitude||(-42.37)}],15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap'}).addTo(map);
var meIcon=L.divIcon({className:'',html:'📍',iconSize:[30,30],iconAnchor:[15,30]});
var carIcon=L.divIcon({className:'',html:'🚗',iconSize:[36,36],iconAnchor:[18,18]});
var meMarker=L.marker([${location?.latitude||(-21.13)},${location?.longitude||(-42.37)}],{icon:meIcon}).addTo(map);
var driverMarker=null;
var routeLine=null;
window.updateMe=function(lat,lng){meMarker.setLatLng([lat,lng]);map.panTo([lat,lng]);};
window.updateDriver=function(lat,lng){
  if(!driverMarker){driverMarker=L.marker([lat,lng],{icon:carIcon}).addTo(map);}
  else{driverMarker.setLatLng([lat,lng]);}
  var grp=L.featureGroup([meMarker,driverMarker]);
  map.fitBounds(grp.getBounds(),{padding:[60,60]});
};
window.drawRoute=function(coords){
  if(routeLine)map.removeLayer(routeLine);
  routeLine=L.polyline(coords,{color:'#064e3b',weight:5,opacity:0.8}).addTo(map);
  map.fitBounds(routeLine.getBounds(),{padding:[50,50]});
};
</script></body></html>`;

  const statusLabel = { searching: '🔍 Buscando motorista...', accepted: '🚗 Motorista a caminho', driver_arrived: '✅ Motorista chegou!', in_ride: '🛣️ Em viagem', completed: '🏁 Chegou!' };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#064e3b' }}>
      <StatusBar barStyle="light-content" backgroundColor="#064e3b" />

      {/* Header */}
      <View style={{ padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#064e3b' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Image source={require('./assets/icon.png')} style={{ width: 38, height: 38, borderRadius: 19, marginRight: 10, borderWidth: 2, borderColor: '#34d399' }} />
          <View>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 17 }}>BibiMarcos</Text>
            <Text style={{ color: '#34d399', fontSize: 10, fontWeight: '700' }}>{user.nome.toUpperCase()} · {user.tipo}</Text>
          </View>
        </View>
        {user.tipo === 'motorista' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#047857', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20 }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', marginRight: 6 }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</Text>
            <Switch value={isOnline} onValueChange={toggleOnline} trackColor={{ false: '#334155', true: '#10b981' }} thumbColor={isOnline ? '#fff' : '#94a3b8'} style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }} />
          </View>
        )}
      </View>

      {/* Mapa */}
      <View style={{ flex: 1 }}>
        {location ? (
          <WebView ref={webViewRef} originWhitelist={['*']} source={{ html: mapHtml }} style={{ flex: 1 }} javaScriptEnabled scrollEnabled={false} />
        ) : (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
            <ActivityIndicator size="large" color="#064e3b" />
            <Text style={{ color: '#64748b', marginTop: 12 }}>Obtendo localização...</Text>
          </View>
        )}

        {/* Botão Chat flutuante */}
        {activeRide && rideStatus !== 'searching' && (
          <TouchableOpacity
            style={{ position: 'absolute', bottom: 110, right: 18, backgroundColor: '#064e3b', width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 6 }}
            onPress={() => setChatVisible(true)}
          >
            <Text style={{ fontSize: 26 }}>💬</Text>
            {chatMessages.length > 0 && (
              <View style={{ position: 'absolute', top: 6, right: 6, width: 12, height: 12, borderRadius: 6, backgroundColor: '#ef4444' }} />
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Bottom Panel */}
      <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, elevation: 20, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20 }}>
        {/* Status da corrida */}
        {activeRide && (
          <View style={{ backgroundColor: '#f0fdf4', borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#bbf7d0' }}>
            <Text style={{ fontWeight: '900', fontSize: 16, color: '#064e3b' }}>{statusLabel[rideStatus] || '⏳ Processando...'}</Text>
            {activeRide.dest_name && <Text style={{ color: '#64748b', marginTop: 2, fontSize: 13 }}>📍 {activeRide.dest_name}</Text>}
            {activeRide.fare && <Text style={{ color: '#10b981', fontWeight: '800', marginTop: 4 }}>R$ {parseFloat(activeRide.fare).toFixed(2)}</Text>}
          </View>
        )}

        {/* Ações: Passageiro sem corrida */}
        {!activeRide && user.tipo === 'passageiro' && !searching && (
          <TouchableOpacity style={{ backgroundColor: '#064e3b', padding: 18, borderRadius: 16, alignItems: 'center', elevation: 4 }} onPress={() => setDestVisible(true)}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>🗺️  PARA ONDE VAMOS?</Text>
          </TouchableOpacity>
        )}

        {/* Passageiro buscando */}
        {searching && (
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <ActivityIndicator color="#064e3b" size="large" />
            <Text style={{ color: '#064e3b', fontWeight: '700', marginTop: 8 }}>Buscando motorista próximo...</Text>
            <TouchableOpacity onPress={cancelRide} style={{ marginTop: 10 }}>
              <Text style={{ color: '#ef4444', fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Passageiro em corrida */}
        {activeRide && user.tipo === 'passageiro' && rideStatus !== 'completed' && (
          <TouchableOpacity onPress={cancelRide} style={{ backgroundColor: '#fef2f2', padding: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#fecaca' }}>
            <Text style={{ color: '#ef4444', fontWeight: '800' }}>✕  Cancelar corrida</Text>
          </TouchableOpacity>
        )}

        {/* Motorista offline */}
        {user.tipo === 'motorista' && !isOnline && !activeRide && (
          <Text style={{ textAlign: 'center', color: '#94a3b8', fontWeight: '600', paddingVertical: 10 }}>Ligue o switch para ficar online e receber corridas</Text>
        )}

        {/* Motorista online sem corrida */}
        {user.tipo === 'motorista' && isOnline && !activeRide && (
          <Text style={{ textAlign: 'center', color: '#064e3b', fontWeight: '700', paddingVertical: 10 }}>✅ Online — aguardando chamadas...</Text>
        )}

        {/* Motorista: corrida aceita → botão "Cheguei" */}
        {user.tipo === 'motorista' && activeRide && rideStatus === 'accepted' && (
          <TouchableOpacity style={{ backgroundColor: '#f59e0b', padding: 16, borderRadius: 14, alignItems: 'center' }} onPress={() => driverAction('arrived')}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>📍  CHEGUEI AO PASSAGEIRO</Text>
          </TouchableOpacity>
        )}

        {/* Motorista: chegou → botão "Iniciar" */}
        {user.tipo === 'motorista' && activeRide && rideStatus === 'driver_arrived' && (
          <TouchableOpacity style={{ backgroundColor: '#22c55e', padding: 16, borderRadius: 14, alignItems: 'center' }} onPress={() => driverAction('start')}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>▶  INICIAR CORRIDA</Text>
          </TouchableOpacity>
        )}

        {/* Motorista: em viagem → botão "Finalizar" */}
        {user.tipo === 'motorista' && activeRide && rideStatus === 'in_ride' && (
          <TouchableOpacity style={{ backgroundColor: '#064e3b', padding: 16, borderRadius: 14, alignItems: 'center' }} onPress={() => driverAction('complete').then(() => { setActiveRide(null); setRideStatus(''); setChatMessages([]); })}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 16 }}>🏁  FINALIZAR CORRIDA</Text>
          </TouchableOpacity>
        )}
      </View>

      <ChatModal visible={chatVisible} onClose={() => setChatVisible(false)} messages={chatMessages} input={chatInput} onChangeInput={setChatInput} onSend={sendChat} isDriver={user.tipo === 'motorista'} />
      <PaymentModal visible={paymentVisible} ride={activeRide} onClose={() => setPaymentVisible(false)} onConfirm={(method) => { setPaymentVisible(false); completeRide(method); }} />
      <DestinationModal visible={destVisible} onClose={() => setDestVisible(false)} origin={location} onConfirm={requestRide} />
    </SafeAreaView>
  );
}
