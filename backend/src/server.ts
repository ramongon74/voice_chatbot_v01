import express from 'express';
import cors from 'cors';
import { chatRouter } from './routes/chat';
import path from 'path'; // <--- 1. Importado 'path'

// Configuración de Express
const app = express();

// Configura el puerto para Cloud Run o desarrollo local
const port = process.env.PORT || 3001; // <--- 2. Puerto correcto

// Middlewares
app.use(cors()); // Habilita CORS
app.use(express.json()); // Middleware para parsear JSON

// --- Rutas de la API ---
// (Deben ir ANTES de servir el frontend)
app.use('/api/chat', chatRouter);


// --- Servir Frontend ---
// (Debe ir DESPUÉS de las rutas de la API)

// 3. Servir los archivos estáticos (JS, CSS, imágenes)
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// 4. Para cualquier otra ruta, servir el index.html
//    Esto permite que React/Vite maneje el enrutamiento
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});


// Iniciar el servidor
app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});
