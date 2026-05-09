import React, { useEffect, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, Image
} from 'react-native';

const STATUS_LABEL = {
  completed: { label: 'Concluída', color: '#10b981' },
  cancelled:  { label: 'Cancelada',  color: '#ef4444' },
};

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' • ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatFare(fare) {
  const n = parseFloat(fare);
  return isNaN(n) ? 'R$ --' : `R$ ${n.toFixed(2).replace('.', ',')}`;
}

export default function HistoryModal({ visible, onClose, user, httpUrl }) {
  const [rides, setRides]     = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible && user?.user_id) fetchHistory();
  }, [visible, user]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${httpUrl}/api/rides/history/${user.user_id}`);
      const d = await r.json();
      setRides(d.rides || []);
    } catch (e) {
      setRides([]);
    } finally {
      setLoading(false);
    }
  };

  const isDriver = user?.tipo === 'motorista';

  const renderItem = ({ item }) => {
    const st = STATUS_LABEL[item.status] || { label: item.status, color: '#94a3b8' };
    const otherName = isDriver ? item.passenger_nome : item.driver_nome;
    const otherFoto = isDriver ? item.passenger_foto : item.driver_foto;

    return (
      <View style={styles.card}>
        {/* Header: outro usuário + status */}
        <View style={styles.cardHeader}>
          {otherFoto ? (
            <Image source={{ uri: otherFoto }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {(otherName || '?')[0].toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.otherName}>{otherName || (isDriver ? 'Passageiro' : 'Motorista')}</Text>
            {!isDriver && item.driver_veiculo ? (
              <Text style={styles.veiculo}>🚗 {item.driver_veiculo}</Text>
            ) : null}
          </View>
          <View style={[styles.badge, { backgroundColor: st.color + '22' }]}>
            <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>

        {/* Rota */}
        <View style={styles.routeRow}>
          <View style={styles.routeDots}>
            <View style={styles.dotGreen} />
            <View style={styles.routeLine} />
            <View style={styles.dotRed} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.routeText} numberOfLines={1}>{item.origin_name || 'Origem'}</Text>
            <Text style={styles.routeText} numberOfLines={1}>{item.dest_name   || 'Destino'}</Text>
          </View>
        </View>

        {/* Footer: data + valor + distância */}
        <View style={styles.cardFooter}>
          <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
          <View style={styles.footerRight}>
            {item.distance_meters ? (
              <Text style={styles.distText}>{(item.distance_meters / 1000).toFixed(1)} km</Text>
            ) : null}
            <Text style={styles.fareText}>{formatFare(item.fare)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>📋 Histórico de Viagens</Text>
          <Text style={styles.subtitle}>Últimos 15 dias</Text>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color="#10b981" size="large" style={{ marginTop: 60 }} />
        ) : rides.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🛣️</Text>
            <Text style={styles.emptyTitle}>Nenhuma viagem encontrada</Text>
            <Text style={styles.emptySubtitle}>
              Suas viagens dos últimos 15 dias aparecerão aqui.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.count}>{rides.length} viagem{rides.length !== 1 ? 's' : ''}</Text>
            <FlatList
              data={rides}
              keyExtractor={(item) => item.ride_id}
              renderItem={renderItem}
              contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
              showsVerticalScrollIndicator={false}
            />
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#0f172a' },
  header:      { paddingTop: 20, paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  title:       { fontSize: 22, fontWeight: '700', color: '#f1f5f9' },
  subtitle:    { fontSize: 13, color: '#64748b', marginTop: 2 },
  closeBtn:    { position: 'absolute', top: 20, right: 20, width: 32, height: 32, borderRadius: 16, backgroundColor: '#1e293b', alignItems: 'center', justifyContent: 'center' },
  closeText:   { color: '#94a3b8', fontSize: 14, fontWeight: '700' },
  count:       { color: '#64748b', fontSize: 13, marginLeft: 16, marginTop: 12, marginBottom: 4 },

  card:         { backgroundColor: '#1e293b', borderRadius: 16, padding: 16, marginBottom: 12 },
  cardHeader:   { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  avatar:       { width: 42, height: 42, borderRadius: 21, marginRight: 10 },
  avatarPlaceholder: { backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  avatarText:   { color: '#10b981', fontWeight: '700', fontSize: 18 },
  otherName:    { color: '#f1f5f9', fontWeight: '600', fontSize: 15 },
  veiculo:      { color: '#64748b', fontSize: 12, marginTop: 2 },
  badge:        { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText:    { fontSize: 12, fontWeight: '700' },

  routeRow:   { flexDirection: 'row', alignItems: 'stretch', marginBottom: 14 },
  routeDots:  { width: 20, alignItems: 'center', marginRight: 10 },
  dotGreen:   { width: 10, height: 10, borderRadius: 5, backgroundColor: '#10b981' },
  routeLine:  { flex: 1, width: 2, backgroundColor: '#334155', marginVertical: 3 },
  dotRed:     { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  routeText:  { color: '#94a3b8', fontSize: 13, lineHeight: 22 },

  cardFooter:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 10 },
  dateText:    { color: '#475569', fontSize: 12 },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distText:    { color: '#64748b', fontSize: 12 },
  fareText:    { color: '#10b981', fontWeight: '700', fontSize: 16 },

  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyIcon:      { fontSize: 64, marginBottom: 16 },
  emptyTitle:     { color: '#f1f5f9', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  emptySubtitle:  { color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
