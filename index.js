const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.json());

// Configuração do banco de dados (Ajuste com suas credenciais do PostgreSQL)
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'seu_banco',
  password: 'sua_senha',
  port: 5432,
});

// 4. Fórmula de Haversine para cálculos simples de distância em JS
// Caso necessite fazer alguma verificação em memória sem bater no banco
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Raio da Terra em km

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distância em km
}

// 1. Conexão Socket.io: o motorista enviará dados a cada 5 segundos
io.on('connection', (socket) => {
  console.log('Novo cliente conectado (socket):', socket.id);

  // Escuta o evento de atualização de localização do motorista
  socket.on('update_location', async (data) => {
    // Exemplo do payload esperado: { driver_id: 1, latitude: -23.5505, longitude: -46.6333 }
    const { driver_id, latitude, longitude } = data;

    try {
      // 2. O servidor atualiza a tabela driver_locations usando PostGIS
      // ST_MakePoint recebe os eixos no formato (longitude, latitude)
      const query = `
        INSERT INTO driver_locations (id_motorista, coordenadas, ultima_atualizacao)
        VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, CURRENT_TIMESTAMP)
        ON CONFLICT (id_motorista) 
        DO UPDATE SET 
          coordenadas = EXCLUDED.coordenadas,
          ultima_atualizacao = EXCLUDED.ultima_atualizacao;
      `;
      
      await pool.query(query, [driver_id, longitude, latitude]);
      console.log(`Localização atualizada via socket para o motorista ${driver_id}`);
    } catch (err) {
      console.error('Erro ao atualizar localização no PostGIS:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado:', socket.id);
  });
});

// 3. Rota /match que retorna os 5 motoristas mais próximos num raio de 5km
app.post('/match', async (req, res) => {
  // Exemplo de body: { "latitude": -23.5505, "longitude": -46.6333 }
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Latitude e longitude são obrigatórios.' });
  }

  try {
    // ST_Distance calcula a distância exata.
    // ST_DWithin é usado no WHERE pois otimiza o uso do índice GIST (5km = 5000 metros).
    const query = `
      SELECT 
        id_motorista,
        ST_Distance(
          coordenadas, 
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) AS distancia_metros
      FROM 
        driver_locations
      WHERE 
        ST_DWithin(
          coordenadas, 
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, 
          5000
        )
      ORDER BY 
        distancia_metros ASC
      LIMIT 5;
    `;

    const result = await pool.query(query, [longitude, latitude]);

    return res.json({
      passageiro: { latitude, longitude },
      motoristas_proximos: result.rows
    });
  } catch (err) {
    console.error('Erro ao buscar motoristas próximos na rota /match:', err);
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
