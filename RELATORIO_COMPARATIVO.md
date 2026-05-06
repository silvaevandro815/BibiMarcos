# Relatório Comparativo: BibiMarcos vs Uber
## v3 — Maio 2026

---

## 1. APIs Open-Source Utilizadas

| Funcionalidade Uber | Solução Proprietária | Solução Open-Source (BibiMarcos) |
|---|---|---|
| Mapas | Google Maps Platform | **Leaflet.js + OpenStreetMap** |
| Busca de endereço | Google Places API | **Nominatim OSM** |
| Rotas | Google Directions API | **OSRM** |
| Backend real-time | Tecnologia própria | **FastAPI + WebSockets** |
| Pagamento | Stripe, Adyen | **PIX (QR EMV) + Dinheiro** |
| Push Notifications | Firebase FCM | *(A integrar: Expo Push — gratuito)* |

---

## 2. Comparativo Funcional

| Fluxo | Uber | BibiMarcos v3 | Status |
|---|---|---|---|
| Cadastro passageiro | ✅ SMS OTP + cartão | ✅ Telefone + nome | ✅ |
| Cadastro motorista | ✅ CNH, CRLV | ✅ Nome, veículo, Pix | ✅ |
| Busca de destino | ✅ Google Places | ✅ Nominatim | ✅ |
| Rota no mapa | ✅ Google Directions | ✅ OSRM + Leaflet polyline | ✅ |
| Matching motorista | ✅ ML proprietário | ✅ Haversine (3 mais próximos) | ✅ |
| Notificação corrida | ✅ Push | ✅ WebSocket real-time | ✅ |
| Aceitar corrida | ✅ | ✅ Alert + /accept | ✅ |
| GPS tracking motorista | ✅ Tempo real | ✅ WebSocket 4s | ✅ |
| "Cheguei ao passageiro" | ✅ | ✅ Botão + /arrived | ✅ |
| Iniciar corrida | ✅ | ✅ Botão + /start | ✅ |
| Finalizar corrida | ✅ | ✅ Botão + /complete | ✅ |
| Chat por corrida | ✅ Scoped | ✅ WebSocket ride_id | ✅ |
| Pagamento PIX | ❌ | ✅ QR Code EMV real | ✅ |
| Pagamento dinheiro | ✅ | ✅ | ✅ |
| Cancelamento | ✅ Ambos lados | ✅ Ambos lados | ✅ |
| Histórico corridas | ✅ | ✅ /history/:user_id | ✅ |
| Tarifa dinâmica | ✅ Surge ML | ✅ Multiplicador noturno/fds | ✅ |
| Avaliação 5 estrelas | ✅ | ⚠️ Estrutura pronta, UI pendente | 🔜 |
| Push app fechado | ✅ FCM | ⚠️ Pendente Expo Push | 🔜 |
| Persistência DB | ✅ Cassandra/PG | ⚠️ In-memory (PG pronto no req.) | 🔜 |

---

## 3. Arquitetura

```
[React Native / Expo]
  ├── LoginScreen.js        Cadastro/Login
  ├── App.js                Orquestrador (WS + estado)
  ├── DestinationModal.js   Nominatim geocoding + OSRM rota
  ├── ChatModal.js          Chat real-time por corrida
  └── PaymentModal.js       PIX QR Code + Dinheiro

[FastAPI Backend]
  ├── /api/register         Criar conta
  ├── /api/login            Autenticar
  ├── /api/drivers/online   Motor. fica online
  ├── /api/rides/request    Solicitar corrida
  ├── /api/rides/:id/accept Aceitar
  ├── /api/rides/:id/arrived Chegou
  ├── /api/rides/:id/start  Iniciar
  ├── /api/rides/:id/complete Finalizar
  ├── /api/rides/:id/cancel Cancelar
  └── WS /ws                Hub central eventos
```

---

## 4. Diferenciais do BibiMarcos

- ✅ **100% gratuito** — sem custos de API (Google Maps custa $$$)
- ✅ **PIX nativo** — o Uber BR não tem PIX
- ✅ **Deploy simples** — qualquer VPS com Python
- ✅ **Zero Firebase** — sem vendor lock-in

---

## 5. O que Falta para Paridade Total

| Feature | Prioridade | Solução |
|---|---|---|
| Push Notifications | Alta | Expo Push Notifications |
| Avaliação (estrelas) | Alta | `/api/rides/:id/rate` + UI |
| PostgreSQL persistência | Alta | asyncpg (já no requirements) |
| Foto de perfil | Média | Expo ImagePicker |
| Painel Admin | Média | Next.js |

---

*© OpenStreetMap contributors · OSRM · FastAPI · Expo*
